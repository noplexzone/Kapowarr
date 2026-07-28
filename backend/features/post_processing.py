# -*- coding: utf-8 -*-

"""
The post-download processing (a.k.a. post-processing or PP) of downloads.
"""

from __future__ import annotations

from json import dumps as json_dumps
from os.path import basename, exists, isdir, isfile, join, splitext
from time import time
from typing import TYPE_CHECKING, Dict

from backend.base.definitions import (BlocklistReason,
                                      DownloadState, FileConstants)
from backend.base.files import (copy_directory, delete_file_folder,
                                rename_file, set_detected_extension)
from backend.base.logging import LOGGER
from backend.implementations.blocklist import add_to_blocklist
from backend.implementations.conversion import mass_convert
from backend.implementations.converters import extract_files_from_folder
from backend.implementations.download_clients import TorrentDownload
from backend.implementations.file_matching import scan_files
from backend.implementations.file_processing import mass_process_files
from backend.implementations.naming import generate_issue_name, mass_rename
from backend.implementations.volumes import Volume
from backend.internals.db import commit, get_db
from backend.internals.db_models import FilesDB
from backend.internals.settings import Settings

if TYPE_CHECKING:
    from backend.base.definitions import Download


# region General
def reset_file_link(download: TorrentDownload) -> None:
    "Set download.files back to original folder from the copied folder"
    download.files = download._original_files
    return


# region Database
def remove_from_queue(download: Download) -> None:
    "Delete the download from the queue in the database"
    get_db().execute(
        "DELETE FROM download_queue WHERE id = ?",
        (download.id,)
    ).connection.commit()
    return


def add_to_history(download: Download) -> None:
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
        from backend.features.tasks import DownloadBatch  # lazy to avoid circular import
        DownloadBatch.record(
            task_history_id, display_title, success, failure_reason or '',
            covered_issues=download.covered_issues,
            source_type=(
                download.source_type.value
                if getattr(download, '_allow_batch_fallback', True)
                else None
            ),
            download_link=download.download_link,
        )

    return


def add_file_to_database(download: Download) -> None:
    "Register files in database and match to a volume/issue"
    scan_files(
        download.volume_id,
        filepath_filter=download.files,
        update_websocket=True
    )
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
def move_to_dest(download: Download) -> None:
    "Move file/fold from download folder to final destination"
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

    if exists(file_dest):
        LOGGER.warning(
            f'The file/folder {file_dest} already exists; replacing with downloaded file'
        )
        delete_file_folder(file_dest)

    rename_file(download.files[0], file_dest)
    download.files = [file_dest]
    return


def replace_existing_issue_files(download: Download) -> None:
    """Remove old files already linked to the downloaded issue.

    Manual issue downloads are replacement operations. If the new file has a
    different filename from the currently-monitored file, a normal scan would
    otherwise link both files to the same issue and leave them side-by-side.
    """
    issue_id = download.issue_id
    if issue_id is None or not isinstance(download.covered_issues, float):
        return

    new_paths = set(download.files)
    try:
        existing_files = FilesDB.fetch(issue_id=issue_id)
    except Exception as e:
        LOGGER.debug(
            'Could not fetch existing issue files for replacement: issue=%s error=%s',
            issue_id, e,
        )
        return

    replaced_any = False
    for file_data in existing_files:
        filepath = file_data.get('filepath')
        file_id = file_data.get('id')
        if not filepath or filepath in new_paths:
            continue

        LOGGER.info(
            'Replacing existing file for issue %s: %s',
            issue_id, filepath,
        )
        if exists(filepath):
            delete_file_folder(filepath)
        if file_id is not None:
            FilesDB.delete_file(file_id)
        else:
            FilesDB.delete_filepath(filepath)
        replaced_any = True

    if replaced_any:
        commit()

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

    if not download.files:
        return

    scan_files(
        download.volume_id,
        filepath_filter=download.files,
        update_websocket=True
    )

    rename_files = Settings().sv.rename_downloaded_files
    if rename_files:
        download.files = mass_rename(
            download.volume_id,
            filepath_filter=download.files,
            process_individual_files=False
        )

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

    if exists(file_dest):
        LOGGER.warning(
            f'The file/folder {file_dest} already exists; replacing with downloaded file'
        )
        delete_file_folder(file_dest)

    copy_directory(download.files[0], file_dest)

    download.files = extract_files_from_folder(
        file_dest,
        download.volume_id
    )

    if not download.files:
        return

    scan_files(
        download.volume_id,
        filepath_filter=download.files,
        update_websocket=True
    )

    rename_files = Settings().sv.rename_downloaded_files
    if rename_files:
        download.files = mass_rename(
            download.volume_id,
            filepath_filter=download.files,
            process_individual_files=False
        )

    return


# region Extras
def delete_file(download: Download) -> None:
    "Delete file from download folder"
    for f in download.files:
        delete_file_folder(f)
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
                        if exists(dest):
                            delete_file_folder(dest)
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

    pre_rename_files = download.files[:]
    renamed = mass_rename(
        download.volume_id,
        filepath_filter=download.files,
        process_individual_files=False
    )
    if renamed:
        download.files = renamed
    else:
        # mass_rename found none of our files in the DB (e.g. the file still
        # couldn't be matched to an issue after pre-linking). Keep the
        # pre-rename paths so convert_file receives a non-empty filter and
        # doesn't accidentally re-process unrelated volume files.
        LOGGER.warning(
            'NZB post-processing: mass_rename returned no files for volume %d; '
            'files may not be matched to issues: %s',
            download.volume_id, pre_rename_files
        )
        download.files = pre_rename_files


# region Post-Processors
class PostProcessor:
    actions_success = [
        remove_from_queue,
        add_to_history,
        move_to_dest,
        rename_with_proper_extension,
        replace_existing_issue_files,
        add_file_to_database,
        convert_file,
        set_file_properties
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
        remove_from_queue,
        add_to_history,
        delete_file
    ]

    actions_perm_failed = [
        remove_from_queue,
        add_to_history,
        add_dl_to_blocklist,
        delete_file
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
        cls._run_actions(cls.actions_failed, download)
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
        remove_from_queue,
        add_to_history,
        move_torrent_to_dest,
        convert_file,
        set_file_properties
    ]


class PostProcessorTorrentsCopy(PostProcessor):
    actions_success = [
        remove_from_queue,
        delete_file
    ]

    actions_seeding = [
        add_to_history,
        copy_file_torrent,
        convert_file,
        set_file_properties,
        reset_file_link
    ]


class PostProcessorNZB(PostProcessor):
    actions_success = [
        remove_from_queue,
        add_to_history,
        move_nzb_to_dest,
        rename_with_proper_extension,
        replace_existing_issue_files,
        add_file_to_database,
        rename_nzb_files,
        convert_file,
        set_file_properties
    ]

    actions_failed = [
        remove_from_queue,
        add_to_history,
        delete_file,
        add_dl_to_blocklist,
    ]
