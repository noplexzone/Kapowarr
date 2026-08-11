# -*- coding: utf-8 -*-

"""
Background tasks and their handling
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import OrderedDict
from json import dumps as json_dumps, loads as json_loads
from threading import Lock, RLock, Thread, Timer
from time import sleep, time
from typing import Dict, List, Optional, Tuple, Type, Union

from flask import Flask

from backend.base.custom_exceptions import (InvalidComicVineApiKey,
                                            TaskNotDeletable, TaskNotFound)
from backend.base.definitions import DownloadSource, EnqueuingDownloadFailureReason
from backend.base.helpers import Singleton, get_subclasses
from backend.base.logging import LOGGER
from backend.features.download_queue import DownloadHandler
from backend.features.search import auto_search
from backend.implementations.conversion import mass_convert
from backend.implementations.file_matching import scan_files
from backend.implementations.naming import generate_issue_name, mass_rename
from backend.implementations.volumes import Volume, refresh_and_scan
from os.path import basename
from random import uniform
from sqlite3 import OperationalError

from backend.internals.db import close_db, commit, get_db
from backend.internals.db_models import FilesDB
from backend.internals.server import (TaskAddedEvent, TaskEndedEvent,
                                      TaskStatusEvent, WebSocket)

SQLITE_BUSY_CODE = 5
SQLITE_LOCKED_CODE = 6


def _emit_task_event(event) -> None:
    """Best-effort websocket delivery that never blocks task execution."""
    try:
        WebSocket().emit(event)
    except Exception:
        LOGGER.exception('Failed to emit websocket task event')


class Task(ABC):
    stop: bool
    message: str
    action: str
    display_title: str
    category: str
    cancellable: bool = False

    @property
    @abstractmethod
    def volume_id(self) -> Union[int, None]:
        ...

    @property
    @abstractmethod
    def issue_id(self) -> Union[int, None]:
        ...

    @abstractmethod
    def __init__(self, **kwargs) -> None:
        ...

    @abstractmethod
    def run(self) -> Union[None, List[Tuple[str, int, Union[int, None]]]]:
        """Run the task

        Returns:
            Union[None, List[Tuple[str, int, Union[int, None]]]]:
            Either `None` if the task has no result or
            `List[Tuple[str, int, Union[int, None]]]` if the task returns
            search results.
        """
        ...

# =====================
# Issue tasks
# =====================


class AutoSearchIssue(Task):
    "Do an automatic search for an issue"

    stop = False
    message = ''
    action = 'auto_search_issue'
    display_title = 'Auto Search'
    category = 'download'

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> int:
        return self._issue_id

    def __init__(self, volume_id: int, issue_id: int) -> None:
        """Create the task

        Args:
            volume_id (int): The id of the volume in which the issue is
            issue_id (int): The id of the issue to search for
        """
        self._volume_id = volume_id
        self._issue_id = issue_id
        return

    def run(self) -> List[Tuple[str, int, Union[int, None]]]:
        volume = Volume(self._volume_id)
        volume_title = volume.vd.title
        issue_number = volume.get_issue(self._issue_id).get_data().issue_number
        self.message = f'Searching for {volume_title} #{issue_number}'
        _emit_task_event(TaskStatusEvent(self.message, notification=True))

        stats: dict = {'total_found': 0, 'per_issue': [], 'queries': []}
        results = auto_search(self._volume_id, self._issue_id, _stats=stats)
        # Per-issue search: download info is embedded in per_issue entries; no downloads array needed
        self.details = {
            'per_issue': stats['per_issue'],
            'downloads': [],
            'total_found': stats.get('total_found', 0),
            'queries': stats.get('queries', []),
        }
        if results:
            _emit_task_event(TaskStatusEvent(
                f'Found download for {volume_title} #{issue_number}',
                notification=True
            ))
            return [
                (result['link'], self._volume_id, self._issue_id,
                 result.get('display_title', ''), result.get('issue_number'))
                for result in results
            ]
        found = stats.get('total_found', 0)
        if found > 0:
            n = f'{found} result{"s" if found != 1 else ""}'
            _emit_task_event(TaskStatusEvent(
                f'{n} found, 0 matched for {volume_title} #{issue_number}',
                notification=True
            ))
        else:
            _emit_task_event(TaskStatusEvent(
                f'No results found for {volume_title} #{issue_number}',
                notification=True
            ))
        return []


class MassRenameIssue(Task):
    "Trigger a mass rename for an issue"

    stop = False
    message = ''
    action = 'mass_rename_issue'
    display_title = 'Mass Rename'
    category = ''

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> int:
        return self._issue_id

    def __init__(
        self,
        volume_id: int,
        issue_id: int,
        filepath_filter: List[str] = []
    ) -> None:
        """Create the task

        Args:
            volume_id (int): The ID of the volume for which to perform the task.
            issue_id (int): The ID of the issue for which to perform the task.
            filepath_filter (List[str], optional): Only rename files in this
            list.
                Defaults to [].
        """
        self._volume_id = volume_id
        self._issue_id = issue_id
        self.filepath_filter = filepath_filter
        return

    def run(self) -> None:
        volume = Volume(self._volume_id)
        volume_title = volume.vd.title
        issue_number = volume.get_issue(self._issue_id).get_data().issue_number
        self.message = f'Renaming files for {volume_title} #{issue_number}'
        _emit_task_event(TaskStatusEvent(self.message))

        mass_rename(
            self._volume_id,
            self._issue_id,
            filepath_filter=self.filepath_filter,
            update_websocket=True,
            stop_fn=lambda: self.stop
        )

        return


class MassConvertIssue(Task):
    "Trigger a mass convert for an issue"

    stop = False
    message = ''
    action = 'mass_convert_issue'
    display_title = 'Mass Convert'
    category = ''

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> int:
        return self._issue_id

    def __init__(
        self,
        volume_id: int,
        issue_id: int,
        filepath_filter: List[str] = []
    ) -> None:
        """Create the task

        Args:
            volume_id (int): The ID of the volume for which to perform the task.
            issue_id (int): The ID of the issue for which to perform the task.
            filepath_filter (List[str], optional): Only rename files in this
            list.
                Defaults to [].
        """
        self._volume_id = volume_id
        self._issue_id = issue_id
        self.filepath_filter = filepath_filter
        return

    def run(self) -> None:
        volume = Volume(self._volume_id)
        volume_title = volume.vd.title
        issue_number = volume.get_issue(self._issue_id).get_data().issue_number
        self.message = f'Converting files for {volume_title} #{issue_number}'
        _emit_task_event(TaskStatusEvent(self.message))

        mass_convert(
            self._volume_id,
            self._issue_id,
            filepath_filter=self.filepath_filter,
            update_websocket_progress=True,
            update_websocket_files=True
        )

        return

# =====================
# Volume tasks
# =====================


class AutoSearchVolume(Task):
    "Do an automatic search for a volume"

    stop = False
    message = ''
    action = 'auto_search'
    display_title = 'Auto Search'
    category = 'download'

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> None:
        return None

    def __init__(self, volume_id: int) -> None:
        """Create the task

        Args:
            volume_id (int): The id of the volume to search for
        """
        self._volume_id = volume_id
        return

    def run(self) -> List[Tuple[str, int, Union[int, None]]]:
        vol = Volume(self._volume_id)
        volume_title = vol.vd.title
        self.message = f'Searching for {volume_title}'
        _emit_task_event(TaskStatusEvent(self.message, notification=True))

        def _progress(idx: int, total: int) -> None:
            self.message = f'Searching issue {idx + 1}/{total} for {volume_title}'
            _emit_task_event(TaskStatusEvent(self.message))

        stats: dict = {'total_found': 0, 'per_issue': [], 'queries': []}
        results = auto_search(self._volume_id, _stats=stats, _status_cb=_progress)
        # Volume-level (pack) downloads have no per_issue entry; per-issue ones do.
        matched_per_issue = sum(1 for e in stats['per_issue'] if e.get('matched'))
        n_volume_level = max(0, len(results) - matched_per_issue)
        volume_data = vol.get_data()

        def _dl_entry(r: dict) -> dict:
            issue_num = r.get('issue_number')
            filename = ''
            if isinstance(issue_num, float):
                try:
                    filename = generate_issue_name(volume_data, issue_num)
                except Exception:
                    pass
            if not filename:
                filename = r.get('display_title', '')
            return {
                'display_title': r.get('display_title', ''),
                'source': r.get('source', ''),
                'issue_number': issue_num,
                'filename': filename,
            }

        self.details = {
            'per_issue': stats['per_issue'],
            'downloads': [_dl_entry(r) for r in results[:n_volume_level]],
            'total_found': stats.get('total_found', 0),
            'queries': stats.get('queries', []),
        }
        if results:
            n = len(results)
            _emit_task_event(TaskStatusEvent(
                f'Found {n} download{"s" if n != 1 else ""} for {volume_title}',
                notification=True
            ))
            downloads = []
            for result in results:
                issue_id = None
                issue_num = result.get('issue_number')
                if isinstance(issue_num, float):
                    try:
                        issue_id = vol.get_issue_from_number(issue_num).id
                    except Exception:
                        pass
                downloads.append((
                    result['link'], self._volume_id, issue_id,
                    result.get('display_title', ''), issue_num,
                ))
            return downloads
        found = stats.get('total_found', 0)
        if found > 0:
            n = f'{found} result{"s" if found != 1 else ""}'
            _emit_task_event(TaskStatusEvent(
                f'{n} found, 0 matched for {volume_title}',
                notification=True
            ))
        else:
            _emit_task_event(TaskStatusEvent(
                f'No results found for {volume_title}',
                notification=True
            ))
        return []


class RefreshAndScanVolume(Task):
    "Trigger a refresh and scan for a volume"

    stop = False
    message = ''
    action = 'refresh_and_scan'
    display_title = 'Refresh And Scan'
    category = ''

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> None:
        return None

    def __init__(self, volume_id: int, new_title: str | None = None) -> None:
        """Create the task

        Args:
            volume_id (int): The id of the volume for which to perform the task
            new_title (str | None): Override the display title in the status
                message (used when the volume is being rematched and its title
                hasn't been updated in the DB yet).
        """
        self._volume_id = volume_id
        self._new_title = new_title
        return

    def run(self) -> None:
        volume_title = self._new_title or Volume(self._volume_id).vd.title
        self.message = f'Updating info on {volume_title}'
        _emit_task_event(TaskStatusEvent(self.message))

        try:
            refresh_and_scan(self._volume_id, update_websocket=True)
        except InvalidComicVineApiKey:
            pass

        return


class MassRenameVolume(Task):
    "Trigger a mass rename for a volume"

    stop = False
    message = ''
    action = 'mass_rename'
    display_title = 'Mass Rename'
    category = ''

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> None:
        return None

    def __init__(
        self,
        volume_id: int,
        filepath_filter: List[str] = []
    ) -> None:
        """Create the task

        Args:
            volume_id (int): The ID of the volume for which to perform the task.
            filepath_filter (List[str], optional): Only rename files in this
            list.
                Defaults to [].
        """
        self._volume_id = volume_id
        self.filepath_filter = filepath_filter
        return

    def run(self) -> None:
        volume_title = Volume(self._volume_id).vd.title
        self.message = f'Renaming files for {volume_title}'
        _emit_task_event(TaskStatusEvent(self.message))

        mass_rename(
            self._volume_id,
            filepath_filter=self.filepath_filter,
            update_websocket=True,
            stop_fn=lambda: self.stop
        )

        return


class MassConvertVolume(Task):
    "Trigger a mass convert for a volume"

    stop = False
    message = ''
    action = 'mass_convert'
    display_title = 'Mass Convert'
    category = ''

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> None:
        return None

    def __init__(
        self,
        volume_id: int,
        filepath_filter: List[str] = []
    ) -> None:
        """Create the task

        Args:
            volume_id (int): The ID of the volume for which to perform the task.
            filepath_filter (List[str], optional): Only convert files in this
            list.
                Defaults to [].
        """
        self._volume_id = volume_id
        self.filepath_filter = filepath_filter
        return

    def run(self) -> None:
        volume_title = Volume(self._volume_id).vd.title
        self.message = f'Converting files for {volume_title}'
        _emit_task_event(TaskStatusEvent(self.message))

        mass_convert(
            self._volume_id,
            filepath_filter=self.filepath_filter,
            update_websocket_progress=True,
            update_websocket_files=True
        )

        return

class ImportFilesVolume(Task):
    "Import uploaded files into a volume"

    stop = False
    message = ''
    action = 'import_files_volume'
    display_title = 'Import Files'
    category = ''

    @property
    def volume_id(self) -> int:
        return self._volume_id

    @property
    def issue_id(self) -> None:
        return None

    def __init__(self, volume_id: int, filepaths: List[str], match_map: Optional[Dict[str, List[int]]] = None) -> None:
        self._volume_id = volume_id
        self.filepaths = filepaths
        self.match_map = match_map or {}
        return

    def run(self) -> None:
        volume_title = Volume(self._volume_id).vd.title
        self.message = f'Importing files for {volume_title}'
        _emit_task_event(TaskStatusEvent(self.message))

        # Apply user-specified issue matches before scanning
        if self.match_map:
            cursor = get_db()
            for filepath, issue_ids in self.match_map.items():
                if filepath not in self.filepaths:
                    continue
                file_id = FilesDB.add_file(filepath)
                cursor.execute("DELETE FROM issues_files WHERE file_id = ?", (file_id,))
                cursor.execute("DELETE FROM volume_files WHERE file_id = ?", (file_id,))
                for issue_id in issue_ids:
                    cursor.execute(
                        "INSERT INTO issues_files(file_id, issue_id, forced) VALUES (?, ?, 1)",
                        (file_id, issue_id)
                    )
                self.message = f'Force-matched {basename(filepath)} to {len(issue_ids)} issue(s)'
                _emit_task_event(TaskStatusEvent(self.message))
            commit()

        # Register uploaded files in DB, match to issues
        scan_files(
            self._volume_id,
            filepath_filter=self.filepaths,
            update_websocket=True
        )

        # Convert to preferred format (e.g. zip/rar → cbz)
        converted = mass_convert(
            self._volume_id,
            filepath_filter=self.filepaths,
            update_websocket_progress=True,
            update_websocket_files=True,
            process_individual_files=False
        )

        # Rename; if conversion produced new files use those, else original paths
        files_to_rename = converted if converted else self.filepaths
        mass_rename(
            self._volume_id,
            filepath_filter=files_to_rename,
            update_websocket=True
        )

        return


# =====================
# Library tasks
# =====================


class UpdateAll(Task):
    "Trigger a refresh and scan for each volume in the library"

    stop = False
    message = ''
    action = 'update_all'
    display_title = 'Update All'
    category = ''
    cancellable = True

    # In-progress observability (readable while task is running)
    processed_count: int = 0
    total_count: Union[int, None] = None
    phase: Union[str, None] = None
    last_progress_at: Union[float, None] = None

    @property
    def volume_id(self) -> None:
        return None

    @property
    def issue_id(self) -> None:
        return None

    def __init__(self, allow_skipping: bool = False) -> None:
        """Create the task

        Args:
            allow_skipping (bool, optional): Skip volumes that have been updated in the last 24 hours.
                Defaults to False.
        """
        self.allow_skipping = allow_skipping
        return

    def run(self) -> None:
        self.processed_count = 0
        self.total_count = None
        self.phase = None
        self.last_progress_at = time()
        self.message = 'Updating info on all volumes'
        _emit_task_event(TaskStatusEvent(self.message))

        def _on_progress(processed: int, total: int, phase: str) -> None:
            self.processed_count = processed
            self.total_count = total
            self.phase = phase
            self.last_progress_at = time()
            if phase == 'fetching_metadata':
                self.message = (
                    f'Fetching metadata for {total} volume{"s" if total != 1 else ""}'
                )
            elif phase == 'scanning_files':
                self.message = f'Scanning files ({processed}/{total})'

        try:
            refresh_and_scan(
                update_websocket=True,
                allow_skipping=self.allow_skipping,
                on_progress=_on_progress,
                stop_fn=lambda: self.stop,
            )
        except InvalidComicVineApiKey:
            pass

        return


class SearchAll(Task):
    "Trigger an automatic search for each volume in the library"

    stop = False
    message = ''
    action = 'search_all'
    display_title = 'Search All'
    category = 'download'
    cancellable = True

    # In-progress observability (readable while task is running)
    processed_count: int = 0
    total_count: Union[int, None] = None
    last_progress_at: Union[float, None] = None

    @property
    def volume_id(self) -> None:
        return None

    @property
    def issue_id(self) -> None:
        return None

    def __init__(
        self,
        limit: Union[int, None] = None,
        offset: int = 0,
    ) -> None:
        """Create the task.

        Args:
            limit: Process at most this many volumes (None = no limit).
            offset: Skip this many volumes from the start of the monitored list.
        """
        self.limit = limit
        self.offset = offset
        return

    def run(self) -> List[Tuple[str, int, Union[int, None]]]:
        cursor = get_db(force_new=True)
        cursor.execute(
            "SELECT id, title FROM volumes WHERE monitored = 1;"
        )
        rows = list(cursor)

        if self.offset:
            rows = rows[self.offset:]
        if self.limit is not None:
            rows = rows[:self.limit]

        self.total_count = len(rows)
        self.processed_count = 0
        self.last_progress_at = time()

        downloads: List[Tuple[str, int, Union[int, None]]] = []
        per_volume: List[dict] = []
        for volume_id, volume_title in rows:
            if self.stop:
                break
            self.message = (
                f'Searching for {volume_title} '
                f'({self.processed_count + 1}/{self.total_count})'
            )
            _emit_task_event(TaskStatusEvent(self.message))
            stats: dict = {'total_found': 0, 'per_issue': [], 'queries': []}
            try:
                # Get search results and download them. Keep going when one
                # volume fails so a single bad source/query cannot abort the
                # whole scheduled backfill.
                results = auto_search(volume_id, _stats=stats)
                if self.stop:
                    break
            except Exception as exc:
                LOGGER.exception(
                    'Search All failed for volume %s (%s)',
                    volume_id, volume_title
                )
                per_volume.append({
                    'volume_id': volume_id,
                    'volume_title': volume_title,
                    'success': False,
                    'error': type(exc).__name__,
                    'message': str(exc),
                    'total_found': stats.get('total_found', 0),
                    'queries': stats.get('queries', []),
                    'per_issue': stats.get('per_issue', []),
                })
                self.processed_count += 1
                self.last_progress_at = time()
                continue

            per_volume.append({
                'volume_id': volume_id,
                'volume_title': volume_title,
                'success': True,
                'total_found': stats.get('total_found', 0),
                'queries': stats.get('queries', []),
                'download_count': len(results or []),
                'per_issue': stats.get('per_issue', []),
            })
            if results:
                downloads += [
                    (result['link'], volume_id, None,
                     result.get('display_title', ''))
                    for result in results
                ]
            self.processed_count += 1
            self.last_progress_at = time()

        self.details = {
            'per_issue': [
                issue
                for volume in per_volume
                for issue in volume.get('per_issue', [])
            ],
            'downloads': [],
            'per_volume': per_volume,
        }
        return downloads


class BulkLibraryImport(Task):
    "Import a pre-scanned list of series folders using known ComicVine IDs"

    stop = False
    message = ''
    action = 'bulk_library_import'
    display_title = 'Bulk Library Import'
    category = 'manage'

    @property
    def volume_id(self) -> None:
        return None

    @property
    def issue_id(self) -> None:
        return None

    def __init__(self, entries: List[Dict]) -> None:
        """
        Args:
            entries: List of {'folder': str, 'cv_id': int, 'file_title': str}
        """
        self._entries = entries
        self.message = f'Queued bulk import of {len(entries)} volumes'
        return

    def run(self) -> None:
        from asyncio import run as async_run
        from backend.base.custom_exceptions import CVRateLimitReached
        from backend.features.library_import import import_library_entry
        from backend.implementations.comicvine import ComicVine

        total = len(self._entries)

        # Batch-resolve issue IDs → volume IDs before processing any entries.
        # ComicTagger tags files with issue IDs (/4000-X/); Kapowarr needs
        # volume IDs (/4050-X/). 100 issue IDs fit in one CV API call, so
        # 1200 entries only costs ~12 calls here instead of 1200 later.
        issue_indices = [
            (i, int(e['cv_id']))
            for i, e in enumerate(self._entries)
            if e.get('id_type') == 'issue' and e.get('cv_id')
        ]
        if issue_indices:
            n = len(issue_indices)
            self.message = f'Resolving {n} issue ID{"s" if n != 1 else ""} to volume IDs…'
            _emit_task_event(TaskStatusEvent(self.message))
            try:
                issue_ids = [issue_id for _, issue_id in issue_indices]
                mapping = async_run(
                    ComicVine().fetch_volume_ids_for_issues(issue_ids)
                )
                for idx, issue_id in issue_indices:
                    volume_id = mapping.get(issue_id)
                    if volume_id:
                        self._entries[idx] = {
                            **self._entries[idx],
                            'cv_id': volume_id,
                            'id_type': 'volume'
                        }
                    else:
                        LOGGER.warning(
                            'Bulk import: could not resolve issue ID %s to a volume',
                            issue_id
                        )
                        self._entries[idx] = {**self._entries[idx], 'cv_id': None}
            except Exception:
                LOGGER.exception('Bulk import: failed to resolve issue IDs')

        for idx, entry in enumerate(self._entries):
            if self.stop:
                break

            if not entry.get('cv_id'):
                continue

            self.message = f'Importing {idx + 1}/{total}: {entry["file_title"]}'
            _emit_task_event(TaskStatusEvent(self.message))

            retries = 0
            while retries < 3:
                try:
                    import_library_entry(
                        cv_id=int(entry['cv_id']),
                        folder=entry['folder']
                    )
                    break
                except CVRateLimitReached:
                    retries += 1
                    wait_msg = (
                        f'Rate limit hit at {idx + 1}/{total} '
                        f'— waiting 65 min (retry {retries}/3)…'
                    )
                    self.message = wait_msg
                    _emit_task_event(TaskStatusEvent(self.message))
                    sleep(3900)
                except Exception:
                    LOGGER.exception(
                        'Bulk import: failed to import %s', entry['folder']
                    )
                    break

        self.message = f'Bulk import finished: {total} volumes processed'
        _emit_task_event(TaskStatusEvent(self.message))
        return None


# =====================
# Task handling
# =====================
# Maps action attr to class for all tasks
# Only works for classes that directly inherit from Task
task_library: Dict[str, Type[Task]] = {
    c.action: c
    for c in get_subclasses(Task)
}


class _DownloadResultTask:
    """Minimal task-like object used to emit a TaskEndedEvent after a
    download batch finalises (so the frontend refreshes task history)."""
    action = 'download_result'

    def __init__(self, volume_id: Union[int, None]) -> None:
        self.volume_id = volume_id
        self.issue_id = None


class DownloadBatch:
    """Tracks downloads queued by a single auto-search task.

    When every expected download has completed (success or failure) the batch
    writes a ``download_result`` row to ``task_history`` and emits a socket
    event so the frontend refreshes.
    """

    _registry: Dict[int, 'DownloadBatch'] = {}
    _pending_results: Dict[int, List[dict]] = {}
    _completed_ids = OrderedDict()
    _completed_limit = 2048
    _registry_lock: Lock = Lock()

    @classmethod
    def _mark_completed_locked(cls, task_history_id: int) -> None:
        cls._completed_ids[task_history_id] = None
        cls._completed_ids.move_to_end(task_history_id)
        while len(cls._completed_ids) > cls._completed_limit:
            cls._completed_ids.popitem(last=False)

    def __init__(
        self,
        task_history_id: int,
        expected: int,
        volume_id: Union[int, None],
        display_title: str,
        update_existing: bool = False,
    ) -> None:
        self.task_history_id = task_history_id
        self.expected = expected
        self.volume_id = volume_id
        self.display_title = display_title
        self.update_existing = update_existing
        self.results: List[dict] = []
        self._lock: Lock = Lock()
        self._finalized = False

    @classmethod
    def begin(cls, task_history_id: int) -> None:
        """Start a new lifecycle, including after task-history rowid reuse."""
        with cls._registry_lock:
            cls._registry.pop(task_history_id, None)
            cls._pending_results.pop(task_history_id, None)
            cls._completed_ids.pop(task_history_id, None)

    @classmethod
    def register(
        cls,
        task_history_id: int,
        expected: int,
        volume_id: Union[int, None],
        display_title: str,
        update_existing: bool = False,
    ) -> None:
        if expected <= 0:
            return
        batch = cls(
            task_history_id, expected, volume_id, display_title, update_existing
        )
        with cls._registry_lock:
            if task_history_id in cls._completed_ids:
                return
            pending = cls._pending_results.pop(task_history_id, [])
            batch.results.extend(pending)
            finalize = len(batch.results) >= batch.expected
            batch._finalized = finalize
            if finalize:
                cls._mark_completed_locked(task_history_id)
            else:
                cls._registry[task_history_id] = batch
        if finalize:
            try:
                batch._finalize()
            except Exception:
                with cls._registry_lock:
                    cls._completed_ids.pop(task_history_id, None)
                    cls._registry[task_history_id] = batch
                with batch._lock:
                    batch._finalized = False
                raise

    @classmethod
    def record(
        cls,
        task_history_id: int,
        web_title: str,
        success: bool,
        failure_reason: str = '',
        covered_issues: 'Union[float, Tuple[float, float], None]' = None,
        source_type: Union[str, None] = None,
        download_link: str = '',
        result_key: Union[int, None] = None,
    ) -> None:
        result = {
            'title': web_title,
            'success': success,
            'failure_reason': failure_reason,
            '_covered_issues': covered_issues,  # internal; stripped from JSON
            '_source_type': source_type,
            '_download_link': download_link,
            '_result_key': result_key,
        }
        with cls._registry_lock:
            if task_history_id in cls._completed_ids:
                return
            batch = cls._registry.get(task_history_id)
            if not batch:
                # A very fast direct download can finish between queue admission
                # and registration of its expected batch size. Preserve one
                # idempotent outcome per download until registration.
                pending = cls._pending_results.setdefault(task_history_id, [])
                duplicate = (
                    result_key is not None
                    and any(
                        existing.get('_result_key') == result_key
                        for existing in pending
                    )
                )
                if not duplicate:
                    pending.append(result)
                return
        finalize = False
        with batch._lock:
            if batch._finalized:
                return
            duplicate = (
                result_key is not None
                and any(
                    existing.get('_result_key') == result_key
                    for existing in batch.results
                )
            )
            if not duplicate:
                batch.results.append(result)
            if len(batch.results) >= batch.expected:
                batch._finalized = True
                finalize = True
        if finalize:
            with cls._registry_lock:
                if cls._registry.get(task_history_id) is batch:
                    cls._registry.pop(task_history_id, None)
                cls._mark_completed_locked(task_history_id)
            try:
                batch._finalize()
            except Exception:
                with cls._registry_lock:
                    cls._completed_ids.pop(task_history_id, None)
                    cls._registry[task_history_id] = batch
                with batch._lock:
                    batch._finalized = False
                raise

    def _finalize(self) -> None:
        results_for_json = [
            {k: v for k, v in r.items() if not k.startswith('_')}
            for r in self.results
        ]
        details = json_dumps({'results': results_for_json})
        db = None
        try:
            db = get_db()
            if self.update_existing:
                db.execute(
                    "UPDATE task_history SET details=?, run_at=? WHERE rowid=?",
                    (details, round(time()), self.task_history_id),
                ).connection.commit()
            else:
                db.execute(
                    """INSERT INTO task_history
                       (task_name, display_title, run_at, volume_id, details)
                       VALUES (?, ?, ?, ?, ?)""",
                    ('download_result', self.display_title,
                     round(time()), self.volume_id, details),
                ).connection.commit()
        except Exception:
            try:
                if db is not None:
                    db.connection.rollback()
            except Exception:
                LOGGER.exception(
                    'Failed to roll back download_result transaction for '
                    'task_history_id=%d',
                    self.task_history_id,
                )
            LOGGER.exception(
                'Failed to write download_result for task_history_id=%d',
                self.task_history_id,
            )
            raise

        try:
            _emit_task_event(TaskEndedEvent(_DownloadResultTask(self.volume_id)))
        except Exception:
            LOGGER.exception(
                'Failed to emit download_result completion for task_history_id=%d',
                self.task_history_id,
            )
        try:
            self._queue_fallback_searches()
        except Exception:
            LOGGER.exception(
                'Failed to queue fallback searches for task_history_id=%d',
                self.task_history_id,
            )

    def _queue_fallback_searches(self) -> None:
        """Queue AutoSearchIssue tasks for open issues whose pack download failed."""
        try:
            db = get_db()
            handler = TaskHandler()
            queued_issue_ids = set()
            for r in self.results:
                if r['success']:
                    continue
                if r.get('_source_type') != DownloadSource.SUWAYOMI.value:
                    continue
                covered = r.get('_covered_issues')
                if isinstance(covered, float):
                    n_start = n_end = covered
                elif isinstance(covered, tuple):
                    n_start, n_end = covered
                else:
                    continue
                rows = db.execute(
                    """SELECT i.id
                       FROM issues i
                       LEFT JOIN issues_files if ON i.id = if.issue_id
                       WHERE if.file_id IS NULL
                         AND i.volume_id = ?
                         AND i.monitored = 1
                         AND i.calculated_issue_number >= ?
                         AND i.calculated_issue_number <= ?""",
                    (self.volume_id, n_start, n_end),
                ).fetchall()
                added = 0
                for row in rows:
                    issue_id = row['id']
                    if issue_id in queued_issue_ids:
                        continue
                    queued_issue_ids.add(issue_id)
                    handler.add(AutoSearchIssue(self.volume_id, issue_id))
                    added += 1
                LOGGER.info(
                    'Queued %d fallback AutoSearchIssue task(s) for volume %d '
                    'after download failure covering issues %.1f–%.1f',
                    added, self.volume_id, n_start, n_end,
                )
        except Exception:
            LOGGER.exception(
                'Failed to queue fallback searches for task_history_id=%d',
                self.task_history_id,
            )


class TaskHandler(metaclass=Singleton):
    "Note: Singleton"

    queue: List[dict] = []
    task_interval_waiter: Union[Timer, None] = None
    queue_lock = RLock()
    singleton_actions = frozenset(('update_all', 'search_all'))

    def __init__(self) -> None:
        """Setup the handler"""
        handler_context = Flask('handler')
        handler_context.teardown_appcontext(close_db)
        self.context = handler_context.app_context
        return

    def __run_task(self, task: Task) -> None:
        """Run a task

        Args:
            task (Task): The task to run
        """
        LOGGER.debug(f'Running task {task.display_title}')
        with self.context():
            socket = WebSocket()
            try:
                result = task.run()
                cursor = get_db()

                # Note in history
                queued_at = None
                started_at = None
                for entry in self.queue:
                    if entry['task'] is task:
                        queued_at = entry.get('queued_at')
                        started_at = entry.get('started_at')
                        break
                details = getattr(task, 'details', None)
                details_json = json_dumps(details) if details else None
                cursor.execute(
                    """INSERT INTO task_history
                       (task_name, display_title, run_at, queued_at, started_at, volume_id, issue_id, details)
                       VALUES (?,?,?,?,?,?,?,?);""",
                    (task.action, task.display_title, round(time()),
                     queued_at, started_at, task.volume_id, task.issue_id, details_json)
                )

                task_history_id: int = cursor.execute(
                    "SELECT last_insert_rowid()"
                ).fetchone()[0]
                DownloadBatch.begin(task_history_id)

                if not task.stop:
                    if task.category == 'download' and result:
                        queued_count, imm_failures = DownloadHandler().add_multiple(
                            (
                                (
                                    link, volume_id, issue_id, False,
                                    display_title, covered_issues,
                                )
                                for (
                                    link, volume_id, issue_id,
                                    display_title, covered_issues,
                                ) in result
                            ),
                            task_history_id=task_history_id,
                        )

                        # Record links that failed to queue at all
                        if imm_failures:
                            for f in imm_failures:
                                cursor.execute(
                                    """INSERT INTO download_history(
                                        web_title, volume_id, downloaded_at,
                                        success, task_history_id, failure_reason
                                    ) VALUES (?,?,?,?,?,?)""",
                                    (
                                        f['display_title'],
                                        task.volume_id,
                                        round(time()),
                                        False,
                                        task_history_id,
                                        f['reason'],
                                    ),
                                )
                            cursor.connection.commit()

                        total_expected = queued_count + len(imm_failures)
                        DownloadBatch.register(
                            task_history_id,
                            total_expected,
                            task.volume_id,
                            task.display_title,
                        )
                        for f in imm_failures:
                            DownloadBatch.record(
                                task_history_id,
                                f['display_title'],
                                False,
                                f['reason'],
                                covered_issues=f.get('covered_issues'),
                                source_type=f.get('source_type'),
                                download_link=f.get('download_link', ''),
                            )

                    LOGGER.info(f'Finished task {task.display_title}')

            except Exception as exc:
                LOGGER.exception(
                    'An error occured while trying to run a task: ')
                task.message = 'AN ERROR OCCURED'
                _emit_task_event(TaskStatusEvent(task.message))

                queued_at = None
                started_at = None
                for entry in self.queue:
                    if entry['task'] is task:
                        queued_at = entry.get('queued_at')
                        started_at = entry.get('started_at')
                        break

                details = getattr(task, 'details', None) or {}
                if not isinstance(details, dict):
                    details = {'per_issue': details, 'downloads': []}
                details.update({
                    'success': False,
                    'error': type(exc).__name__,
                    'message': str(exc),
                })
                details.setdefault('per_issue', [])
                details.setdefault('downloads', [])

                cursor = get_db()
                cursor.execute(
                    """INSERT INTO task_history
                       (task_name, display_title, run_at, queued_at, started_at, volume_id, issue_id, details)
                       VALUES (?,?,?,?,?,?,?,?);""",
                    (task.action, task.display_title, round(time()),
                     queued_at, started_at, task.volume_id, task.issue_id,
                     json_dumps(details))
                )
                sleep(1.5)

            finally:
                # Completion and cancellation must both release the queue head.
                # Event delivery is best effort and runs only after the next task
                # has been allowed to start.
                with self.queue_lock:
                    if self.queue and self.queue[0].get('task') is task:
                        self.queue.pop(0)
                    else:
                        self.queue[:] = [
                            entry for entry in self.queue
                            if entry.get('task') is not task
                        ]
                    self._process_queue()
                _emit_task_event(TaskEndedEvent(task))

        return

    def _process_queue(self) -> None:
        """Start the queue head exactly once."""
        with self.queue_lock:
            if not self.queue:
                return

            first_entry = self.queue[0]
            if first_entry['status'] != 'queued':
                return
            first_entry['status'] = 'running'
            first_entry['started_at'] = round(time())
            first_entry['thread'].start()
        return

    def add(self, task: Task) -> int:
        """Add a task, returning an existing singleton task when present."""
        LOGGER.debug(f'Adding task to queue: {task.display_title}')
        with self.queue_lock:
            if task.action in self.singleton_actions:
                for entry in self.queue:
                    if entry['task'].action == task.action:
                        LOGGER.info(
                            'Skipped duplicate singleton task %s; existing id=%d',
                            task.action,
                            entry['id'],
                        )
                        return entry['id']

            id = max((entry['id'] for entry in self.queue), default=0) + 1
            task_data = {
                'task': task,
                'id': id,
                'status': 'queued',
                'queued_at': round(time()),
                'started_at': None,
                'thread': Thread(
                    target=self.__run_task,
                    args=(task,),
                    name=f"TaskThread-{id}"
                )
            }
            self.queue.append(task_data)
            LOGGER.info(f'Added task: {task.display_title} ({id})')
            self._process_queue()

        _emit_task_event(TaskAddedEvent(task))
        return id

    @staticmethod
    def task_for_volume_running(volume_id: int) -> bool:
        """Whether or not there is a task in the queue that targets the volume.

        Args:
            volume_id (int): The volume ID to check for.

        Returns:
            bool: Whether or not a task is in the queue targeting the volume.
        """
        return any(
            t
            for t in TaskHandler.queue
            if (isinstance(t['task'], (UpdateAll, SearchAll))
                or t['task'].volume_id == volume_id)
        )

    def __check_intervals(self) -> None:
        "Check if any interval task needs to be run and add to queue if so"
        LOGGER.debug('Checking task intervals')
        with self.context():
            current_time = time()

            cursor = get_db()
            interval_tasks = cursor.execute(
                "SELECT task_name, interval, next_run FROM task_intervals;"
            ).fetchall()
            LOGGER.debug(f'Task intervals: {list(map(dict, interval_tasks))}')
            for task in interval_tasks:
                if task['next_run'] <= current_time:
                    # Add task to queue
                    task_class = task_library[task['task_name']]
                    if task_class is UpdateAll:
                        inst = task_class(allow_skipping=True)
                    else:
                        inst = task_class()
                    self.add(inst)

                    # Update next_run
                    next_run = round(current_time + task['interval'])
                    cursor.execute(
                        "UPDATE task_intervals SET next_run = ? WHERE task_name = ?;",
                        (next_run, task['task_name']))

        self.handle_intervals()
        return

    def handle_intervals(self) -> None:
        "Find next time an interval task needs to be run"
        with self.context():
            next_run = get_db().execute(
                "SELECT MIN(next_run) FROM task_intervals"
            ).fetchone()[0]
        timedelta = max(1, next_run - round(time()) + 1)
        LOGGER.debug(f'Next interval task is in {timedelta} seconds')

        self.task_interval_waiter = Timer(timedelta, self.__check_intervals)
        self.task_interval_waiter.name = "TaskIntervalThread"
        self.task_interval_waiter.start()
        return

    def stop_handle(self) -> None:
        "Stop the task handler without an unbounded shutdown wait."
        LOGGER.debug('Stopping task thread')

        if self.task_interval_waiter:
            self.task_interval_waiter.cancel()

        running_thread = None
        with self.queue_lock:
            for entry in self.queue:
                entry['task'].stop = True
            if self.queue and self.queue[0]['thread'].is_alive():
                running_thread = self.queue[0]['thread']

        if running_thread:
            running_thread.join(timeout=5)
            if running_thread.is_alive():
                LOGGER.warning('Task thread did not stop within 5 seconds')

        return

    def __format_entry(self, task: dict) -> dict:
        """Format a queue entry for API response

        Args:
            t (dict): The queue entry

        Returns:
            dict: The formatted queue entry
        """
        t = task['task']
        volume_title = None
        issue_number = None
        if t.volume_id:
            row = get_db().execute(
                'SELECT title FROM volumes WHERE id = ?', (t.volume_id,)
            ).fetchone()
            if row:
                volume_title = row['title']
        if t.issue_id:
            row = get_db().execute(
                'SELECT issue_number FROM issues WHERE id = ?', (t.issue_id,)
            ).fetchone()
            if row:
                issue_number = row['issue_number']
        result = {
            'id': task['id'],
            'action': t.action,
            'display_title': t.display_title,
            'status': task['status'],
            'message': t.message,
            'volume_id': t.volume_id,
            'volume_title': volume_title,
            'issue_id': t.issue_id,
            'issue_number': issue_number,
            'queued_at': task.get('queued_at'),
            'started_at': task.get('started_at'),
        }
        if isinstance(t, SearchAll):
            last_progress_at = getattr(t, 'last_progress_at', None)
            result['progress'] = {
                'processed_count': getattr(t, 'processed_count', 0),
                'total_count': getattr(t, 'total_count', None),
                'last_progress_at': last_progress_at,
                'seconds_since_progress': (
                    round(time() - last_progress_at)
                    if last_progress_at is not None else None
                ),
            }
        elif isinstance(t, UpdateAll):
            processed = getattr(t, 'processed_count', 0)
            total = getattr(t, 'total_count', None)
            started_at = task.get('started_at')
            eta_seconds = None
            elapsed_seconds = None
            if started_at is not None:
                elapsed_seconds = round(time() - started_at)
                if processed > 0 and total and total > processed:
                    eta_seconds = round(elapsed_seconds / processed * (total - processed))
            last_progress_at = getattr(t, 'last_progress_at', None)
            result['progress'] = {
                'processed_count': processed,
                'total_count': total,
                'phase': getattr(t, 'phase', None),
                'eta_seconds': eta_seconds,
                'elapsed_seconds': elapsed_seconds,
                'last_progress_at': last_progress_at,
                'seconds_since_progress': (
                    round(time() - last_progress_at)
                    if last_progress_at is not None else None
                ),
            }
        return result

    def get_all(self) -> List[dict]:
        """Get all tasks in the queue

        Returns:
            List[dict]: A list with all tasks in the queue.
                Formatted using `self.__format_entry()`.
        """
        return [self.__format_entry(t) for t in self.queue]

    def get_one(self, task_id: int) -> dict:
        """Get one task from the queue based on it's id

        Args:
            task_id (int): The id of the task to get from the queue

        Raises:
            TaskNotFound: The id doesn't match with any task in the queue

        Returns:
            dict: The info of the task in the queue.
                Formatted using `self.__format_entry()`.
        """
        return self.__format_entry(self.__get_raw_entry(task_id))

    def __get_raw_entry(self, task_id: int) -> dict:
        """Get the raw entry from the queue based on it's id

        Args:
            task_id (int): The id of the task to get from the queue

        Raises:
            TaskNotFound: The id doesn't match with any task in the queue

        Returns:
            dict: The raw entry of the task in the queue.
        """
        for entry in self.queue:
            if entry['id'] == task_id:
                return entry
        raise TaskNotFound(task_id)

    def remove(self, task_id: int) -> None:
        """Remove a queued task or request cancellation of a running task."""
        queued_task = None
        running_thread = None
        with self.queue_lock:
            entry = self.__get_raw_entry(task_id)
            task = entry['task']

            if entry['status'] in ('running', 'cancelling'):
                if not getattr(task, 'cancellable', False):
                    raise TaskNotDeletable(task_id)
                task.stop = True
                running_thread = entry['thread']
                if entry['status'] != 'cancelling':
                    entry['status'] = 'cancelling'
                    LOGGER.info(
                        'Requested cancellation: %s (%d)',
                        task.display_title,
                        task_id,
                    )
            else:
                task.stop = True
                self.queue.remove(entry)
                queued_task = task
                LOGGER.info(f'Removed task: {task.display_title} ({task_id})')

        if running_thread:
            running_thread.join(timeout=5)
            if running_thread.is_alive():
                LOGGER.warning(
                    'Task %d is still stopping after cancellation request',
                    task_id,
                )
        elif queued_task:
            _emit_task_event(TaskEndedEvent(queued_task))
        return


def record_and_track_download(
    link: str,
    volume_id: int,
    issue_id: Union[int, None],
    force_match: bool,
    display_title: str = '',
) -> tuple:
    """Reserve a manual link before creating its task-history row."""
    handler = DownloadHandler()
    if not handler.reserve_link(link):
        return [], EnqueuingDownloadFailureReason.ALREADY_QUEUED
    try:
        return _record_and_track_download_reserved(
            handler, link, volume_id, issue_id, force_match, display_title,
        )
    finally:
        handler.release_link(link)


def _record_and_track_download_reserved(
    handler: DownloadHandler,
    link: str,
    volume_id: int,
    issue_id: Union[int, None],
    force_match: bool,
    display_title: str = '',
) -> tuple:
    """Queue a manual download and track its outcome in task history.

    Creates a ``manual_download`` task_history row immediately, then queues
    the download with ``task_history_id`` set so that when it completes the
    row is updated with success/failure details via ``DownloadBatch``.

    Returns the same ``(added, fail_reason)`` tuple as ``DownloadHandler.add()``.
    """
    from asyncio import run as async_run

    db = get_db()
    volume_row = db.execute(
        'SELECT title FROM volumes WHERE id=?', (volume_id,)
    ).fetchone()
    volume_title = volume_row['title'] if volume_row else ''

    task_history_id: Optional[int] = None
    max_attempts = 4
    for attempt in range(max_attempts):
        cursor = None
        try:
            cursor = db.execute(
                """INSERT INTO task_history
                   (task_name, display_title, run_at, volume_id, issue_id)
                   VALUES (?,?,?,?,?)""",
                (
                    'manual_download', 'Manual Download', round(time()),
                    volume_id, issue_id,
                ),
            )
            cursor.connection.commit()
            task_history_id = cursor.lastrowid
            DownloadBatch.begin(task_history_id)
            break
        except OperationalError as exc:
            sqlite_errorcode = getattr(exc, 'sqlite_errorcode', None)
            is_busy = (
                isinstance(sqlite_errorcode, int)
                and sqlite_errorcode & 0xFF in (SQLITE_BUSY_CODE, SQLITE_LOCKED_CODE)
            ) or 'locked' in str(exc).lower()
            connection = cursor.connection if cursor is not None else db.connection
            if connection.in_transaction:
                connection.rollback()
            if not is_busy or attempt + 1 >= max_attempts:
                raise
            delay = 0.1 * (2 ** attempt) + uniform(0.0, 0.05)
            LOGGER.warning(
                'Manual download history admission blocked by SQLite; '
                'retrying attempt %d/%d in %.1fs',
                attempt + 2, max_attempts, delay,
            )
            sleep(delay)

    if task_history_id is None:
        raise RuntimeError('Failed to create manual download history entry')

    try:
        added, fail_reason = async_run(
            handler._add_reserved(
                link, volume_id, issue_id,
                force_match=force_match,
                display_title=display_title,
                task_history_id=task_history_id,
            )
        )
    except Exception as exc:
        DownloadBatch.register(
            task_history_id, 1, volume_id, volume_title,
            update_existing=True,
        )
        DownloadBatch.record(
            task_history_id, link, False,
            f'Admission failed: {type(exc).__name__}',
        )
        raise

    if added:
        DownloadBatch.register(
            task_history_id, len(added), volume_id, volume_title,
            update_existing=True,
        )
    else:
        reason_str = fail_reason.value if fail_reason else 'Unknown error'
        DownloadBatch.register(
            task_history_id, 1, volume_id, volume_title,
            update_existing=True,
        )
        DownloadBatch.record(task_history_id, link, False, reason_str)

    return added, fail_reason


def _normalise_task_history_entries(entries: List[dict]) -> List[dict]:
    db = get_db()
    for entry in entries:
        raw = entry.get('details')
        if raw:
            parsed = json_loads(raw)
            # Backward compat: old entries stored a plain list (per_issue only)
            entry['details'] = (
                parsed
                if isinstance(parsed, dict)
                else {'per_issue': parsed, 'downloads': []}
            )
        else:
            entry['details'] = {'per_issue': [], 'downloads': []}
        entry['volume_title'] = None
        entry['issue_number'] = None
        if entry.get('volume_id'):
            row = db.execute(
                'SELECT title FROM volumes WHERE id = ?', (entry['volume_id'],)
            ).fetchone()
            if row:
                entry['volume_title'] = row['title']
        if entry.get('issue_id'):
            row = db.execute(
                'SELECT issue_number FROM issues WHERE id = ?', (entry['issue_id'],)
            ).fetchone()
            if row:
                entry['issue_number'] = row['issue_number']
    return entries


def get_task_history(
    offset: int = 0,
    task_names: Union[List[str], None] = None,
    page_size: int = 15
) -> List[dict]:
    """Get task history in page-sized blocks."""
    db = get_db()
    params: List[Union[int, str]] = []
    where = ''
    if task_names:
        placeholders = ','.join('?' for _ in task_names)
        where = f'WHERE task_name IN ({placeholders})'
        params.extend(task_names)
    params.append(offset * page_size)
    result = db.execute(
        f"""
        SELECT
            task_name, display_title, run_at,
            queued_at, started_at, volume_id, issue_id, details
        FROM task_history
        {where}
        ORDER BY run_at DESC
        LIMIT {page_size}
        OFFSET ?;
        """,
        tuple(params)
    ).fetchalldict()
    return _normalise_task_history_entries(result)


def get_task_history_count(
    task_names: Union[List[str], None] = None
) -> int:
    """Count task history entries, optionally restricted to task names."""
    db = get_db()
    params: List[str] = []
    where = ''
    if task_names:
        placeholders = ','.join('?' for _ in task_names)
        where = f'WHERE task_name IN ({placeholders})'
        params.extend(task_names)
    return int(db.execute(
        f"SELECT COUNT(*) FROM task_history {where};",
        tuple(params)
    ).fetchone()[0])


def delete_task_history() -> None:
    "Delete the complete task history"
    LOGGER.info(f'Deleting task history')
    get_db().execute("DELETE FROM task_history;")
    return


def get_task_planning() -> List[dict]:
    """Get the planning of each interval task (interval, next run and last run)

    Returns:
        List[dict]: List of interval tasks and their planning
    """
    tasks = get_db().execute(
        """
        SELECT
            i.task_name, interval, next_run, run_at AS last_run
        FROM task_intervals i
        LEFT JOIN (
            SELECT
                task_name,
                MAX(run_at) AS run_at
            FROM task_history
            GROUP BY task_name
        ) h
        ON i.task_name = h.task_name;
        """
    ).fetchalldict()

    for t in tasks:
        t['display_name'] = task_library[t['task_name']].display_title

    return tasks
