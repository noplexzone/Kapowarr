# -*- coding: utf-8 -*-

"""
The post-download processing (a.k.a. post-processing or PP) of downloads.
"""

from __future__ import annotations

from json import dumps as json_dumps
from os.path import basename, exists, isdir, isfile, join, splitext
from threading import RLock, Timer
from time import sleep, time
from typing import TYPE_CHECKING, Dict
from uuid import uuid4

from backend.base.definitions import (BlocklistReason,
                                      DownloadState, FileConstants)
from backend.base.files import (copy_directory, delete_file_folder,
                                rename_file, set_detected_extension)
from backend.base.logging import LOGGER
from backend.implementations.blocklist import add_to_blocklist
from backend.implementations.conversion import mass_convert
from backend.implementations.converters import (
    extract_download_container_archive, extract_files_from_folder,
)
from backend.implementations.download_clients import TorrentDownload
from backend.implementations.file_matching import scan_files
from backend.implementations.file_processing import mass_process_files
from backend.implementations.naming import generate_issue_name, mass_rename
from backend.implementations.post_processing_state import (
    ensure_postprocessing_record, mark_analyzed, mark_applying,
    mark_completed, mark_failed, mark_rolled_back,
    update_postprocessing_state,
)
from backend.implementations.volumes import Volume
from backend.internals.db import commit, get_db
from backend.internals.db_models import FilesDB
from backend.internals.settings import Settings

if TYPE_CHECKING:
    from backend.base.definitions import Download


_PENDING_BATCH_PUBLICATIONS = {}
_PENDING_BATCH_THREADS = set()
_PENDING_BATCH_LOCK = RLock()


def _start_pending_batch_worker(publication_token: str) -> None:
    from backend.internals.server import Server

    with _PENDING_BATCH_LOCK:
        if publication_token not in _PENDING_BATCH_PUBLICATIONS:
            return
        if publication_token in _PENDING_BATCH_THREADS:
            return
        _PENDING_BATCH_THREADS.add(publication_token)

    try:
        thread = Server().get_db_thread(
            target=_retry_pending_batch,
            args=(publication_token,),
            name='PendingDownloadBatch-{}'.format(publication_token),
        )
        thread.daemon = True
        thread.start()
    except Exception:
        with _PENDING_BATCH_LOCK:
            _PENDING_BATCH_THREADS.discard(publication_token)
        LOGGER.exception(
            'Failed to start deferred batch publisher %s; retrying',
            publication_token,
        )
        timer = Timer(
            1.0, _start_pending_batch_worker, args=(publication_token,)
        )
        timer.daemon = True
        timer.start()
    return


def _retry_pending_batch(publication_token: str) -> None:
    from backend.features.tasks import DownloadBatch

    delay = 0.5
    try:
        while True:
            with _PENDING_BATCH_LOCK:
                publication = _PENDING_BATCH_PUBLICATIONS.get(
                    publication_token
                )
            if publication is None:
                return
            pending_batch, pending_kwargs = publication
            try:
                DownloadBatch.record(*pending_batch, **pending_kwargs)
            except Exception:
                LOGGER.exception(
                    'Deferred batch publication failed for token %s; retrying',
                    publication_token,
                )
                sleep(delay)
                delay = min(delay * 2, 30.0)
                continue
            with _PENDING_BATCH_LOCK:
                _PENDING_BATCH_PUBLICATIONS.pop(publication_token, None)
            return
    finally:
        with _PENDING_BATCH_LOCK:
            _PENDING_BATCH_THREADS.discard(publication_token)
            retry_needed = (
                publication_token in _PENDING_BATCH_PUBLICATIONS
            )
        if retry_needed:
            _start_pending_batch_worker(publication_token)


def _schedule_pending_batch(
    pending_batch: tuple, pending_kwargs: dict
) -> None:
    # Tokens are immutable per publication: queue-row IDs can be reused after
    # deletion and must never replace an older pending outcome.
    publication_token = uuid4().hex
    with _PENDING_BATCH_LOCK:
        _PENDING_BATCH_PUBLICATIONS[publication_token] = (
            pending_batch, pending_kwargs
        )
    _start_pending_batch_worker(publication_token)
    return


# region General
def reset_file_link(download: TorrentDownload) -> None:
    "Set download.files back to original folder from the copied folder"
    download.files = download._original_files
    return


# region Database
def _publish_pending_history(download: Download) -> None:
    pending_batch = getattr(download, '_pending_history_batch', None)
    pending_kwargs = getattr(download, '_pending_history_batch_kwargs', {})
    if not pending_batch:
        return

    from backend.features.tasks import DownloadBatch
    for attempt in range(3):
        try:
            DownloadBatch.record(*pending_batch, **pending_kwargs)
            download._pending_history_batch = None
            download._pending_history_batch_kwargs = {}
            return
        except Exception:
            LOGGER.exception(
                'Failed to finalize batch history for download %s '
                '(attempt %d/3)',
                download.id, attempt + 1,
            )
            if attempt < 2:
                sleep(0.1 * (attempt + 1))

    try:
        _schedule_pending_batch(pending_batch, pending_kwargs)
    except Exception:
        # The durable import outcome is already committed. Publication startup
        # must never turn it into a contradictory failed download outcome.
        LOGGER.exception(
            'Failed to schedule retained batch publication for download %s',
            getattr(download, 'id', 'unknown'),
        )
    download._pending_history_batch = None
    download._pending_history_batch_kwargs = {}
    return


def commit_history(download: Download) -> None:
    """Commit pending history before publishing batch details."""
    mark_completed(download)
    connection = get_db().connection
    try:
        connection.commit()
    except Exception:
        connection.rollback()
        download._pending_history_batch = None
        download._pending_history_batch_kwargs = {}
        raise
    download._copy_import_committed = True
    discard_staged_destinations(download)
    _publish_pending_history(download)
    return


def remove_from_queue(download: Download) -> None:
    """Atomically commit pending history and remove the queue row."""
    mark_completed(download)
    connection = get_db().connection
    try:
        connection.execute(
            "DELETE FROM download_queue WHERE id = ?",
            (download.id,)
        )
        connection.commit()
    except Exception:
        connection.rollback()
        download._pending_history_batch = None
        download._pending_history_batch_kwargs = {}
        raise
    discard_staged_destinations(download)
    _publish_pending_history(download)
    return


def add_to_history(download: Download, defer_batch: bool = False) -> None:
    "Add the download to history in the database"
    success = download.state != DownloadState.FAILED_STATE
    failure_detail = getattr(download, '_failure_reason', None)
    if success:
        failure_reason = None
    elif isinstance(failure_detail, dict):
        failure_reason = json_dumps(
            failure_detail, sort_keys=True, separators=(',', ':'),
        )
    elif failure_detail:
        failure_reason = str(failure_detail)
    else:
        failure_reason = 'Download failed'
    task_history_id = getattr(download, 'task_history_id', 0) or 0

    get_db().execute(
        """
        INSERT INTO download_history(
            web_link, web_title, web_sub_title,
            file_title,
            volume_id, issue_id,
            source, source_name, downloaded_at, success,
            task_history_id, failure_reason
        ) VALUES (
            :web_link, :web_title, :web_sub_title,
            :file_title,
            :volume_id, :issue_id,
            :source, :source_name, :downloaded_at, :success,
            :task_history_id, :failure_reason
        );
        """,
        {
            'web_link': download.web_link,
            'web_title': download.web_title,
            'web_sub_title': download.web_sub_title,
            'file_title': download.title,
            'volume_id': download.volume_id,
            'issue_id': download.issue_id,
            'source': download.source_type.value,
            'source_name': download.source_name or None,
            'downloaded_at': round(time()),
            'success': success,
            'task_history_id': task_history_id or None,
            'failure_reason': failure_reason,
        }
    )

    if task_history_id:
        display_title = (
            download.web_sub_title
            or download.web_title
            or download.web_link
            or ''
        )
        batch_args = (
            task_history_id,
            display_title,
            success,
            failure_reason or '',
        )
        batch_kwargs = {
            'covered_issues': download.covered_issues,
            'source_type': (
                download.source_type.value
                if getattr(download, '_allow_batch_fallback', True)
                else None
            ),
            'download_link': download.download_link,
            'result_key': getattr(download, 'id', None),
        }
        if defer_batch:
            # remove_from_queue commits the history INSERT and queue DELETE in
            # one transaction, then publishes batch details after that commit.
            download._pending_history_batch = batch_args
            download._pending_history_batch_kwargs = batch_kwargs
        else:
            from backend.features.tasks import DownloadBatch
            DownloadBatch.record(*batch_args, **batch_kwargs)

    return


def add_to_history_transactional(download: Download) -> None:
    """Defer batch publication until queue/history commit succeeds."""
    add_to_history(download, defer_batch=True)
    return


def add_file_to_database(download: Download) -> None:
    "Register files in database and match to a volume/issue"
    mark_analyzed(download)
    scan_files(
        download.volume_id,
        filepath_filter=download.files,
        update_websocket=True
    )
    filepaths = set(download.files)
    conflicts = get_db().execute(
        """
        SELECT reason, filepath FROM file_match_conflicts
        WHERE volume_id = ? AND resolved_at IS NULL;
        """,
        (download.volume_id,),
    ).fetchalldict()
    matched_conflicts = [
        dict(row) for row in conflicts if row.get('filepath') in filepaths
    ]
    if matched_conflicts:
        update_postprocessing_state(
            download,
            'conflict',
            {'conflicts': matched_conflicts, 'files': list(download.files)},
        )
    else:
        mark_applying(download)
    return


def scan_volume_folder(download: Download) -> None:
    "Scan the full volume folder for new files after an external client download"
    scan_files(download.volume_id, update_websocket=True)
    return


# region Blocklist
def add_dl_to_blocklist(download: Download) -> None:
    "Add the download to the blocklist in the database"
    add_to_blocklist(
        download.web_link,
        download.web_title,
        download.web_sub_title,
        download.download_link,
        download.source_type,
        download.volume_id,
        download.issue_id,
        BlocklistReason.LINK_BROKEN
    )
    return


# region Moving
def _stage_existing_destination(download: Download, destination: str) -> None:
    if not exists(destination):
        return
    backup = destination + '.kapowarr-import-backup-' + uuid4().hex
    LOGGER.warning(
        'Staging existing import destination before replacement: %s',
        destination,
    )
    rename_file(destination, backup)
    backups = getattr(download, '_destination_backups', None)
    if backups is None:
        backups = []
        download._destination_backups = backups
    backups.append((destination, backup))
    return


def restore_staged_destinations(download: Download) -> None:
    backups = getattr(download, '_destination_backups', [])
    for destination, backup in reversed(backups):
        if not exists(backup):
            continue
        if exists(destination):
            delete_file_folder(destination)
        rename_file(backup, destination)
    download._destination_backups = []
    return


def discard_staged_destinations(download: Download) -> None:
    backups = getattr(download, '_destination_backups', [])
    remaining = []
    for destination, backup in backups:
        if not exists(backup):
            continue
        try:
            delete_file_folder(backup)
        except Exception:
            LOGGER.exception(
                'Failed to remove staged import destination %s', backup
            )
            remaining.append((destination, backup))
    download._destination_backups = remaining
    return


def move_to_dest(download: Download) -> None:
    "Move file/fold from download folder to final destination"
    ensure_postprocessing_record(download)
    if not exists(download.files[0]):
        return

    folder = Volume(download.volume_id).vd.folder
    extension = splitext(download.files[0])[1].lower()
    if extension not in FileConstants.SCANNABLE_EXTENSIONS:
        extension = ''

    file_dest = join(
        folder,
        download.filename_body + extension
    )
    LOGGER.debug(
        f'Moving download to final destination: {download}, Dest: {file_dest}'
    )

    # If it takes very long to delete/move the file/folder (because of it's size),
    # the DB is left locked for a long period leading to timeouts.
    commit()

    if download.files[0] == file_dest:
        return
    _stage_existing_destination(download, file_dest)
    rename_file(download.files[0], file_dest)
    download.files = [file_dest]
    return


def replace_existing_issue_files(download: Download) -> None:
    """Replace prior issue files without deleting them before DB commit."""
    issue_id = download.issue_id
    if issue_id is None or not isinstance(download.covered_issues, float):
        return

    new_paths = set(download.files)
    try:
        existing_files = FilesDB.fetch(issue_id=issue_id)
    except Exception as error:
        LOGGER.debug(
            'Could not fetch existing issue files for replacement: '
            'issue=%s error=%s',
            issue_id, error,
        )
        return

    staged_files = []
    replaced_any = False
    connection = get_db().connection
    try:
        for file_data in existing_files:
            filepath = file_data.get('filepath')
            file_id = file_data.get('id')
            if not filepath or filepath in new_paths:
                continue

            LOGGER.info(
                'Replacing existing file for issue %s: %s',
                issue_id, filepath,
            )
            staged_path = None
            if exists(filepath):
                staged_path = (
                    filepath + '.kapowarr-replaced-' + uuid4().hex
                )
                rename_file(filepath, staged_path)
                staged_files.append((filepath, staged_path))

            if file_id is not None:
                FilesDB.delete_file(file_id)
            else:
                FilesDB.delete_filepath(filepath)
            replaced_any = True

        if replaced_any:
            connection.commit()
    except Exception:
        connection.rollback()
        for filepath, staged_path in reversed(staged_files):
            if exists(staged_path):
                try:
                    rename_file(staged_path, filepath)
                except Exception:
                    LOGGER.exception(
                        'Failed to restore replaced issue file %s', filepath
                    )
        raise

    # The old DB rows are committed. Failure to remove a hidden staged file is
    # cleanup debt, not grounds to invalidate an otherwise complete import.
    for filepath, staged_path in staged_files:
        if not exists(staged_path):
            continue
        try:
            delete_file_folder(staged_path)
        except Exception:
            LOGGER.exception(
                'Failed to remove staged replaced issue file %s', staged_path
            )
    return


def move_torrent_to_dest(download: TorrentDownload) -> None:
    """
    Move folder downloaded using torrent from download folder to
    final destination, extract files, scan them, rename them.
    """
    if not exists(download.files[0]):
        return

    move_to_dest(download)

    download.files = extract_files_from_folder(
        download.files[0],
        download.volume_id
    )
    extract_download_container_archives(download)

    if not download.files:
        return

    scan_files(
        download.volume_id,
        filepath_filter=download.files,
        update_websocket=True
    )

    rename_download_files(download)

    return


def copy_file_torrent(download: TorrentDownload) -> None:
    """
    Copy downloaded files to dest. Change download.file to copy.
    Change back using `PPA.reset_file_link()`.
    """
    download._original_files = download.files
    if not exists(download.files[0]):
        return

    folder = Volume(download.volume_id).vd.folder
    file_dest = join(folder, basename(download.files[0]))
    LOGGER.debug(
        f'Copying download to final destination: {download}, Dest: {file_dest}'
    )

    # If it takes very long to delete/copy the folder (because of it's size),
    # the DB is left locked for a long period leading to timeouts.
    commit()

    if download.files[0] == file_dest:
        return
    _stage_existing_destination(download, file_dest)
    copy_directory(download.files[0], file_dest)

    download.files = extract_files_from_folder(
        file_dest,
        download.volume_id
    )
    extract_download_container_archives(download)

    if not download.files:
        return

    scan_files(
        download.volume_id,
        filepath_filter=download.files,
        update_websocket=True
    )

    rename_download_files(download)

    return


# region Extras
def rename_download_files(download: Download) -> None:
    """Rename only this download while preserving unresolved concrete paths."""
    if not Settings().sv.rename_downloaded_files:
        return

    pre_rename_files = download.files[:]
    renamed_files = mass_rename(
        download.volume_id,
        filepath_filter=pre_rename_files,
        process_individual_files=False
    )
    download.files = list(dict.fromkeys(
        [path for path in pre_rename_files if exists(path)] + renamed_files
    ))
    if not renamed_files:
        LOGGER.warning(
            'Post-processing: mass_rename returned no files for volume %d; '
            'files may not be matched to issues: %s',
            download.volume_id, pre_rename_files
        )
    return


def extract_download_container_archives(download: Download) -> None:
    """Expand downloaded issue containers before final-library matching."""
    if not Settings().sv.extract_issue_ranges:
        return

    extracted_files = []
    for file in download.files:
        extracted = extract_download_container_archive(file, download.volume_id)
        if extracted is None:
            extracted_files.append(file)
        else:
            extracted_files.extend(extracted)
    download.files = extracted_files
    return


def delete_file(download: Download) -> None:
    "Delete file from download folder"
    for f in download.files:
        delete_file_folder(f)
    return




def reconcile_failed_import(download: Download) -> None:
    """Restore prior destinations and fully rescan a failed import volume."""
    connection = get_db().connection
    restore_staged_destinations(download)
    scan_files(download.volume_id, update_websocket=True)
    mark_rolled_back(download, {'files': list(download.files)})
    connection.commit()
    return


def rename_with_proper_extension(download: Download) -> None:
    """
    Rename a file with the proper extension based on mimetype. Rescan files
    in case a rename is done.
    """
    renamed_files: Dict[str, str] = {}
    for idx, file in enumerate(download.files):
        if not isfile(file):
            continue

        new_file = set_detected_extension(file)
        if new_file != file:
            rename_file(file, new_file)
            download.files[idx] = new_file
            renamed_files[file] = new_file

    if renamed_files:
        FilesDB.update_filepaths(renamed_files)
        commit()

    return


def convert_file(download: Download) -> None:
    "Convert a file into a different format based on settings"
    if not Settings().sv.convert:
        return

    download.files += mass_convert(
        download.volume_id,
        download.issue_id,
        filepath_filter=download.files,
        update_websocket_files=True,
        process_individual_files=False
    )
    return


def set_file_properties(download: Download) -> None:
    "Process the file to set ownership, permissions and file date"

    mass_process_files(
        download.volume_id,
        download.issue_id
    )
    return


def move_nzb_to_dest(download: Download) -> None:
    """Move completed NZB download files to the volume folder.

    When the download landed in a job folder (SABnzbd's typical layout),
    only comic files are extracted; RAR parts and other debris are deleted
    with the folder.  Falls back to the standard ``move_to_dest`` when the
    path is already a single file.
    """
    ensure_postprocessing_record(download)
    job_path = download.files[0]
    if not exists(job_path):
        return

    if isdir(job_path):
        commit()
        extracted = extract_files_from_folder(job_path, download.volume_id)
        if extracted:
            download.files = extracted
        return

    move_to_dest(download)


def rename_nzb_files(download: Download) -> None:
    "Rename NZB downloaded files to the Kapowarr naming scheme, if enabled"
    if not Settings().sv.rename_downloaded_files:
        return

    # For single-issue downloads, files whose names confused the extractor
    # (e.g. French "T01.L.homme…" parsed as issue 1.12 ≠ 1.0) won't be
    # auto-matched in the DB. Pre-link them using covered_issues so that
    # mass_rename below can find and rename them correctly.
    if isinstance(download.covered_issues, float):
        volume_data = Volume(download.volume_id).get_data()
        try:
            expected_body = generate_issue_name(volume_data, download.covered_issues)
        except Exception:
            expected_body = None

        if expected_body:
            renamed = []
            for file in download.files:
                if not FilesDB.issues_covered(file):
                    ext = splitext(file)[1].lower()
                    dest = join(volume_data.folder, expected_body + ext)
                    if file != dest:
                        _stage_existing_destination(download, dest)
                        rename_file(file, dest)
                        FilesDB.update_filepaths({file: dest})
                        commit()
                        LOGGER.debug('Renamed unmatched NZB file: %s → %s', file, dest)
                    scan_files(
                        download.volume_id,
                        filepath_filter=[dest],
                        update_websocket=True
                    )
                    renamed.append(dest)
                else:
                    renamed.append(file)
            download.files = renamed
        # Fall through to mass_rename to apply the Kapowarr naming scheme
        # to all files (both pre-linked above and already-matched files).

    rename_download_files(download)


# region Post-Processors
class PostProcessor:
    actions_success = [
        move_to_dest,
        rename_with_proper_extension,
        extract_download_container_archives,
        add_file_to_database,
        convert_file,
        set_file_properties,
        replace_existing_issue_files,
        add_to_history_transactional,
        remove_from_queue
    ]

    actions_seeding = []

    actions_canceled = [
        delete_file,
        remove_from_queue
    ]

    actions_shutdown = [
        delete_file
    ]

    actions_failed = [
        delete_file,
        add_to_history_transactional,
        remove_from_queue
    ]

    actions_postprocess_failed = [
        reconcile_failed_import,
        add_to_history_transactional,
        remove_from_queue
    ]

    actions_perm_failed = [
        add_dl_to_blocklist,
        delete_file,
        add_to_history_transactional,
        remove_from_queue
    ]

    @staticmethod
    def _run_actions(actions: list, download) -> None:
        for action in actions:
            action(download)
        return

    @classmethod
    def success(cls, download) -> None:
        LOGGER.info(f'Postprocessing of successful download: {download.id}')
        cls._run_actions(cls.actions_success, download)
        return

    @classmethod
    def seeding(cls, download) -> None:
        LOGGER.info(f'Postprocessing of seeding download: {download.id}')
        cls._run_actions(cls.actions_seeding, download)
        return

    @classmethod
    def canceled(cls, download) -> None:
        LOGGER.info(f'Postprocessing of canceled download: {download.id}')
        cls._run_actions(cls.actions_canceled, download)
        return

    @classmethod
    def shutdown(cls, download) -> None:
        LOGGER.info(f'Postprocessing of shut down download: {download.id}')
        cls._run_actions(cls.actions_shutdown, download)
        return

    @classmethod
    def failed(cls, download) -> None:
        LOGGER.info(f'Postprocessing of failed download: {download.id}')
        mark_failed(download, getattr(download, '_failure_reason', None))
        cls._run_actions(cls.actions_failed, download)
        return

    @classmethod
    def postprocess_failed(cls, download) -> None:
        LOGGER.info(
            f'Postprocessing failure cleanup for download: {download.id}'
        )
        mark_failed(download, getattr(download, '_failure_reason', None))
        cls._run_actions(cls.actions_postprocess_failed, download)
        return

    @classmethod
    def monitoring_failed(cls, download) -> None:
        """Remove a completed COPY item without a contradictory outcome."""
        remove_from_queue(download)
        return

    @classmethod
    def terminal_failed(cls, download) -> None:
        """Persist a sanitized failure when reconciliation itself failed."""
        cls._run_actions([
            add_to_history_transactional,
            remove_from_queue,
        ], download)
        return

    @classmethod
    def perm_failed(cls, download) -> None:
        LOGGER.info(
            f'Postprocessing of permanently failed download: {download.id}'
        )
        cls._run_actions(cls.actions_perm_failed, download)
        return


class PostProcessorTorrentsComplete(PostProcessor):
    actions_success = [
        move_torrent_to_dest,
        convert_file,
        set_file_properties,
        add_to_history_transactional,
        remove_from_queue
    ]


class PostProcessorTorrentsCopy(PostProcessor):
    actions_success = [
        delete_file,
        remove_from_queue
    ]

    actions_seeding = [
        copy_file_torrent,
        convert_file,
        set_file_properties,
        reset_file_link,
        add_to_history_transactional,
        commit_history
    ]


class PostProcessorNZB(PostProcessor):
    actions_success = [
        move_nzb_to_dest,
        rename_with_proper_extension,
        extract_download_container_archives,
        add_file_to_database,
        rename_nzb_files,
        convert_file,
        set_file_properties,
        replace_existing_issue_files,
        add_to_history_transactional,
        remove_from_queue
    ]

    actions_failed = [
        delete_file,
        add_dl_to_blocklist,
        add_to_history_transactional,
        remove_from_queue,
    ]
