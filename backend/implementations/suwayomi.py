# -*- coding: utf-8 -*-

"""
Suwayomi-Server API client.

Suwayomi exposes a GraphQL API at /api/graphql (primary) and a deprecated
REST API at /api/v1.  We use GraphQL for library/chapter management and the
REST API only for fetching page images.
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from io import BytesIO
from shutil import rmtree
from dataclasses import dataclass
from enum import Enum
from multiprocessing import get_context
from queue import Empty
from threading import Event
from time import monotonic
from typing import Dict, List, Optional, Tuple

from requests import Session
from requests.exceptions import RequestException

from backend.base.logging import LOGGER

# Prefix used in the Kapowarr download_link field for Suwayomi entries.
SUWAYOMI_SCHEME = "suwayomi:"
SUWAYOMI_SOURCE_NAME = "Suwayomi"

# Bounded execution budgets. Tests patch these constants to exercise deadlines.
POLL_INTERVAL = 5.0
CHAPTER_DOWNLOAD_TIMEOUT = 300.0
STATUS_MAX_ERRORS = 3
PAGE_MAX_ATTEMPTS = 3
PAGE_RETRY_BACKOFF = (1.0, 2.0)
PDF_TOTAL_TIMEOUT = 600.0
PDF_ASSEMBLY_TIMEOUT = 120.0
PDF_IMAGE_MAX_DIMENSION = 16_384
PDF_IMAGE_MAX_PIXELS = 40_000_000


def _validate_pdf_image_dimensions(width: int, height: int) -> None:
    """Reject lossless PDF pages that would expand beyond a safe bound."""
    if width <= 0 or height <= 0:
        raise ValueError('image dimensions must be positive')
    if width > PDF_IMAGE_MAX_DIMENSION or height > PDF_IMAGE_MAX_DIMENSION:
        raise ValueError('image dimension exceeds PDF page limit')
    if width * height > PDF_IMAGE_MAX_PIXELS:
        raise ValueError('image pixel count exceeds PDF page limit')


class SuwayomiWaitStatus(Enum):
    COMPLETED = 'completed'
    CANCELED = 'canceled'
    TIMED_OUT = 'timed_out'
    FAILED = 'failed'


@dataclass(frozen=True)
class SuwayomiWaitResult:
    status: SuwayomiWaitStatus
    chapter: Optional[Dict] = None
    failure: Optional[Dict] = None


class SuwayomiDownloadError(RuntimeError):
    """Sanitized, structured failure safe to persist in download history."""

    def __init__(
        self,
        stage: str,
        failure_type: str,
        *,
        manga_id: Optional[int] = None,
        chapter_id: Optional[int] = None,
        source_order: Optional[int] = None,
        page_index: Optional[int] = None,
        status: Optional[int] = None,
        attempts: int = 1,
    ) -> None:
        self.details = {
            'stage': stage,
            'type': failure_type,
            'manga_id': manga_id,
            'chapter_id': chapter_id,
            'source_order': source_order,
            'page_index': page_index,
            'status': status,
            'attempts': attempts,
        }
        # Exclude absent values and never persist exception text, URLs, or credentials.
        self.details = {k: v for k, v in self.details.items() if v is not None}
        super().__init__(f"Suwayomi {stage} failed ({failure_type})")


def _terminate_process(process) -> None:
    """Boundedly terminate, then kill, a stuck multiprocessing worker."""
    if process is None or not process.is_alive():
        return
    process.terminate()
    process.join(timeout=1)
    if process.is_alive():
        process.kill()
        process.join(timeout=1)


def _pdf_assembly_worker(
    page_paths: List[str], output_path: str, result_queue, artifact_dir: str
) -> None:
    """Spawn-safe worker for killable image conversion and PDF merge."""
    try:
        import img2pdf
        from PIL import Image
        from pypdf import PdfReader, PdfWriter

        batch_paths: List[str] = []
        normalized_paths: List[str] = []
        try:
            pdf_page_paths: List[str] = []
            for page_path in page_paths:
                if page_path.lower().endswith(('.jpg', '.jpeg')):
                    pdf_page_paths.append(page_path)
                    continue

                with tempfile.NamedTemporaryFile(
                    delete=False, suffix='.jpg', dir=artifact_dir,
                ) as normalized_file:
                    normalized_path = normalized_file.name
                normalized_paths.append(normalized_path)
                with Image.open(page_path) as image:
                    _validate_pdf_image_dimensions(*image.size)
                    image.seek(0)
                    if image.mode in ('RGBA', 'LA') or (
                        image.mode == 'P' and 'transparency' in image.info
                    ):
                        rgba = image.convert('RGBA')
                        normalized = Image.new('RGB', rgba.size, 'white')
                        normalized.paste(rgba, mask=rgba.getchannel('A'))
                    else:
                        normalized = image.convert('RGB')
                    normalized.save(
                        normalized_path, format='JPEG', quality=90,
                        optimize=True,
                    )
                pdf_page_paths.append(normalized_path)

            for batch_start in range(0, len(pdf_page_paths), 5):
                batch = pdf_page_paths[batch_start:batch_start + 5]
                data = img2pdf.convert(batch)
                with tempfile.NamedTemporaryFile(
                    delete=False, suffix='.pdf', dir=artifact_dir,
                ) as tf:
                    tf.write(data)
                    batch_paths.append(tf.name)

            writer = PdfWriter()
            for batch_path in batch_paths:
                reader = PdfReader(batch_path)
                for page in reader.pages:
                    writer.add_page(page)
            with open(output_path, 'wb') as handle:
                writer.write(handle)
            result_queue.put_nowait({'ok': True})
        finally:
            for batch_path in batch_paths:
                try:
                    os.unlink(batch_path)
                except OSError:
                    pass
            for normalized_path in normalized_paths:
                try:
                    os.unlink(normalized_path)
                except OSError:
                    pass
    except BaseException as exc:
        try:
            result_queue.put_nowait({
                'ok': False,
                'type': type(exc).__name__,
            })
        except Exception:
            pass

def make_suwayomi_link(manga_id: int, chapter_id: int) -> str:
    """Encode manga/chapter IDs as a Kapowarr download_link."""
    return f"suwayomi:{manga_id}:{chapter_id}"


def parse_suwayomi_link(link: str) -> Tuple[int, int]:
    """Decode a suwayomi:M:C link → (manga_id, chapter_id)."""
    _, manga_id, chapter_id = link.split(":")
    return int(manga_id), int(chapter_id)


def make_suwayomi_volume_link(manga_id: int, chapter_ids: List[int]) -> str:
    """Encode manga ID + multiple chapter IDs as a Kapowarr download_link."""
    return f"suwayomi:{manga_id}:{','.join(str(cid) for cid in chapter_ids)}"


def parse_suwayomi_volume_link(link: str) -> Tuple[int, List[int]]:
    """Decode a suwayomi:M:C1,C2,... link → (manga_id, [chapter_ids])."""
    _, manga_id, chapter_list = link.split(":", 2)
    chapter_ids = [int(c) for c in chapter_list.split(",")]
    return int(manga_id), chapter_ids


def is_suwayomi_link(link: str) -> bool:
    return link.startswith(SUWAYOMI_SCHEME)


def is_manga_publisher(publisher: Optional[str]) -> bool:
    """Return True if publisher string identifies a manga source/publisher."""
    if not publisher:
        return False
    pub_lower = publisher.lower().strip()
    if pub_lower == 'mangadex':
        return True
    from backend.implementations.comicvine import (
        _ENGLISH_MANGA_PUBLISHERS, _MANGA_PUBLISHERS
    )
    return pub_lower in _MANGA_PUBLISHERS or pub_lower in _ENGLISH_MANGA_PUBLISHERS


class SuwayomiClient:
    """Thin wrapper around the Suwayomi-Server GraphQL + REST APIs."""

    def __init__(self) -> None:
        from backend.internals.settings import Settings
        sv = Settings().sv
        self._base_url = sv.suwayomi_base_url.rstrip("/")
        self._ssn = Session()
        if sv.suwayomi_username and sv.suwayomi_password:
            self._ssn.auth = (sv.suwayomi_username, sv.suwayomi_password)

    def is_configured(self) -> bool:
        return bool(self._base_url)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _gql(
        self,
        query: str,
        variables: Optional[Dict] = None
    ) -> dict:
        resp = self._ssn.post(
            f"{self._base_url}/api/graphql",
            json={"query": query, "variables": variables or {}},
            timeout=15,
        )
        resp.raise_for_status()
        payload = resp.json()
        if "errors" in payload:
            raise RuntimeError(f"Suwayomi GraphQL error: {payload['errors']}")
        return payload["data"]

    # ------------------------------------------------------------------
    # Library / manga
    # ------------------------------------------------------------------

    def get_library_manga(self) -> List[Dict]:
        """Return all manga in the user's library: [{id, title}, ...]."""
        data = self._gql("""
            query {
                mangas(filter: {inLibrary: {equalTo: true}}) {
                    nodes { id title source { id name lang } }
                }
            }
        """)
        return data["mangas"]["nodes"]

    # ------------------------------------------------------------------
    # Chapters
    # ------------------------------------------------------------------

    def get_chapters(self, manga_id: int) -> List[Dict]:
        """Return all chapters for a manga.

        Each item has: id, mangaId, chapterNumber, isDownloaded,
        pageCount, name, sourceOrder.
        """
        data = self._gql(
            """
            query Chapters($mangaId: Int!) {
                chapters(filter: {mangaId: {equalTo: $mangaId}}) {
                    nodes {
                        id mangaId chapterNumber
                        isDownloaded pageCount
                        name sourceOrder
                    }
                }
            }
            """,
            {"mangaId": manga_id},
        )
        return data["chapters"]["nodes"]

    def get_chapter_info(self, manga_id: int, chapter_id: int) -> Optional[Dict]:
        """Return the chapter dict for a specific chapter ID, or None."""
        for ch in self.get_chapters(manga_id):
            if ch["id"] == chapter_id:
                return ch
        return None

    # ------------------------------------------------------------------
    # Downloads
    # ------------------------------------------------------------------

    def enqueue_download(self, chapter_id: int) -> None:
        """Tell Suwayomi to download a chapter."""
        self._gql(
            """
            mutation EnqueueDownload($id: Int!) {
                enqueueChapterDownload(input: {id: $id}) {
                    downloadStatus { state }
                }
            }
            """,
            {"id": chapter_id},
        )

    def get_download_entry(self, chapter_id: int) -> Optional[Dict]:
        """Return the active downloader entry for a chapter, if present."""
        data = self._gql("""
            query DownloadStatus {
                downloadStatus {
                    queue {
                        state tries
                        chapter { id }
                    }
                }
            }
        """)
        for entry in data['downloadStatus']['queue']:
            if entry.get('chapter', {}).get('id') == chapter_id:
                return entry
        return None

    def wait_for_download(
        self,
        manga_id: int,
        chapter_id: int,
        stop_event: Event,
        timeout: float = CHAPTER_DOWNLOAD_TIMEOUT,
    ) -> SuwayomiWaitResult:
        """Wait for a chapter using a monotonic deadline and typed outcome."""
        deadline = monotonic() + max(timeout, 0.0)
        seen_in_queue = False
        consecutive_errors = 0

        while not stop_event.is_set():
            if monotonic() >= deadline:
                return SuwayomiWaitResult(
                    SuwayomiWaitStatus.TIMED_OUT,
                    failure=SuwayomiDownloadError(
                        'wait_for_download', 'timeout',
                        manga_id=manga_id, chapter_id=chapter_id,
                    ).details,
                )
            try:
                chapter = self.get_chapter_info(manga_id, chapter_id)
                if chapter is None:
                    return SuwayomiWaitResult(
                        SuwayomiWaitStatus.FAILED,
                        failure=SuwayomiDownloadError(
                            'wait_for_download', 'chapter_not_found',
                            manga_id=manga_id, chapter_id=chapter_id,
                        ).details,
                    )
                if chapter['isDownloaded']:
                    return SuwayomiWaitResult(
                        SuwayomiWaitStatus.COMPLETED, chapter=chapter,
                    )

                entry = self.get_download_entry(chapter_id)
                if entry is not None:
                    seen_in_queue = True
                    state = str(entry.get('state', '')).upper()
                    if state == 'ERROR':
                        return SuwayomiWaitResult(
                            SuwayomiWaitStatus.FAILED,
                            failure=SuwayomiDownloadError(
                                'wait_for_download', 'upstream_error',
                                manga_id=manga_id, chapter_id=chapter_id,
                                attempts=int(entry.get('tries') or 1),
                            ).details,
                        )
                elif seen_in_queue:
                    return SuwayomiWaitResult(
                        SuwayomiWaitStatus.FAILED,
                        failure=SuwayomiDownloadError(
                            'wait_for_download', 'dequeued_without_file',
                            manga_id=manga_id, chapter_id=chapter_id,
                        ).details,
                    )
                consecutive_errors = 0
            except (RequestException, RuntimeError, KeyError, TypeError, ValueError) as exc:
                consecutive_errors += 1
                if consecutive_errors >= STATUS_MAX_ERRORS:
                    return SuwayomiWaitResult(
                        SuwayomiWaitStatus.FAILED,
                        failure=SuwayomiDownloadError(
                            'wait_for_download', type(exc).__name__,
                            manga_id=manga_id, chapter_id=chapter_id,
                            attempts=consecutive_errors,
                        ).details,
                    )
                LOGGER.warning(
                    'Suwayomi status poll failed for manga %d chapter %d '
                    '(attempt %d/%d)',
                    manga_id, chapter_id, consecutive_errors, STATUS_MAX_ERRORS,
                )

            remaining = max(0.0, deadline - monotonic())
            if stop_event.wait(min(POLL_INTERVAL, remaining)):
                break

        return SuwayomiWaitResult(SuwayomiWaitStatus.CANCELED)

    # ------------------------------------------------------------------
    # Page images
    # ------------------------------------------------------------------

    def get_page_image(
        self,
        manga_id: int,
        chapter_source_order: int,
        page_index: int,
        timeout: Optional[Tuple[float, float]] = None,
    ) -> bytes:
        """Fetch a single page image via the Suwayomi REST API.

        Suwayomi addresses chapters by their sourceOrder (position) when
        serving page images through the REST endpoint.
        """
        import requests as _requests
        url = (
            f"{self._base_url}/api/v1/manga/{manga_id}"
            f"/chapter/{chapter_source_order}/page/{page_index}"
        )
        resp = _requests.get(
            url,
            auth=self._ssn.auth if self._ssn.auth else None,
            timeout=timeout or (10, 45),
        )
        resp.raise_for_status()
        return resp.content

    def _get_page_with_retry(
        self,
        manga_id: int,
        chapter_source_order: int,
        page_index: int,
        stop_event: Event,
        *,
        chapter_id: Optional[int] = None,
        deadline: Optional[float] = None,
    ) -> bytes:
        """Fetch one page with bounded, cancellation-aware retry/backoff."""
        for attempt in range(1, PAGE_MAX_ATTEMPTS + 1):
            if stop_event.is_set():
                raise SuwayomiDownloadError(
                    'page_fetch', 'canceled', manga_id=manga_id,
                    chapter_id=chapter_id, source_order=chapter_source_order, page_index=page_index,
                    attempts=attempt,
                )
            if deadline is not None and monotonic() >= deadline:
                raise SuwayomiDownloadError(
                    'page_fetch', 'timeout', manga_id=manga_id,
                    chapter_id=chapter_id, source_order=chapter_source_order, page_index=page_index,
                    attempts=attempt,
                )
            try:
                remaining = None if deadline is None else max(
                    0.0, deadline - monotonic()
                )
                if remaining is not None:
                    connect_timeout = min(10.0, max(0.1, remaining * 0.25))
                    read_timeout = min(
                        45.0, max(0.1, remaining - connect_timeout),
                    )
                    request_timeout = (connect_timeout, read_timeout)
                else:
                    request_timeout = None
                data = self.get_page_image(
                    manga_id, chapter_source_order, page_index,
                    timeout=request_timeout,
                )
                if stop_event.is_set():
                    raise SuwayomiDownloadError(
                        'page_fetch', 'canceled', manga_id=manga_id,
                        chapter_id=chapter_id,
                        source_order=chapter_source_order,
                        page_index=page_index, attempts=attempt,
                    )
                if deadline is not None and monotonic() >= deadline:
                    raise SuwayomiDownloadError(
                        'page_fetch', 'timeout', manga_id=manga_id,
                        chapter_id=chapter_id,
                        source_order=chapter_source_order,
                        page_index=page_index, attempts=attempt,
                    )
                try:
                    _detect_image_ext(data)
                except (TypeError, ValueError) as exc:
                    raise SuwayomiDownloadError(
                        'page_fetch', 'invalid_image', manga_id=manga_id,
                        chapter_id=chapter_id,
                        source_order=chapter_source_order,
                        page_index=page_index, attempts=attempt,
                    ) from exc
                return data
            except RequestException as exc:
                response = getattr(exc, 'response', None)
                status = response.status_code if response is not None else None
                retryable = status is None or status == 429 or status >= 500
                if not retryable or attempt >= PAGE_MAX_ATTEMPTS:
                    raise SuwayomiDownloadError(
                        'page_fetch', 'http_error' if status else type(exc).__name__,
                        manga_id=manga_id,
                        chapter_id=chapter_id, source_order=chapter_source_order,
                        page_index=page_index,
                        status=status,
                        attempts=attempt,
                    ) from exc
                delay = PAGE_RETRY_BACKOFF[min(
                    attempt - 1, len(PAGE_RETRY_BACKOFF) - 1
                )]
                LOGGER.warning(
                    'Retrying Suwayomi page %d after status %s '
                    '(attempt %d/%d)',
                    page_index + 1, status or 'network error',
                    attempt + 1, PAGE_MAX_ATTEMPTS,
                )
                if stop_event.wait(delay):
                    raise SuwayomiDownloadError(
                        'page_fetch', 'canceled', manga_id=manga_id,
                        chapter_id=chapter_id, source_order=chapter_source_order,
                        page_index=page_index, attempts=attempt,
                    ) from exc
            except SuwayomiDownloadError:
                raise
            except Exception as exc:
                raise SuwayomiDownloadError(
                    'page_fetch', type(exc).__name__, manga_id=manga_id,
                    chapter_id=chapter_id, source_order=chapter_source_order, page_index=page_index,
                    attempts=attempt,
                ) from exc
        raise AssertionError('unreachable')

    def create_cbz(
        self,
        manga_id: int,
        chapter_source_order: int,
        page_count: int,
        dest_path: str,
        stop_event: Event,
        progress_cb=None,
        chapter_id: Optional[int] = None,
    ) -> bool:
        """Create a CBZ atomically using bounded shared page retries."""
        partial_path = f'{dest_path}.part'
        try:
            with zipfile.ZipFile(partial_path, 'w', zipfile.ZIP_STORED) as zf:
                for index in range(page_count):
                    if stop_event.is_set():
                        return False
                    data = self._get_page_with_retry(
                        manga_id, chapter_source_order, index, stop_event,
                        chapter_id=chapter_id,
                    )
                    ext = _detect_image_ext(data)
                    zf.writestr(f'{index + 1:04d}.{ext}', data)
                    if progress_cb is not None:
                        progress_cb(index + 1, page_count, len(data))
            if stop_event.is_set():
                return False
            os.replace(partial_path, dest_path)
            return True
        finally:
            try:
                os.unlink(partial_path)
            except OSError:
                pass

    def create_pdf_from_chapters(
        self,
        manga_id: int,
        chapters: List[tuple],
        dest_path: str,
        stop_event: Event,
        progress_cb=None,
    ) -> bool:
        """Fetch pages within a hard deadline and assemble in a killable worker."""
        deadline = monotonic() + PDF_TOTAL_TIMEOUT
        normalized_chapters = []
        for chapter in chapters:
            if len(chapter) == 3:
                chapter_id, source_order, page_count = chapter
            else:
                source_order, page_count = chapter
                chapter_id = None
            normalized_chapters.append((chapter_id, source_order, page_count))
        total_pages = sum(item[2] for item in normalized_chapters)
        fetched = 0
        page_paths: List[str] = []
        worker_output: Optional[str] = None
        artifact_dir: Optional[str] = None
        process = None
        result_queue = None

        def _check_budget(stage: str) -> bool:
            if stop_event.is_set():
                return False
            if monotonic() >= deadline:
                raise SuwayomiDownloadError(
                    stage, 'timeout', manga_id=manga_id,
                )
            return True

        try:
            for chapter_id, source_order, page_count in normalized_chapters:
                for page_index in range(page_count):
                    if not _check_budget('page_fetch'):
                        return False
                    data = self._get_page_with_retry(
                        manga_id, source_order, page_index, stop_event,
                        chapter_id=chapter_id, deadline=deadline,
                    )
                    if not _check_budget('page_fetch'):
                        return False
                    ext = _detect_image_ext(data)
                    with tempfile.NamedTemporaryFile(
                        delete=False, suffix=f'.{ext}'
                    ) as handle:
                        handle.write(data)
                        page_paths.append(handle.name)
                    fetched += 1
                    if progress_cb is not None and total_pages > 0:
                        progress_cb(fetched, total_pages, len(data))

            if not page_paths or not _check_budget('pdf_assembly'):
                return False

            output_dir = os.path.dirname(dest_path) or '.'
            artifact_dir = tempfile.mkdtemp(
                prefix='.kapowarr-suwayomi-pdf-', dir=output_dir,
            )
            worker_output = os.path.join(artifact_dir, 'result.pdf')

            context = get_context('spawn')
            result_queue = context.Queue(maxsize=1)
            process = context.Process(
                target=_pdf_assembly_worker,
                args=(
                    page_paths, worker_output, result_queue, artifact_dir,
                ),
                name='SuwayomiPDFAssembly',
            )
            assembly_deadline = min(
                deadline, monotonic() + PDF_ASSEMBLY_TIMEOUT,
            )
            process.start()
            if stop_event.is_set():
                _terminate_process(process)
                return False
            if monotonic() >= assembly_deadline:
                _terminate_process(process)
                raise SuwayomiDownloadError(
                    'pdf_assembly', 'timeout', manga_id=manga_id,
                )

            while process.is_alive():
                process.join(timeout=min(
                    0.2, max(0.0, assembly_deadline - monotonic()),
                ))
                if stop_event.is_set():
                    _terminate_process(process)
                    return False
                if monotonic() >= assembly_deadline:
                    _terminate_process(process)
                    raise SuwayomiDownloadError(
                        'pdf_assembly', 'timeout', manga_id=manga_id,
                    )

            if stop_event.is_set():
                return False
            if monotonic() >= assembly_deadline:
                raise SuwayomiDownloadError(
                    'pdf_assembly', 'timeout', manga_id=manga_id,
                )
            if process.exitcode != 0:
                raise SuwayomiDownloadError(
                    'pdf_assembly', 'worker_exit', manga_id=manga_id,
                    status=process.exitcode,
                )
            try:
                result = result_queue.get(timeout=min(
                    1.0, max(0.01, assembly_deadline - monotonic()),
                ))
            except Empty as exc:
                raise SuwayomiDownloadError(
                    'pdf_assembly', 'missing_result', manga_id=manga_id,
                ) from exc
            if stop_event.is_set():
                return False
            if monotonic() >= assembly_deadline:
                raise SuwayomiDownloadError(
                    'pdf_assembly', 'timeout', manga_id=manga_id,
                )
            if not result.get('ok'):
                raise SuwayomiDownloadError(
                    'pdf_assembly', result.get('type', 'conversion_error'),
                    manga_id=manga_id,
                )
            if not worker_output or not os.path.isfile(worker_output):
                raise SuwayomiDownloadError(
                    'pdf_assembly', 'missing_output', manga_id=manga_id,
                )
            if not _check_budget('pdf_assembly'):
                return False
            os.replace(worker_output, dest_path)
            worker_output = None
            return True
        finally:
            if process is not None and process.is_alive():
                _terminate_process(process)
            if result_queue is not None:
                result_queue.close()
                result_queue.join_thread()
            for path in page_paths:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            if artifact_dir:
                rmtree(artifact_dir, ignore_errors=True)

    # ------------------------------------------------------------------
    # Source search / library sync
    # ------------------------------------------------------------------

    def get_sources(self) -> List[Dict]:
        """Return all installed extension sources: [{id, name, lang}, ...]."""
        data = self._gql("""
            query {
                sources {
                    nodes { id name lang }
                }
            }
        """)
        return data["sources"]["nodes"]

    def search_source(self, source_id: str, title: str) -> List[Dict]:
        """Search one source for manga by title. Returns [{id, title}, ...]."""
        data = self._gql(
            """
            mutation FetchSourceManga($source: LongString!, $query: String!) {
                fetchSourceManga(input: {source: $source, type: SEARCH, query: $query, page: 1}) {
                    mangas { id title }
                }
            }
            """,
            {"source": source_id, "query": title},
        )
        return data["fetchSourceManga"]["mangas"]

    def add_to_library(self, manga_id: int) -> None:
        """Mark a manga as in-library."""
        self._gql(
            """
            mutation UpdateManga($id: Int!) {
                updateManga(input: {id: $id, patch: {inLibrary: true}}) {
                    manga { id }
                }
            }
            """,
            {"id": manga_id},
        )

    def remove_from_library(self, manga_id: int) -> None:
        """Remove a manga from the library."""
        self._gql(
            """
            mutation UpdateManga($id: Int!) {
                updateManga(input: {id: $id, patch: {inLibrary: false}}) {
                    manga { id }
                }
            }
            """,
            {"id": manga_id},
        )

    def fetch_manga_chapters(self, manga_id: int) -> List[Dict]:
        """Fetch the chapter list from the source and return it.

        Uses fetchChapters which synchronously retrieves chapters from the
        extension source and stores them in Suwayomi's database.
        """
        data = self._gql(
            """
            mutation FetchChapters($mangaId: Int!) {
                fetchChapters(input: {mangaId: $mangaId}) {
                    chapters { id chapterNumber sourceOrder name }
                }
            }
            """,
            {"mangaId": manga_id},
        )
        return data["fetchChapters"]["chapters"]

    def sync_manga_to_library(self, title: str) -> bool:
        """Search sources for title (in configured priority order), add first
        matching manga to library.

        Returns True if a manga was added, False otherwise.
        Intended to run in a background thread — all errors are logged, not raised.
        """
        try:
            sources = self.get_sources()
        except Exception as exc:
            LOGGER.debug("Suwayomi: failed to fetch sources: %s", exc)
            return False

        # Filter by configured source priority, if set
        from backend.internals.settings import Settings
        configured_ids = list(Settings().sv.suwayomi_source_ids)
        if configured_ids:
            source_by_id = {s["id"]: s for s in sources}
            ordered = []
            for sid in configured_ids:
                s = source_by_id.get(str(sid))
                if s and s.get("name") != "Local source":
                    ordered.append(s)
            sources = ordered
        else:
            sources = [s for s in sources if s.get("name") != "Local source"]

        title_lower = title.lower()

        for source in sources:
            try:
                results = self.search_source(source["id"], title)
            except Exception as exc:
                LOGGER.debug(
                    "Suwayomi: search failed for source '%s': %s",
                    source.get("name", source["id"]), exc,
                )
                continue

            for manga in results:
                manga_title_lower = manga["title"].lower()
                if title_lower in manga_title_lower or manga_title_lower in title_lower:
                    manga_id = manga["id"]
                    try:
                        self.add_to_library(manga_id)
                    except Exception as exc:
                        LOGGER.debug(
                            "Suwayomi: failed to add '%s' to library: %s",
                            manga["title"], exc,
                        )
                        continue

                    try:
                        chapters = self.fetch_manga_chapters(manga_id)
                    except Exception as exc:
                        LOGGER.debug(
                            "Suwayomi: chapter fetch failed for '%s' via '%s': %s",
                            manga["title"], source.get("name", source["id"]), exc,
                        )
                        chapters = []

                    if not chapters:
                        LOGGER.debug(
                            "Suwayomi: no chapters for '%s' via '%s', trying next source",
                            manga["title"], source.get("name", source["id"]),
                        )
                        try:
                            self.remove_from_library(manga_id)
                        except Exception as exc:
                            LOGGER.debug(
                                "Suwayomi: failed to remove '%s' from library: %s",
                                manga["title"], exc,
                            )
                        continue

                    LOGGER.info(
                        "Suwayomi: added '%s' (id=%d) to library via source '%s' (%d chapters)",
                        manga["title"], manga_id, source.get("name", source["id"]),
                        len(chapters),
                    )
                    return True

        return False

    # ------------------------------------------------------------------
    # Connectivity test
    # ------------------------------------------------------------------

    def test(self) -> None:
        """Raise RequestException if the server is unreachable."""
        resp = self._ssn.get(
            f"{self._base_url}/api/graphql",
            params={"query": "{ __typename }"},
            timeout=5,
        )
        resp.raise_for_status()




def _detect_image_ext(data: bytes) -> str:
    """Structurally verify an image and return its supported extension."""
    if not isinstance(data, bytes):
        raise TypeError('image payload must be bytes')
    try:
        from PIL import Image

        with Image.open(BytesIO(data)) as image:
            image_format = image.format
            image.verify()
    except Exception as exc:
        raise ValueError('invalid image payload') from exc

    extensions = {
        'JPEG': 'jpg',
        'PNG': 'png',
        'GIF': 'gif',
        'WEBP': 'webp',
    }
    try:
        return extensions[image_format]
    except KeyError as exc:
        raise ValueError('unsupported image payload') from exc
