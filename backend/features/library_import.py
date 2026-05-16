# -*- coding: utf-8 -*-

from asyncio import run
from glob import glob
from itertools import chain
from os import listdir
from os.path import abspath, basename, dirname, isdir, isfile, join, splitext
from re import match as re_match, search as re_search
from time import sleep
from typing import Any, Dict, List, Tuple, Union
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from backend.base.custom_exceptions import (CVRateLimitReached,
                                            InvalidKeyValue,
                                            VolumeAlreadyAdded)
from backend.base.definitions import (CVFileMapping, FileConstants,
                                      FilenameData, MonitorScheme,
                                      SpecialVersion)
from backend.base.file_extraction import extract_filename_data
from backend.base.files import (change_basefolder, common_folder,
                                delete_empty_parent_folders,
                                folder_is_inside_folder,
                                list_files, rename_file)
from backend.base.helpers import force_suffix
from backend.base.logging import LOGGER
from backend.implementations.comicvine import ComicVine
from backend.implementations.file_matching import scan_files
from backend.implementations.naming import mass_rename
from backend.implementations.root_folders import RootFolders
from backend.implementations.volumes import Library
from backend.internals.db import commit, get_db
from backend.internals.db_models import FilesDB


def create_groups(
    files: Dict[str, FilenameData]
) -> Dict[int, Dict[str, FilenameData]]:
    """Group files together that seem like they are for the same volume.

    Args:
        files (Dict[str, FilenameData]): The files in the form of a mapping from
            their filename to their filename data.

    Returns:
        Dict[int, Dict[str, FilenameData]]: A mapping from the group number
            (which doesn't cary any meaning except for identifying the group)
            to the files that are in the group, where the files are in the form
            of a mapping from the filename to their filename data.
    """
    group_mapping: Dict[int, FilenameData] = {}
    groups: Dict[int, Dict[str, FilenameData]] = {}

    for file, file_data in files.items():
        match_data = file_data.copy()
        del match_data['issue_number'] # type: ignore

        for group_idx, group_data in group_mapping.items():
            if match_data == group_data:
                groups[group_idx][file] = file_data
                break
        else:
            new_group_number = max(groups or (0,)) + 1
            groups.setdefault(new_group_number, {})[file] = file_data
            group_mapping[new_group_number] = match_data

    LOGGER.debug('File groupings: %s', groups)
    return groups


def propose_library_import(
    folder_filter: Union[str, None] = None,
    limit: int = 20,
    limit_parent_folder: bool = False,
    only_english: bool = True
) -> List[Dict[str, Any]]:
    """Get list of unimported files and their suggestion for a matching volume
    on CV.

    Args:
        folder_filter (Union[str, None], optional): Only scan the folders that
            match the given value. Can either be a folder or a glob pattern.
            Defaults to None.

        limit (int, optional): The max amount of folders to scan.
            Defaults to 20.

        limit_parent_folder (bool, optional): Base the folder limit on parent
            folder, not folder. Useful if each issue has their own sub-folder.
            Defaults to False.

        only_english (bool, optional): Only match with english releases.
            Defaults to True.

    Raises:
        InvalidKeyValue: The file filter matches to folders outside
            the root folders.

    Returns:
        List[Dict[str, Any]]: The list of files and their matches.
    """
    LOGGER.info('Loading library import')

    # Get all files in all root folders (with filter applied if given)
    root_folders = {
        abspath(r)
        for r in RootFolders().get_folder_list()
    }

    if folder_filter:
        scan_folders = set((
            f
            for f in glob(folder_filter, recursive=True)
            if not isfile(f) # Glob pattern could match to a file
        ))
        for f in scan_folders:
            if not any(folder_is_inside_folder(r, f) for r in root_folders):
                # Folder is not inside a root folder
                raise InvalidKeyValue('folder_filter', folder_filter)
    else:
        scan_folders = root_folders.copy()

    try:
        all_files = chain.from_iterable(
            list_files(f, FileConstants.CONTENT_EXTENSIONS)
            for f in scan_folders
        )

    except NotADirectoryError:
        raise InvalidKeyValue('folder_filter', folder_filter)

    # Get imported files
    imported_files = {
        f["filepath"]
        for f in FilesDB.fetch()
    }

    # Filter away imported files and apply limit
    folders = set()
    image_folders = set()
    unimported_files: Dict[str, FilenameData] = {}
    for f in all_files:
        if f in imported_files:
            continue

        d = abspath(dirname(f))
        if d in root_folders:
            # File directly in root folder is not allowed
            continue

        file_data = extract_filename_data(f, prefer_folder_year=True)

        if (
            f.endswith(FileConstants.IMAGE_EXTENSIONS)
            and file_data["special_version"] != SpecialVersion.COVER
        ):
            if d in image_folders:
                continue
            image_folders.add(d)
            d, f = dirname(d), d

        folders.add(
            dirname(d)
            if limit_parent_folder else
            d
        )

        if len(folders) > limit:
            break

        unimported_files[f] = file_data

    # Sort by filename
    unimported_files = {
        f: d
        for f, d in sorted(
            unimported_files.items(),
            key=lambda e: basename(e[0])
        )
    }

    # Find a match for the groups on CV
    group_to_files = create_groups(unimported_files)
    group_to_cv = run(ComicVine().filenames_to_cvs(
        group_to_files,
        only_english=only_english
    ))

    # Build result
    result = [
        {
            'filepath': file,
            'file_title': (
                splitext(basename(file))[0]
                if isfile(file) else
                basename(file)
            ),
            'cv': group_to_cv[group_number],
            'group_number': group_number
        }
        for group_number, files in group_to_files.items()
        for file in files
    ]

    return result


def _folder_name_to_cv_id(folder_name: str) -> Union[Tuple[int, str], None]:
    """Search ComicVine by title (and year) extracted from a folder name.

    Parses the common "Series Title (Year)" convention, searches CV for the
    title, then picks the result whose start_year matches. If multiple results
    share the same year the one with the most issues wins (most likely the main
    series rather than a reprint/special). Returns (cv_id, 'volume') or None.
    """
    m = re_match(r'^(.+?)\s*\((\d{4})\)\s*$', folder_name)
    if m:
        title = m.group(1).strip()
        year  = m.group(2)
    else:
        title = folder_name
        year  = None

    for attempt in range(2):
        try:
            results = run(ComicVine().search_volumes(title))
            break
        except CVRateLimitReached:
            if attempt == 0:
                LOGGER.warning(
                    'Bulk scan title-match: rate limit hit for "%s", '
                    'waiting 60 s before retry', title
                )
                sleep(60)
            else:
                LOGGER.warning(
                    'Bulk scan title-match: rate limit hit twice for "%s", '
                    'skipping', title
                )
                return None
        except Exception:
            return None
    else:
        return None

    if not results:
        return None

    if year is not None:
        year_matches = [r for r in results if str(r.get('year') or '') == year]
        if year_matches:
            best = max(year_matches, key=lambda r: r.get('issue_count') or 0)
            return best['comicvine_id'], 'volume'

    # No year in folder name or no exact year match — return first result
    return results[0]['comicvine_id'], 'volume'


def read_comicinfo_cv_id(cbz_path: str) -> Union[Tuple[int, str], None]:
    """Extract a ComicVine ID from ComicInfo.xml inside a CBZ file.

    Returns (cv_id, id_type) where id_type is 'volume' or 'issue', or None.

    Recognised formats:
    - Mylar    Notes: "[CVDB:123456]"              → volume ID
    - Mylar    Web:   "/4050-123456/"              → volume ID
    - ComicTagger Notes: "[Issue ID 460960]"       → issue ID
    - ComicTagger Web:   "/4000-460960/"           → issue ID
    """
    try:
        with ZipFile(cbz_path, 'r') as z:
            ci_name = next(
                (n for n in z.namelist() if n.lower().endswith('comicinfo.xml')),
                None
            )
            if not ci_name:
                return None
            xml_bytes = z.read(ci_name)
            root = ElementTree.fromstring(xml_bytes)

            notes = root.findtext('Notes') or ''
            m = re_search(r'\[CVDB:(\d+)\]', notes, flags=2)
            if m:
                return int(m.group(1)), 'volume'

            m = re_search(r'\[Issue ID (\d+)\]', notes, flags=2)
            if m:
                return int(m.group(1)), 'issue'

            web = root.findtext('Web') or ''
            m = re_search(r'/4050-(\d+)/', web)
            if m:
                return int(m.group(1)), 'volume'

            m = re_search(r'/4000-(\d+)/', web)
            if m:
                return int(m.group(1)), 'issue'

    except (BadZipFile, ElementTree.ParseError, OSError):
        pass
    except Exception:
        LOGGER.debug('Unexpected error reading ComicInfo from %s', cbz_path)
    return None


def _get_existing_volume_folders() -> set:
    """Return the set of folder paths already used by volumes in the library."""
    rows = get_db().execute("SELECT folder FROM volumes;").fetchall()
    return {force_suffix(r[0]) for r in rows}


def prepare_bulk_scan(
    folder_filter: Union[str, None] = None
) -> tuple:
    """Validate folder_filter and return (scan_roots, existing_folders).

    Raises InvalidKeyValue if folder_filter points outside a root folder.
    Call this before starting the scan so errors surface before streaming begins.
    """
    root_folders = {abspath(r) for r in RootFolders().get_folder_list()}

    if folder_filter:
        scan_roots = set(
            f for f in glob(folder_filter, recursive=True) if not isfile(f)
        )
        for f in scan_roots:
            if not any(folder_is_inside_folder(r, f) for r in root_folders):
                raise InvalidKeyValue('folder_filter', folder_filter)
    else:
        scan_roots = root_folders.copy()

    existing_folders = _get_existing_volume_folders()
    return scan_roots, existing_folders


def generate_bulk_scan(
    scan_roots: set,
    existing_folders: set,
    fuzzy_fallback: bool = False
):
    """Generator that yields one result dict per unimported series folder.

    Yields dicts with keys: folder, file_title, cv_id (int or None),
    id_type, and match_type ('comicinfo', 'title', or None).

    Args:
        scan_roots: Root directories to scan.
        existing_folders: Folders already in the library (skipped).
        fuzzy_fallback: When True and no ComicInfo CV ID is found, attempt a
            title-based CV search using the folder name as a fallback.
    """
    for root in sorted(scan_roots):
        try:
            entries = sorted(listdir(root))
        except OSError:
            continue

        for entry in entries:
            folder = join(root, entry)
            if not isdir(folder):
                continue
            if force_suffix(abspath(folder)) in existing_folders:
                continue

            cv_id = None
            id_type = None
            match_type = None

            try:
                for cbz in list_files(folder, ('.cbz',)):
                    found = read_comicinfo_cv_id(cbz)
                    if found is not None:
                        cv_id, id_type = found
                        match_type = 'comicinfo'
                        break
            except Exception:
                pass

            if cv_id is None and fuzzy_fallback:
                found = _folder_name_to_cv_id(entry)
                if found is not None:
                    cv_id, id_type = found
                    match_type = 'title'

            LOGGER.debug(
                'Bulk scan: %s → %s (%s)',
                entry,
                f'CV {id_type} ID {cv_id}' if cv_id else 'no CV ID found',
                match_type or 'none'
            )
            yield {
                'folder': folder,
                'file_title': entry,
                'cv_id': cv_id,
                'id_type': id_type,
                'match_type': match_type
            }


def bulk_propose_library_import(
    folder_filter: Union[str, None] = None
) -> List[Dict[str, Any]]:
    """Non-streaming wrapper around prepare_bulk_scan + generate_bulk_scan."""
    scan_roots, existing_folders = prepare_bulk_scan(folder_filter)
    results = list(generate_bulk_scan(scan_roots, existing_folders))
    LOGGER.info(
        'Bulk scan complete: %d folders, %d with CV IDs',
        len(results), sum(1 for r in results if r['cv_id'])
    )
    return results


def import_library_entry(
    cv_id: int,
    folder: str,
    rename_files: bool = False
) -> None:
    """Import a single series folder using a known ComicVine ID.

    Intended for bulk imports where the CV ID was extracted from ComicInfo.xml,
    so no CV search API call is needed for matching.
    """
    root_folders = RootFolders().get_all()
    folder = abspath(folder)

    for root_folder in root_folders:
        if folder_is_inside_folder(root_folder.folder, folder):
            break
    else:
        LOGGER.warning('Bulk import: %s is not inside any root folder', folder)
        return

    try:
        volume_id = Library.add(
            comicvine_id=cv_id,
            root_folder_id=root_folder.id,
            monitored=True,
            monitor_scheme=MonitorScheme.ALL,
            monitor_new_issues=True,
            volume_folder=folder if not rename_files else None
        )
        commit()

    except VolumeAlreadyAdded as e:
        volume_id = e.volume_id

    scan_files(volume_id, update_websocket=True)

    if rename_files:
        mass_rename(volume_id)

    return


def import_library(
    matches: List[CVFileMapping],
    rename_files: bool = False
) -> None:
    """Add volume to library and import linked files.

    Args:
        matches (List[CVFileMapping]): List of file mappings.

        rename_files (bool, optional): Trigger a rename after importing files.
            Defaults to False.
    """
    LOGGER.info('Starting library import')

    cvid_to_filepath: Dict[int, List[str]] = {}
    for m in matches:
        cvid_to_filepath.setdefault(m['id'], []).append(m['filepath'])
    LOGGER.debug(f'id_to_filepath: {cvid_to_filepath}')

    root_folders = RootFolders().get_all()
    for cv_id, files in cvid_to_filepath.items():
        # Find root folder that media is in
        for root_folder in root_folders:
            if folder_is_inside_folder(root_folder.folder, files[0]):
                break
        else:
            continue

        lcf = common_folder(files)
        if not rename_files and force_suffix(lcf) == root_folder.folder:
            # Back out. Volume folder will be equal to root folder.
            continue

        volume_already_added = False

        try:
            volume_id = Library.add(
                comicvine_id=cv_id,
                root_folder_id=root_folder.id,
                monitored=True,
                monitor_scheme=MonitorScheme.ALL,
                monitor_new_issues=True,
                volume_folder=lcf if not rename_files else None
            )
            commit()

        except VolumeAlreadyAdded as e:
            # The volume that the files are for is already in the library, while
            # the files aren't matched to it. This has two reasons:
            # 1. The files are for an existing volume but in a common folder.
            #    Like some users that download files externally and put them all
            #    in a to-be-imported folder. Their idea is that they use LI to
            #    move and rename the files to the proper volume folder because
            #    they don't want to move it themselves, even though the volume
            #    is already in their library.
            # 2. The files matched to the wrong volume, and the wrong volume
            #    happens to already be in the library.
            # The propability of bullet 1 happening is quite low, so moving the
            # files into the volume folder is worth more to users of bullet 1
            # than it is a bad thing for the users that experience bullet 2. So
            # solution is to move the file to the volume folder of the match,
            # and rename if that was chosen.
            volume_already_added = True
            volume_id = e.volume_id

        except CVRateLimitReached:
            # Hit rate limit so can't add any volumes anymore
            break

        if rename_files or volume_already_added:
            # Move files not already in the volume folder into the volume folder
            vf = Library.get_volume(volume_id).vd.folder

            if volume_already_added or folder_is_inside_folder(vf, lcf):
                file_changes = {
                    f: (
                        join(vf, basename(f))
                        if not folder_is_inside_folder(vf, f) else
                        f
                    )
                    for f in files
                }

            else:
                file_changes = change_basefolder(files, lcf, vf)

            for old, new in file_changes.items():
                if old != new:
                    rename_file(old, new)
                    delete_empty_parent_folders(
                        dirname(old), root_folder.folder
                    )

            files = list(file_changes.values())

        scan_files(volume_id, filepath_filter=files)

        if rename_files:
            # Rename the filenames themselves
            mass_rename(volume_id, filepath_filter=files)

    return
