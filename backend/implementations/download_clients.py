# -*- coding: utf-8 -*-

"""
All download implementations.
"""

from __future__ import annotations

from base64 import b64decode, b64encode
from concurrent.futures import ThreadPoolExecutor, as_completed
from os.path import basename, join, sep, splitext
from re import IGNORECASE, compile
from threading import Event, Lock, Thread
from time import perf_counter
from typing import TYPE_CHECKING, Any, Dict, List, Set, Tuple, Type, Union, final
from urllib.parse import parse_qs, unquote_plus, urlparse

from bs4 import BeautifulSoup, Tag
from requests import RequestException, Response

from backend.base.custom_exceptions import (ClientNotWorking,
                                            CredentialInvalid,
                                            DownloadLimitReached,
                                            IssueNotFound, LinkBroken)
from backend.base.definitions import (BrokenClientReason, Constants,
                                      CredentialSource, Download,
                                      DownloadSource, DownloadState,
                                      DownloadType, ExternalDownload,
                                      ExternalDownloadClient)
from backend.implementations.suwayomi import (SuwayomiClient,
                                              SuwayomiDownloadError,
                                              SuwayomiWaitStatus,
                                              SUWAYOMI_SOURCE_NAME,
                                              parse_suwayomi_link,
                                              parse_suwayomi_volume_link)
from backend.base.helpers import Session, first_of_range, get_torrent_info
from backend.base.logging import LOGGER
from backend.implementations.credentials import Credentials
from backend.implementations.direct_clients.mega import (Mega, MegaABC,
                                                         MegaFolder)
from backend.implementations.external_clients import ExternalClients
from backend.implementations.naming import generate_issue_name
from backend.implementations.remote_mapping import RemoteMappings
from backend.implementations.volumes import Volume
from backend.internals.server import QueueStatusEvent, WebSocket
from backend.internals.settings import Settings

if TYPE_CHECKING:
    from requests import Response


# autopep8: off
file_extension_regex = compile(r'(?<=\.|\/)[\w\d]{2,4}(?=$|;|\s|\")', IGNORECASE)
file_name_regex = compile(r'filename(?:=\"|\*=UTF-8\'\')(.*?)\.[a-z]{2,4}\"?$', IGNORECASE)
extract_mediafire_regex = compile(r'window.location.href\s?=\s?\'https://download\d+\.mediafire.com/.*?(?=\')', IGNORECASE)
extract_ufile_regex = compile(r'href=["\']+(https://[^"\']*ufile\.io/[^"\']+)["\']', IGNORECASE)
suwayomi_source_detail_regex = compile(r'\[([^\[\]]+)\]\s*$')
DOWNLOAD_CHUNK_SIZE = 4194304 # 4MB Chunks
SEGMENTED_DOWNLOAD_MIN_SIZE = 268435456 # 256MB
SEGMENTED_DOWNLOAD_PARTS = 4
MEDIAFIRE_FOLDER_LINK = "https://www.mediafire.com/api/1.5/file/zip.php"
WETRANSFER_API_LINK = "https://wetransfer.com/api/v4/transfers/{transfer_id}/download"
content_range_regex = compile(r'^bytes (\d+)-(\d+)/(\d+)$', IGNORECASE)
strong_etag_regex = compile(r'^"[^"\x00-\x20\x7f]+"$')
# autopep8: on



def _set_suwayomi_failure(download: Download, failure) -> None:
    """Attach a sanitized structured cause and mark the download failed."""
    if isinstance(failure, SuwayomiDownloadError):
        details = failure.details
    elif isinstance(failure, dict):
        details = failure
    else:
        details = {
            'stage': 'download',
            'type': type(failure).__name__ if failure is not None else 'failed',
        }
    download._failure_reason = dict(details)
    download._state = DownloadState.FAILED_STATE


def _emit_download_status(download: Download) -> None:
    """Emit a download status websocket event without blocking the worker.

    Suwayomi downloads run inside queue worker threads. A stalled websocket
    client must not prevent chapter enqueue/download/PDF assembly from starting.
    """
    def _emit() -> None:
        try:
            WebSocket().emit(QueueStatusEvent(download))
        except Exception:
            LOGGER.exception('Failed to emit websocket download status event')

    Thread(target=_emit, name='DownloadStatusEmit', daemon=True).start()


class _SegmentedDownloadFallback(Exception):
    """The server did not safely complete a validated ranged transfer."""


def _build_byte_ranges(size: int, parts: int) -> List[Tuple[int, int]]:
    """Split a known-size file into contiguous inclusive byte ranges."""
    if size <= 0 or parts <= 0:
        return []

    parts = min(parts, size)
    base_size, remainder = divmod(size, parts)
    result: List[Tuple[int, int]] = []
    start = 0
    for index in range(parts):
        part_size = base_size + (1 if index < remainder else 0)
        end = start + part_size - 1
        result.append((start, end))
        start = end + 1
    return result


# region Base Direct Download
class BaseDirectDownload(Download):
    @property
    def id(self) -> int:
        return self._id # type: ignore

    @id.setter
    def id(self, value: int) -> None:
        self._id = value
        return

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> Union[int, None]:
        return self._issue_id

    @property
    def covered_issues(self) -> Union[float, Tuple[float, float], None]:
        return self._covered_issues

    @property
    def web_link(self) -> Union[str, None]:
        return self._web_link

    @property
    def web_title(self) -> Union[str, None]:
        return self._web_title

    @property
    def web_sub_title(self) -> Union[str, None]:
        return self._web_sub_title

    @property
    def download_link(self) -> str:
        return self._download_link

    @property
    def pure_link(self) -> str:
        return self._pure_link

    @property
    def source_type(self) -> DownloadSource:
        return self._source_type

    @property
    def source_name(self) -> str:
        return self._source_name

    @property
    def files(self) -> List[str]:
        return self._files

    @files.setter
    def files(self, value: List[str]) -> None:
        self._files = value
        return

    @property
    def filename_body(self) -> str:
        return self._filename_body

    @property
    def title(self) -> str:
        return self._title

    @property
    def size(self) -> int:
        return self._size

    @property
    def state(self) -> DownloadState:
        return self._state

    @state.setter
    def state(self, value: DownloadState) -> None:
        self._state = value
        return

    @property
    def progress(self) -> float:
        return self._progress

    @property
    def speed(self) -> float:
        return self._speed

    @property
    def progress_is_percent(self) -> bool:
        return getattr(self, '_progress_is_percent', self._size != -1)

    @property
    def task_label(self) -> str:
        return self._task_label

    @property
    def download_thread(self) -> Union[Thread, None]:
        return self._download_thread

    @download_thread.setter
    def download_thread(self, value: Thread) -> None:
        self._download_thread = value
        return

    @property
    def download_folder(self) -> str:
        return self._download_folder

    def __init__(
        self,
        download_link: str,

        volume_id: int,
        covered_issues: Union[float, Tuple[float, float], None],

        source_type: DownloadSource,
        source_name: str,

        web_link: Union[str, None],
        web_title: Union[str, None],
        web_sub_title: Union[str, None],

        forced_match: bool = False
    ) -> None:
        LOGGER.debug(
            'Creating download: %s',
            download_link
        )

        settings = Settings().sv
        volume = Volume(volume_id)

        self.__r = None
        self._download_link = download_link
        self._volume_id = volume_id
        self._issue_id = None
        self._covered_issues = covered_issues
        self._source_type = source_type
        self._source_name = source_name
        self._web_link = web_link
        self._web_title = web_title
        self._web_sub_title = web_sub_title

        self._id = None
        self._state = DownloadState.QUEUED_STATE
        self._progress = 0.0
        self._speed = 0.0
        self._task_label = ''
        self._download_thread = None
        self._download_folder = settings.download_folder

        self._ssn = Session()

        # Create and fetch pure link to extract last info
        # This can fail if the link is broken, so do before other
        # intensive tasks to save time (no need to do intensive tasks when
        # link is broken).
        try:
            self._pure_link = self._convert_to_pure_link()
            with self._fetch_pure_link() as response:
                response.raise_for_status()
                self._ssn.close()

        except RequestException as e:
            if (
                e.response is not None
                and e.response.url.startswith(Constants.PIXELDRAIN_API_URL)
                and e.response.status_code == 403
            ):
                # Pixeldrain rate limit because of hotlinking
                raise DownloadLimitReached(DownloadSource.PIXELDRAIN)

            if (
                self.identifier == MediaFireFolderDownload.identifier
                and e.response is not None
                and e.response.status_code in (401, 403)
            ):
                # MediaFire may allow a browser to open a folder while refusing
                # Kapowarr's ZIP endpoint request. That's a temporary service
                # access failure, not evidence that the shared folder link is
                # dead, so don't permanently blocklist the link as broken.
                raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

            raise LinkBroken(download_link)

        self._size = int(response.headers.get('Content-Length', -1))
        self._supports_range_header = (
            response.headers.get('Accept-Ranges') == 'bytes'
        )

        self._filename_body = ''
        try:
            if isinstance(covered_issues, float):
                self._issue_id = volume.get_issue_from_number(covered_issues).id

            if settings.rename_downloaded_files:
                self._filename_body = generate_issue_name(
                    volume.get_data(),
                    covered_issues
                )

        except IssueNotFound as e:
            if not forced_match:
                raise e

        if not self._filename_body:
            self._filename_body = self._extract_default_filename_body(response)

        self._title = basename(self._filename_body)
        self._files = [self._build_filename(response)]
        return

    def _convert_to_pure_link(self) -> str:
        return self.download_link

    def _fetch_pure_link(self, start_byte: Union[int, None] = None) -> Response:
        headers = {}
        if start_byte is not None and self._supports_range_header:
            headers["Range"] = f"bytes={start_byte}-"

        return self._ssn.get(self.pure_link, headers=headers, stream=True)

    def _extract_default_filename_body(
        self,
        response: Union[Response, None]
    ) -> str:
        if response and response.headers.get('Content-Disposition'):
            file_result = file_name_regex.search(
                response.headers['Content-Disposition']
            )
            if file_result:
                return unquote_plus(
                    file_result.group(1)
                )

        return splitext(unquote_plus(
            self.pure_link.split('/')[-1].split("?")[0]
        ))[0]

    def _extract_extension(self, response: Union[Response, None]) -> str:
        if not response:
            return ''

        match = file_extension_regex.findall(
            ' '.join((
                response.headers.get('Content-Disposition', ''),
                response.headers.get('Content-Type', ''),
                response.url
            ))
        )
        if match:
            return '.' + match[0]
        return ''

    def _build_filename(self, response: Union[Response, None]) -> str:
        extension = self._extract_extension(response)
        return join(
            self._download_folder,
            '_'.join(self._filename_body.split(sep)) + extension
        )

    def run(self) -> None:
        self._state = DownloadState.DOWNLOADING_STATE
        size_downloaded = 0

        ws = WebSocket()
        status_event = QueueStatusEvent(self)
        ws.emit(status_event)

        start_time = perf_counter()
        tries_left = Constants.TOTAL_RETRIES
        is_stopped = False
        with open(self.files[0], 'wb') as f:
            while tries_left > 0:
                tries_left -= 1
                if not self._supports_range_header:
                    size_downloaded = 0

                with self._fetch_pure_link(start_byte=size_downloaded) as r:
                    self.__r = r
                    try:
                        for chunk in r.iter_content(
                            chunk_size=DOWNLOAD_CHUNK_SIZE
                        ):
                            if self.state in (
                                DownloadState.CANCELED_STATE,
                                DownloadState.SHUTDOWN_STATE
                            ):
                                is_stopped = True
                                break

                            f.write(chunk)

                            # Update progress
                            chunk_size = len(chunk)
                            size_downloaded += chunk_size
                            self._speed = round(
                                chunk_size / (perf_counter() - start_time),
                                2
                            )
                            if self.size == -1:
                                # No file size so progress is amount downloaded
                                self._progress = size_downloaded
                            else:
                                self._progress = round(
                                    size_downloaded / self.size * 100,
                                    2
                                )

                            start_time = perf_counter()
                            ws.emit(status_event)

                        else:
                            # Success
                            break

                        if is_stopped:
                            # Stopping download
                            break

                    except RequestException:
                        # Connection error, packet loss, etc. Just try again
                        pass

                    finally:
                        self.__r = None
            else:
                # Failed to download file
                self._state = DownloadState.FAILED_STATE

        if (
            not is_stopped
            and self.size != -1
            and size_downloaded != self.size
        ):
            # Download completed, but downloaded size is not equal
            # to reported size of file
            self._state = DownloadState.FAILED_STATE

        return

    def stop(self,
        state: DownloadState = DownloadState.CANCELED_STATE
    ) -> None:
        self._state = state
        if (
            self.__r
            and self.__r.raw._fp
            and not isinstance(self.__r.raw._fp, str)
        ):
            try:
                self.__r.raw._fp.fp.raw._sock.shutdown(2)  # SHUT_RDWR
            except OSError as e:
                if e.errno != 9:
                    raise
        return

    def as_dict(self) -> Dict[str, Any]:
        source_detail = None
        web_sub_title = getattr(self, '_web_sub_title', None)
        if self._source_type == DownloadSource.SUWAYOMI and web_sub_title:
            source_match = suwayomi_source_detail_regex.search(web_sub_title)
            if source_match:
                source_detail = source_match.group(1)

        return {
            'id': self._id,
            'volume_id': self._volume_id,
            'issue_id': self._issue_id,

            'web_link': self._web_link,
            'web_title': self._web_title,
            'web_sub_title': self._web_sub_title,
            'download_link': self._download_link,
            'pure_link': self._pure_link,

            'source_type': self._source_type.value,
            'source_name': self._source_name,
            'source_detail': source_detail,
            'type': self.identifier,

            'file': self._files[0],
            'title': self._title,
            'download_folder': self._download_folder,

            'size': self._size,
            'status': self._state.value,
            'progress': self._progress,
            'progress_is_percent': self.progress_is_percent,
            'speed': self._speed,
            'task_label': getattr(self, '_task_label', '')
        }


# region Direct
@final
class DirectDownload(BaseDirectDownload):
    "For downloading a file directly from a link"

    identifier: str = 'direct'

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.__active_responses: Set[Response] = set()
        self.__active_responses_lock = Lock()
        self._range_validator: Union[str, None] = None
        self._supports_segmented_download = (
            self.size >= SEGMENTED_DOWNLOAD_MIN_SIZE
            and self._probe_range_support()
        )
        if self._supports_segmented_download:
            # Also make ordinary in-process retries resumable on these hosts.
            self._supports_range_header = True

    def _open_range_response(self, start_byte: int, end_byte: int) -> Response:
        """Open a bounded byte range using an independent worker session."""
        session = Session()
        try:
            headers = {
                "Accept-Encoding": "identity",
                "Range": f"bytes={start_byte}-{end_byte}",
            }
            range_validator = getattr(self, '_range_validator', None)
            if range_validator is not None:
                headers["If-Range"] = range_validator
            response = session.get(
                self.pure_link,
                headers=headers,
                stream=True,
                timeout=Constants.REQUEST_TIMEOUT
            )
        except Exception:
            session.close()
            raise

        setattr(response, '_kapowarr_session', session)
        return response

    @staticmethod
    def _close_range_response(response: Response) -> None:
        try:
            response.close()
        finally:
            session = getattr(response, '_kapowarr_session', None)
            if session is not None:
                session.close()

    def _response_matches_range(
        self,
        response: Response,
        start_byte: int,
        end_byte: int
    ) -> bool:
        if response.status_code != 206:
            return False
        if response.headers.get('Content-Encoding') not in (None, 'identity'):
            return False

        match = content_range_regex.fullmatch(
            response.headers.get('Content-Range', '').strip()
        )
        if not match:
            return False

        actual_start, actual_end, total_size = map(int, match.groups())
        if (
            actual_start != start_byte
            or actual_end != end_byte
            or total_size != self.size
        ):
            return False

        range_validator = getattr(self, '_range_validator', None)
        if range_validator is not None:
            response_validator = response.headers.get('ETag')
            if response_validator != range_validator:
                return False

        content_length = response.headers.get('Content-Length')
        if content_length is None:
            return True
        try:
            return int(content_length) == end_byte - start_byte + 1
        except ValueError:
            return False

    def _probe_range_support(self) -> bool:
        """Verify a one-byte 206 response instead of trusting Accept-Ranges."""
        response = None
        try:
            response = self._open_range_response(0, 0)
            if not self._response_matches_range(response, 0, 0):
                return False
            received = 0
            for chunk in response.iter_content(chunk_size=1):
                received += len(chunk)
                if received > 1:
                    return False
            if received != 1:
                return False

            etag = response.headers.get('ETag')
            if etag is None or strong_etag_regex.fullmatch(etag) is None:
                return False
            self._range_validator = etag
            return True
        except (RequestException, OSError, TypeError, ValueError):
            return False
        finally:
            if response is not None:
                self._close_range_response(response)

    def _register_active_response(self, response: Response) -> bool:
        with self.__active_responses_lock:
            if self.state in (
                DownloadState.CANCELED_STATE,
                DownloadState.SHUTDOWN_STATE
            ):
                return False
            self.__active_responses.add(response)
            return True

    def _unregister_active_response(self, response: Response) -> None:
        with self.__active_responses_lock:
            self.__active_responses.discard(response)

    def _queue_segment_status_emit(
        self,
        ws: WebSocket,
        status_event: QueueStatusEvent
    ) -> None:
        """Publish progress off-worker with at most one emitter thread."""
        with self.__status_emit_lock:
            self.__status_emit_dirty = True
            if self.__status_emit_pending:
                return
            self.__status_emit_pending = True

        def emit_latest() -> None:
            while True:
                with self.__status_emit_lock:
                    self.__status_emit_dirty = False
                try:
                    ws.emit(status_event)
                except Exception:
                    LOGGER.exception(
                        'Failed to emit segmented download status event'
                    )

                with self.__status_emit_lock:
                    if self.__status_emit_dirty:
                        continue
                    self.__status_emit_pending = False
                    return

        Thread(
            target=emit_latest,
            name='SegmentedDownloadStatusEmit',
            daemon=True
        ).start()

    def _download_segment(
        self,
        start_byte: int,
        end_byte: int,
        progress: Dict[str, Union[int, float]],
        progress_lock: Lock,
        abort: Event,
        ws: WebSocket,
        status_event: QueueStatusEvent
    ) -> None:
        position = start_byte
        tries_left = Constants.TOTAL_RETRIES

        while position <= end_byte and tries_left > 0 and not abort.is_set():
            if self.state in (
                DownloadState.CANCELED_STATE,
                DownloadState.SHUTDOWN_STATE
            ):
                abort.set()
                return

            tries_left -= 1
            response = None
            registered = False
            try:
                response = self._open_range_response(position, end_byte)
                if not self._response_matches_range(
                    response, position, end_byte
                ):
                    raise _SegmentedDownloadFallback()

                registered = self._register_active_response(response)
                if not registered:
                    abort.set()
                    return
                with open(self.files[0], 'r+b') as target:
                    target.seek(position)
                    for chunk in response.iter_content(
                        chunk_size=DOWNLOAD_CHUNK_SIZE
                    ):
                        if abort.is_set() or self.state in (
                            DownloadState.CANCELED_STATE,
                            DownloadState.SHUTDOWN_STATE
                        ):
                            abort.set()
                            return
                        if not chunk:
                            continue

                        remaining = end_byte - position + 1
                        if len(chunk) > remaining:
                            raise _SegmentedDownloadFallback()

                        target.write(chunk)
                        position += len(chunk)
                        with progress_lock:
                            progress['downloaded'] += len(chunk)
                            elapsed = max(
                                perf_counter() - progress['started'],
                                0.001
                            )
                            self._speed = round(
                                progress['downloaded'] / elapsed,
                                2
                            )
                            self._progress = round(
                                progress['downloaded'] / self.size * 100,
                                2
                            )
                        self._queue_segment_status_emit(ws, status_event)

                if position > end_byte:
                    return

            except _SegmentedDownloadFallback:
                abort.set()
                raise
            except RequestException:
                if self.state in (
                    DownloadState.CANCELED_STATE,
                    DownloadState.SHUTDOWN_STATE
                ):
                    abort.set()
                    return
                # Resume only the unfinished bytes in this segment.
                continue
            finally:
                if response is not None:
                    if registered:
                        self._unregister_active_response(response)
                    self._close_range_response(response)

        if position <= end_byte and not abort.is_set():
            abort.set()
            raise _SegmentedDownloadFallback()

    def _run_segmented_download(
        self,
        ws: WebSocket,
        status_event: QueueStatusEvent
    ) -> bool:
        ranges = _build_byte_ranges(self.size, SEGMENTED_DOWNLOAD_PARTS)
        if len(ranges) < 2:
            return False

        with open(self.files[0], 'wb') as target:
            target.truncate(self.size)

        progress: Dict[str, Union[int, float]] = {
            'downloaded': 0,
            'started': perf_counter(),
        }
        progress_lock = Lock()
        abort = Event()

        with ThreadPoolExecutor(
            max_workers=len(ranges),
            thread_name_prefix='DirectDownloadSegment'
        ) as executor:
            futures = [
                executor.submit(
                    self._download_segment,
                    start_byte,
                    end_byte,
                    progress,
                    progress_lock,
                    abort,
                    ws,
                    status_event
                )
                for start_byte, end_byte in ranges
            ]
            try:
                for future in as_completed(futures):
                    future.result()
            except Exception as error:
                abort.set()
                for future in futures:
                    future.cancel()
                if self.state in (
                    DownloadState.CANCELED_STATE,
                    DownloadState.SHUTDOWN_STATE
                ):
                    return True
                if isinstance(error, (
                    _SegmentedDownloadFallback,
                    RequestException,
                    OSError
                )):
                    return False
                raise

        if self.state in (
            DownloadState.CANCELED_STATE,
            DownloadState.SHUTDOWN_STATE
        ):
            return True

        return progress['downloaded'] == self.size

    def run(self) -> None:
        if not self._supports_segmented_download:
            super().run()
            return

        self._state = DownloadState.DOWNLOADING_STATE
        self._task_label = (
            f'Downloading ({SEGMENTED_DOWNLOAD_PARTS} connections)'
        )
        self.__status_emit_lock = Lock()
        self.__status_emit_pending = False
        self.__status_emit_dirty = False
        ws = WebSocket()
        status_event = QueueStatusEvent(self)
        self._queue_segment_status_emit(ws, status_event)

        if self._run_segmented_download(ws, status_event):
            return
        if self.state in (
            DownloadState.CANCELED_STATE,
            DownloadState.SHUTDOWN_STATE
        ):
            return

        LOGGER.warning(
            'Validated segmented download failed; falling back to one stream'
        )
        self._progress = 0.0
        self._speed = 0.0
        self._task_label = ''
        # A segmented failure means range semantics are no longer trustworthy.
        # Single-stream retries must restart cleanly rather than append a 200.
        self._supports_range_header = False
        super().run()

    def stop(self,
        state: DownloadState = DownloadState.CANCELED_STATE
    ) -> None:
        self._state = state
        with self.__active_responses_lock:
            active_responses = tuple(self.__active_responses)
        for response in active_responses:
            try:
                response.close()
            except Exception:
                LOGGER.exception(
                    'Failed to close an active segmented response'
                )
        super().stop(state)


# region MediaFire
@final
class MediaFireDownload(BaseDirectDownload):
    "For downloading a MediaFire file"

    identifier: str = 'mf'

    def _convert_to_pure_link(self) -> str:
        r = self._ssn.get(
            self.download_link,
            stream=True
        )
        result = extract_mediafire_regex.search(r.text)
        if result:
            return result.group(0).split("'")[-1]

        soup = BeautifulSoup(r.text, 'html.parser')
        button = soup.find('a', {'id': 'downloadButton'})
        if not isinstance(button, Tag):
            raise LinkBroken(self.download_link)

        href: str = first_of_range(button['href'])
        if href.startswith('http'):
            return href

        data_scrambled_url = button.get('data-scrambled-url')
        if data_scrambled_url:
            return b64decode(first_of_range(data_scrambled_url)).decode('utf-8')

        raise LinkBroken(self.download_link)


# region MediaFire Folder
@final
class MediaFireFolderDownload(BaseDirectDownload):
    "For downloading a MediaFire folder (for MF file, use MediaFireDownload)"

    identifier: str = 'mf_folder'

    def _convert_to_pure_link(self) -> str:
        return self.download_link.split("/folder/")[1].split("/")[0]

    def _fetch_pure_link(self, start_byte: Union[int, None] = None) -> Response:
        headers = {}
        if start_byte is not None and self._supports_range_header:
            headers["Range"] = f"bytes={start_byte}-"

        return self._ssn.post(
            MEDIAFIRE_FOLDER_LINK,
            files={
                "keys": (None, self.pure_link),
                "meta_only": (None, "no"),
                "allow_large_download": (None, "yes"),
                "response_format": (None, "json")
            },
            headers=headers,
            stream=True
        )


# region UFile
@final
class UFileDownload(BaseDirectDownload):
    "For downloading a UFile.io file"

    identifier: str = 'uf'

    def _convert_to_pure_link(self) -> str:
        r = self._ssn.get(self.download_link, stream=True)
        soup = BeautifulSoup(r.text, 'html.parser')

        # Try known download button id selectors (ufile.io has a typo in older pages)
        button = (
            soup.find('a', {'id': 'downlodfile'})
            or soup.find('a', {'id': 'downloadfile'})
        )
        if isinstance(button, Tag):
            href = first_of_range(button.get('href') or '')
            if href and href.startswith('http'):
                return href

        raise LinkBroken(self.download_link)


# region WeTransfer
@final
class WeTransferDownload(BaseDirectDownload):
    "For downloading a file or folder from WeTransfer"

    identifier: str = 'wt'

    def _convert_to_pure_link(self) -> str:
        transfer_id, security_hash = self.download_link.split("/")[-2:]
        r = self._ssn.post(
            WETRANSFER_API_LINK.format(transfer_id=transfer_id),
            json={
                "intent": "entire_transfer",
                "security_hash": security_hash
            },
            headers={"x-requested-with": "XMLHttpRequest"}
        )
        if not r.ok:
            raise LinkBroken(self.download_link)

        direct_link = r.json().get("direct_link")

        if not direct_link:
            raise LinkBroken(self.download_link)

        return direct_link


# region PixelDrain
class PixelDrainDownload(BaseDirectDownload):
    "For downloading a file from PixelDrain"

    identifier: str = "pd"

    @staticmethod
    def login(api_key: str) -> None:
        LOGGER.debug("Logging into Pixeldrain with user api key")
        with Session() as session:
            enc_api_key = b64encode(
                f":{api_key}".encode()
            ).decode()

            try:
                r = session.get(
                    Constants.PIXELDRAIN_API_URL + "/user",
                    headers={
                        "Authorization": "Basic " + enc_api_key
                    }
                )

            except RequestException:
                raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

            if r.status_code == 401:
                raise CredentialInvalid

            response = r.json()
            if (response["subscription"]["type"] or "free").lower() == "free":
                # Free account, so fetch standard rate limits
                limits = session.get(
                    Constants.PIXELDRAIN_API_URL + '/misc/rate_limits',
                    headers={
                        "Authorization": "Basic " + enc_api_key
                    }
                ).json()

                transfer_limit_used = limits["transfer_limit_used"]
                transfer_limit = limits["transfer_limit"]

            else:
                # Paid account, so grab transfer limits from user data
                transfer_limit_used = response["monthly_transfer_used"]
                transfer_limit = response["monthly_transfer_cap"]
                if transfer_limit == -1:
                    transfer_limit = float("inf")

        LOGGER.debug(
            f"Pixeldrain account transfer state: {transfer_limit_used}/{transfer_limit}"
        )
        if transfer_limit_used > transfer_limit:
            raise DownloadLimitReached(DownloadSource.PIXELDRAIN)
        return None

    def _convert_to_pure_link(self) -> str:
        self._api_key = None
        self._first_fetch = True
        download_id = self.download_link.rstrip("/").split("/")[-1]
        return Constants.PIXELDRAIN_API_URL + '/file/' + download_id

    def _fetch_pure_link(self, start_byte: Union[int, None] = None) -> Response:
        if self._first_fetch:
            cred = Credentials()
            for pd_cred in cred.get_from_source(CredentialSource.PIXELDRAIN):
                try:
                    # Let ClientNotWorking bubble up
                    self.login(pd_cred.api_key or '')

                except (CredentialInvalid, DownloadLimitReached):
                    continue

                else:
                    # Key works and has not reached limit
                    self._api_key = pd_cred.api_key
                    break

            self._first_fetch = False

        headers = {}

        if start_byte is not None and self._supports_range_header:
            headers["Range"] = f"bytes={start_byte}-"

        if self._api_key:
            headers["Authorization"] = "Basic " + b64encode(
                f":{self._api_key}".encode()
            ).decode()

        return self._ssn.get(
            self.pure_link,
            headers=headers,
            stream=True
        )


# region PixelDrain Folder
@final
class PixelDrainFolderDownload(PixelDrainDownload):
    "For downloading a PixelDrain folder (for PD file, use PixelDrainDownload)"

    identifier: str = 'pd_folder'

    def _convert_to_pure_link(self) -> str:
        self._api_key = None
        self._first_fetch = True
        download_id = self.download_link.rstrip("/").split("/")[-1]
        'https://pixeldrain.com/api/list/{download_id}/zip'
        return Constants.PIXELDRAIN_API_URL + '/list/' + download_id + '/zip'


# region Mega
class MegaDownload(BaseDirectDownload):
    "For downloading a file via Mega"

    identifier: str = 'mega'

    _mega_class: Type[MegaABC] = Mega

    @property
    def size(self) -> int:
        return self._mega.size

    @property
    def progress(self) -> float:
        return self._mega.progress

    @property
    def speed(self) -> float:
        return self._mega.speed

    @property
    def _size(self) -> int:
        return self._mega.size

    @property
    def _progress(self) -> float:
        return self._mega.progress

    @property
    def _speed(self) -> float:
        return self._mega.speed

    @property
    def _pure_link(self) -> str:
        return self._mega.pure_link

    def __init__(
        self,
        download_link: str,

        volume_id: int,
        covered_issues: Union[float, Tuple[float, float], None],

        source_type: DownloadSource,
        source_name: str,

        web_link: Union[str, None],
        web_title: Union[str, None],
        web_sub_title: Union[str, None],

        forced_match: bool = False
    ) -> None:
        LOGGER.debug(
            'Creating mega download: %s',
            download_link
        )

        settings = Settings().sv
        volume = Volume(volume_id)

        self._download_link = download_link
        self._volume_id = volume_id
        self._issue_id = None
        self._covered_issues = covered_issues
        self._source_type = source_type
        self._source_name = source_name
        self._web_link = web_link
        self._web_title = web_title
        self._web_sub_title = web_sub_title

        self._id = None
        self._state = DownloadState.QUEUED_STATE
        self._download_thread = None
        self._download_folder = settings.download_folder

        self._mega = self._mega_class(download_link)

        self._filename_body = ''
        try:
            if isinstance(covered_issues, float):
                self._issue_id = volume.get_issue_from_number(covered_issues).id

            if settings.rename_downloaded_files:
                self._filename_body = generate_issue_name(
                    volume.get_data(),
                    covered_issues
                )

        except IssueNotFound as e:
            if not forced_match:
                raise e

        if not self._filename_body:
            self._filename_body = self._extract_default_filename_body(
                response=None
            )

        self._title = basename(self._filename_body)
        self._files = [self._build_filename(response=None)]
        return

    def _extract_default_filename_body(
        self,
        response: Union[Response, None]
    ) -> str:
        return splitext(self._mega.mega_filename)[0]

    def _extract_extension(self, response: Union[Response, None]) -> str:
        return splitext(self._mega.mega_filename)[1]

    def run(self) -> None:
        self._state = DownloadState.DOWNLOADING_STATE
        ws = WebSocket()
        status_event = QueueStatusEvent(self)
        try:
            self._mega.download(
                self.files[0],
                lambda: ws.emit(status_event)
            )

        except ClientNotWorking:
            self._state = DownloadState.FAILED_STATE

        return

    def stop(self,
        state: DownloadState = DownloadState.CANCELED_STATE
    ) -> None:
        self._state = state
        self._mega.stop()
        return


@final
class MegaFolderDownload(MegaDownload):
    "For downloading a Mega folder (for Mega file, use MegaDownload)"

    identifier: str = 'mega_folder'

    _mega_class = MegaFolder


# region Torrent
@final
class TorrentDownload(ExternalDownload, BaseDirectDownload):
    identifier: str = 'torrent'

    @property
    def external_client(self) -> ExternalDownloadClient:
        return self._external_client

    @external_client.setter
    def external_client(self, value: ExternalDownloadClient) -> None:
        self._external_client = value
        return

    @property
    def external_id(self) -> Union[str, None]:
        return self._external_id

    @property
    def sleep_event(self) -> Event:
        return self._sleep_event

    def __init__(
        self,
        download_link: str,

        volume_id: int,
        covered_issues: Union[float, Tuple[float, float], None],

        source_type: DownloadSource,
        source_name: str,

        web_link: Union[str, None],
        web_title: Union[str, None],
        web_sub_title: Union[str, None],

        forced_match: bool = False,
        external_client: Union[ExternalDownloadClient, None] = None
    ) -> None:
        LOGGER.debug(
            'Creating download: %s',
            download_link
        )

        settings = Settings().sv
        volume = Volume(volume_id)

        self._download_link = self._pure_link = download_link
        self._volume_id = volume_id
        self._issue_id = None
        self._covered_issues = covered_issues
        self._source_type = source_type
        self._source_name = source_name
        self._web_link = web_link
        self._web_title = web_title
        self._web_sub_title = web_sub_title

        self._id = None
        self._state = DownloadState.QUEUED_STATE
        self._progress = 0.0
        self._speed = 0.0
        self._size = -1
        self._download_thread = None
        self._download_folder = settings.download_folder
        self._sleep_event = Event()

        self._original_files: List[str] = []
        self._external_id: Union[str, None] = None
        if external_client:
            self._external_client = external_client
        else:
            self._external_client = ExternalClients.get_least_used_client(
                DownloadType.TORRENT
            )

        try:
            if isinstance(covered_issues, float):
                self._issue_id = volume.get_issue_from_number(covered_issues).id

        except IssueNotFound as e:
            if not forced_match:
                raise e

        # Find name of torrent as that becomes folder that media is
        # downloaded in
        try:
            response = Session().post(
                'https://magnet2torrent.com/upload/',
                data={'magnet': download_link}
            )
            response.raise_for_status()
            if response.headers.get(
                'Content-Type'
            ) != 'application/x-bittorrent':
                raise RequestException

        except RequestException:
            raise LinkBroken(self.download_link)

        torrent_name = get_torrent_info(response.content)[b'name'].decode()

        self._filename_body = ''
        if settings.rename_downloaded_files:
            try:
                self._filename_body = generate_issue_name(
                    volume.get_data(),
                    covered_issues
                )

            except IssueNotFound as e:
                if not forced_match:
                    raise e

        if not self._filename_body:
            self._filename_body = splitext(torrent_name)[0]

        self._title = basename(self._filename_body)
        self._files = [join(self._download_folder, torrent_name)]
        return

    def run(self) -> None:
        self._external_id = self.external_client.add_download(
            self.download_link,
            RemoteMappings.local_to_remote(
                self._external_client.id,
                self._download_folder
            ),
            self.title
        )
        return

    def update_status(self) -> None:
        if not self.external_id:
            return

        torrent_status = self.external_client.get_download(self.external_id)
        if not torrent_status:
            if torrent_status is None:
                self._state = DownloadState.CANCELED_STATE
            return

        self._progress = torrent_status['progress']
        self._speed = torrent_status['speed']
        self._size = torrent_status['size']
        if self.state not in (
            DownloadState.CANCELED_STATE,
            DownloadState.SHUTDOWN_STATE
        ):
            self._state = torrent_status['state']

        return

    def remove_from_client(self, delete_files: bool) -> None:
        if not self.external_id:
            return

        self.external_client.delete_download(self.external_id, delete_files)
        return

    def stop(self,
        state: DownloadState = DownloadState.CANCELED_STATE
    ) -> None:
        self._state = state
        self._sleep_event.set()
        return

    def as_dict(self) -> Dict[str, Any]:
        return {
            **super().as_dict(),
            'client': self.external_client.id if self._external_client else None
        }


# region NZB (Usenet)
@final
class NZBDownload(ExternalDownload, BaseDirectDownload):
    identifier: str = 'nzb'

    @property
    def external_client(self) -> ExternalDownloadClient:
        return self._external_client

    @external_client.setter
    def external_client(self, value: ExternalDownloadClient) -> None:
        self._external_client = value
        return

    @property
    def external_id(self) -> Union[str, None]:
        return self._external_id

    @property
    def sleep_event(self) -> Event:
        return self._sleep_event

    def __init__(
        self,
        download_link: str,

        volume_id: int,
        covered_issues: Union[float, Tuple[float, float], None],

        source_type: DownloadSource,
        source_name: str,

        web_link: Union[str, None],
        web_title: Union[str, None],
        web_sub_title: Union[str, None],

        forced_match: bool = False,
        external_client: Union[ExternalDownloadClient, None] = None
    ) -> None:
        LOGGER.debug('Creating NZB download: %s', download_link)

        settings = Settings().sv
        volume = Volume(volume_id)

        self._download_link = self._pure_link = download_link
        self._volume_id = volume_id
        self._issue_id = None
        self._covered_issues = covered_issues
        self._source_type = source_type
        self._source_name = source_name
        self._web_link = web_link
        self._web_title = web_title
        self._web_sub_title = web_sub_title

        self._id = None
        self._state = DownloadState.QUEUED_STATE
        self._progress = 0.0
        self._speed = 0.0
        self._size = -1
        self._download_thread = None
        self._download_folder = settings.download_folder
        self._sleep_event = Event()

        self._external_id: Union[str, None] = None
        if external_client:
            self._external_client = external_client
        else:
            self._external_client = ExternalClients.get_least_used_client(
                DownloadType.USENET
            )

        try:
            if isinstance(covered_issues, float):
                self._issue_id = volume.get_issue_from_number(covered_issues).id

        except IssueNotFound as e:
            if not forced_match:
                raise e

        self._filename_body = ''
        if settings.rename_downloaded_files and covered_issues is not None:
            try:
                self._filename_body = generate_issue_name(
                    volume.get_data(),
                    covered_issues
                )
            except IssueNotFound as e:
                if not forced_match:
                    raise e

        # Use the indexer's display title as the SABnzbd job name when available.
        # Fall back to URL extraction only if we have nothing better.
        if not self._filename_body:
            if self._web_sub_title:
                self._filename_body = splitext(self._web_sub_title)[0]
            else:
                parsed = urlparse(download_link)
                raw = splitext(parsed.path.rstrip('/').split('/')[-1])[0]
                if not raw or raw.lower() in ('api', 'get', 'download', 'nzb', 'index'):
                    qs = parse_qs(parsed.query)
                    raw = next(
                        (qs[k][0] for k in ('id', 'guid', 'nzbid') if k in qs), ''
                    )
                self._filename_body = unquote_plus(raw) or 'nzb_download'

        self._title = basename(self._filename_body)
        # Files will land in a subfolder named after the job inside download_folder
        self._files = [join(self._download_folder, self._title)]
        return

    def run(self) -> None:
        self._external_id = self.external_client.add_download(
            self.download_link,
            RemoteMappings.local_to_remote(
                self._external_client.id,
                self._download_folder
            ),
            self._title
        )
        return

    def update_status(self) -> None:
        if not self.external_id:
            return

        status = self.external_client.get_download(self.external_id)
        if not status:
            if status is None:
                self._state = DownloadState.CANCELED_STATE
            return

        self._progress = status['progress']
        self._speed = status['speed']
        self._size = status['size']
        if self.state not in (
            DownloadState.CANCELED_STATE,
            DownloadState.SHUTDOWN_STATE
        ):
            self._state = status['state']
        return

    def remove_from_client(self, delete_files: bool) -> None:
        if not self.external_id:
            return
        self.external_client.delete_download(self.external_id, delete_files)
        return

    def stop(self, state: DownloadState = DownloadState.CANCELED_STATE) -> None:
        self._state = state
        self._sleep_event.set()
        return

    def as_dict(self) -> Dict[str, Any]:
        return {
            **super().as_dict(),
            'client': self.external_client.id if self._external_client else None
        }


# region Suwayomi
@final
class SuwayomiDownload(BaseDirectDownload):
    """Download a manga chapter from a self-hosted Suwayomi server.

    The download_link encodes the target as ``suwayomi:{manga_id}:{chapter_id}``.
    ``run()`` triggers the chapter download on the Suwayomi side, waits for
    completion, then fetches page images and assembles a CBZ in the download
    folder.  Post-processing is handled by the standard PostProcessor.success
    pipeline.
    """

    identifier: str = 'suwayomi'

    def __init__(
        self,
        download_link: str,

        volume_id: int,
        covered_issues: Union[float, Tuple[float, float], None],

        source_type: DownloadSource,
        source_name: str,

        web_link: Union[str, None],
        web_title: Union[str, None],
        web_sub_title: Union[str, None],

        forced_match: bool = False,
    ) -> None:
        LOGGER.debug('Creating Suwayomi download: %s', download_link)

        settings = Settings().sv
        volume = Volume(volume_id)

        # Bypass BaseDirectDownload.__init__ — there is no HTTP link to probe.
        self._download_link = download_link
        self._pure_link = download_link
        self._volume_id = volume_id
        self._issue_id = None
        self._covered_issues = covered_issues
        self._source_type = source_type
        self._source_name = source_name
        self._web_link = web_link
        self._web_title = web_title
        self._web_sub_title = web_sub_title

        self._id = None
        self._state = DownloadState.QUEUED_STATE
        self._progress = 0.0
        self._progress_is_percent = True
        self._speed = 0.0
        self._size = -1
        self._bytes_downloaded = 0
        self._last_progress_at = perf_counter()
        self._task_label = 'Queued'
        self._download_thread = None
        self._download_folder = settings.download_folder

        self._stop_event = Event()

        try:
            if isinstance(covered_issues, float):
                self._issue_id = volume.get_issue_from_number(
                    covered_issues
                ).id
        except IssueNotFound as e:
            if not forced_match:
                raise e

        self._filename_body = ''
        if settings.rename_downloaded_files and covered_issues is not None:
            try:
                self._filename_body = generate_issue_name(
                    volume.get_data(), covered_issues
                )
            except IssueNotFound as e:
                if not forced_match:
                    raise e

        if not self._filename_body:
            _, chapter_id = parse_suwayomi_link(download_link)
            self._filename_body = f'suwayomi_chapter_{chapter_id}'

        self._title = basename(self._filename_body)
        cbz_name = '_'.join(self._filename_body.split(sep)) + '.cbz'
        self._files = [join(self._download_folder, cbz_name)]

    def run(self) -> None:
        manga_id, chapter_id = parse_suwayomi_link(self._download_link)
        client = SuwayomiClient()

        self._state = DownloadState.DOWNLOADING_STATE
        self._task_label = 'Enqueuing'
        _emit_download_status(self)

        LOGGER.info(
            'Suwayomi: enqueuing download for manga %d chapter %d',
            manga_id, chapter_id,
        )

        try:
            client.enqueue_download(chapter_id)
        except Exception as e:
            LOGGER.error('Suwayomi: failed to enqueue download: %s', e)
            _set_suwayomi_failure(self, SuwayomiDownloadError(
                'enqueue', type(e).__name__, manga_id=manga_id,
                chapter_id=chapter_id,
            ))
            return

        self._task_label = 'Downloading'
        _emit_download_status(self)

        wait_result = client.wait_for_download(
            manga_id, chapter_id, self._stop_event,
        )
        if wait_result.status is SuwayomiWaitStatus.CANCELED:
            return
        if wait_result.status is not SuwayomiWaitStatus.COMPLETED:
            _set_suwayomi_failure(self, wait_result.failure or {
                'stage': 'wait_for_download',
                'type': wait_result.status.value,
                'manga_id': manga_id,
                'chapter_id': chapter_id,
            })
            return
        chapter = wait_result.chapter or {}

        page_count = chapter.get('pageCount', 0)
        source_order = chapter.get('sourceOrder', 0)
        if page_count <= 0:
            LOGGER.error(
                'Suwayomi: chapter %d has pageCount=%d; cannot create CBZ',
                chapter_id, page_count,
            )
            _set_suwayomi_failure(self, SuwayomiDownloadError(
                'chapter_metadata', 'empty_page_count', manga_id=manga_id,
                chapter_id=chapter_id,
            ))
            return

        LOGGER.info(
            'Suwayomi: chapter %d downloaded (%d pages); building CBZ',
            chapter_id, page_count,
        )

        self._task_label = 'Building CBZ'
        self._progress = 0.0
        self._speed = 0.0
        self._bytes_downloaded = 0
        self._last_progress_at = perf_counter()
        _emit_download_status(self)

        def _on_page(done: int, total: int, bytes_read: int = 0) -> None:
            if total <= 0:
                return
            now = perf_counter()
            elapsed = max(now - self._last_progress_at, 0.001)
            self._last_progress_at = now
            self._bytes_downloaded += max(bytes_read, 0)
            self._size = self._bytes_downloaded
            self._speed = round(max(bytes_read, 0) / elapsed, 2)
            self._progress = round(done / total * 100, 2)
            _emit_download_status(self)

        try:
            ok = client.create_cbz(
                manga_id, source_order, page_count,
                self._files[0], self._stop_event,
                progress_cb=_on_page,
                chapter_id=chapter_id,
            )
        except Exception as e:
            LOGGER.error('Suwayomi: failed to create CBZ: %s', e)
            if self._state not in (
                DownloadState.CANCELED_STATE,
                DownloadState.SHUTDOWN_STATE,
            ):
                _set_suwayomi_failure(self, e)
            return

        if not ok:
            if self._state not in (
                DownloadState.CANCELED_STATE,
                DownloadState.SHUTDOWN_STATE,
            ):
                _set_suwayomi_failure(self, SuwayomiDownloadError(
                    'cbz_assembly', 'incomplete', manga_id=manga_id,
                    chapter_id=chapter_id,
                ))
            return

        LOGGER.info('Suwayomi: CBZ created at %s', self._files[0])

    def stop(
        self,
        state: DownloadState = DownloadState.CANCELED_STATE
    ) -> None:
        self._state = state
        self._stop_event.set()


@final
class SuwayomiVolumeDownload(BaseDirectDownload):
    """Download multiple manga chapters from Suwayomi and merge into one PDF.

    The download_link encodes the target as ``suwayomi:manga_id:ch1,ch2,...,chN``.
    ``run()`` triggers each chapter download on the Suwayomi side, waits for all
    to complete, then fetches page images from all chapters in order and assembles
    a single PDF covering the whole volume.
    """

    identifier: str = 'suwayomi_volume'

    def __init__(
        self,
        download_link: str,
        volume_id: int,
        covered_issues: Union[float, Tuple[float, float], None],
        source_type: DownloadSource,
        source_name: str,
        web_link: Union[str, None],
        web_title: Union[str, None],
        web_sub_title: Union[str, None],
        forced_match: bool = False,
    ) -> None:
        LOGGER.debug('Creating Suwayomi volume download: %s', download_link)

        settings = Settings().sv
        volume = Volume(volume_id)

        # Bypass BaseDirectDownload.__init__ — there is no HTTP link to probe.
        self._download_link = download_link
        self._pure_link = download_link
        self._volume_id = volume_id
        self._issue_id = None
        self._covered_issues = covered_issues
        self._source_type = source_type
        self._source_name = source_name
        self._web_link = web_link
        self._web_title = web_title
        self._web_sub_title = web_sub_title

        self._id = None
        self._state = DownloadState.QUEUED_STATE
        self._progress = 0.0
        self._progress_is_percent = True
        self._speed = 0.0
        self._size = -1
        self._bytes_downloaded = 0
        self._last_progress_at = perf_counter()
        self._task_label = 'Queued'
        self._download_thread = None
        self._download_folder = settings.download_folder

        self._stop_event = Event()

        try:
            if isinstance(covered_issues, float):
                self._issue_id = volume.get_issue_from_number(
                    covered_issues
                ).id
        except IssueNotFound as e:
            if not forced_match:
                raise e

        # Generate filename using naming format
        self._filename_body = ''
        if settings.rename_downloaded_files and covered_issues is not None:
            try:
                self._filename_body = generate_issue_name(
                    volume.get_data(), covered_issues
                )
            except Exception:
                pass

        if not self._filename_body:
            _, chapter_ids = parse_suwayomi_volume_link(download_link)
            self._filename_body = (
                f'suwayomi_volume_{chapter_ids[0]}_{chapter_ids[-1]}'
            )

        self._title = basename(self._filename_body)
        pdf_name = '_'.join(self._filename_body.split('/')) + '.pdf'
        self._files = [join(self._download_folder, pdf_name)]

    def run(self) -> None:
        manga_id, chapter_ids = parse_suwayomi_volume_link(self._download_link)
        client = SuwayomiClient()
        total_chapters = len(chapter_ids)

        self._state = DownloadState.DOWNLOADING_STATE
        self._task_label = 'Preparing'
        _emit_download_status(self)

        # Collect chapter info in order. This phase occupies the first half of
        # the visible progress range; PDF assembly occupies the second half.
        chapter_info: List[Tuple[int, int, int]] = []
        for idx, ch_id in enumerate(chapter_ids):
            self._task_label = f'Downloading {idx + 1}/{total_chapters} ({round(idx / total_chapters * 50)}%)'
            self._progress = round(idx / total_chapters * 50, 2) if total_chapters else 0.0
            _emit_download_status(self)

            LOGGER.info(
                'SuwayomiVolume: enqueuing chapter %d for manga %d',
                ch_id, manga_id,
            )
            try:
                client.enqueue_download(ch_id)
            except Exception as e:
                LOGGER.error(
                    'SuwayomiVolume: enqueue failed for ch %d: %s',
                    ch_id, e,
                )
                _set_suwayomi_failure(self, SuwayomiDownloadError(
                    'enqueue', type(e).__name__, manga_id=manga_id,
                    chapter_id=ch_id,
                ))
                return

            wait_result = client.wait_for_download(
                manga_id, ch_id, self._stop_event,
            )
            if wait_result.status is SuwayomiWaitStatus.CANCELED:
                return
            if wait_result.status is not SuwayomiWaitStatus.COMPLETED:
                _set_suwayomi_failure(self, wait_result.failure or {
                    'stage': 'wait_for_download',
                    'type': wait_result.status.value,
                    'manga_id': manga_id,
                    'chapter_id': ch_id,
                })
                return
            chapter = wait_result.chapter or {}

            source_order = chapter.get('sourceOrder', 0)
            page_count = chapter.get('pageCount', 0)
            if page_count <= 0:
                LOGGER.error(
                    'SuwayomiVolume: ch %d has pageCount=%d; aborting',
                    ch_id, page_count,
                )
                _set_suwayomi_failure(self, SuwayomiDownloadError(
                    'chapter_metadata', 'empty_page_count', manga_id=manga_id,
                    chapter_id=ch_id,
                ))
                return

            chapter_info.append((ch_id, source_order, page_count))
            self._progress = round((idx + 1) / total_chapters * 50, 2) if total_chapters else 0.0
            _emit_download_status(self)

        LOGGER.info(
            'SuwayomiVolume: all %d chapters downloaded; building PDF',
            len(chapter_info),
        )

        self._task_label = 'Assembling PDF'
        self._progress = 50.0
        self._speed = 0.0
        self._bytes_downloaded = 0
        self._last_progress_at = perf_counter()
        _emit_download_status(self)

        def _on_page(done: int, total: int, bytes_read: int = 0) -> None:
            if total <= 0:
                return
            now = perf_counter()
            elapsed = max(now - self._last_progress_at, 0.001)
            self._last_progress_at = now
            self._bytes_downloaded += max(bytes_read, 0)
            self._size = self._bytes_downloaded
            self._speed = round(max(bytes_read, 0) / elapsed, 2)
            self._progress = round(50.0 + (done / total * 50.0), 2)
            _emit_download_status(self)

        try:
            ok = client.create_pdf_from_chapters(
                manga_id, chapter_info,
                self._files[0], self._stop_event,
                progress_cb=_on_page,
            )
        except Exception as e:
            LOGGER.error('SuwayomiVolume: failed to create PDF: %s', e)
            if self._state not in (
                DownloadState.CANCELED_STATE,
                DownloadState.SHUTDOWN_STATE,
            ):
                _set_suwayomi_failure(self, e)
            return

        if not ok:
            if self._state not in (
                DownloadState.CANCELED_STATE,
                DownloadState.SHUTDOWN_STATE,
            ):
                _set_suwayomi_failure(self, SuwayomiDownloadError(
                    'pdf_assembly', 'incomplete', manga_id=manga_id,
                ))
            return

        LOGGER.info('SuwayomiVolume: PDF created at %s', self._files[0])

    def stop(
        self,
        state: DownloadState = DownloadState.CANCELED_STATE
    ) -> None:
        self._state = state
        self._stop_event.set()
