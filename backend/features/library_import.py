# -*- coding: utf-8 -*-

from asyncio import gather as async_gather, run
from glob import glob
from os import listdir
from os.path import abspath, isdir, isfile, join
from re import match as re_match, search as re_search
from time import sleep
from typing import Dict, List, Tuple, Union
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from backend.base.custom_exceptions import InvalidKeyValue, VolumeAlreadyAdded
from backend.base.definitions import Constants, MonitorScheme
from backend.base.files import folder_is_inside_folder, list_files
from backend.base.helpers import batched, force_suffix
from backend.base.logging import LOGGER
from backend.implementations.comicvine import ComicVine
from backend.implementations.file_matching import scan_files
from backend.implementations.naming import mass_rename
from backend.implementations.root_folders import RootFolders
from backend.implementations.volumes import Library
from backend.internals.db import commit, get_db


def _parse_folder_name(folder_name: str) -> Tuple[str, Union[str, None]]:
    """Parse "Series Title (Year)" into (title, year). Year may be None."""
    m = re_match(r'^(.+?)\s*\((\d{4})\)\s*$', folder_name)
    if m:
        return m.group(1).strip(), m.group(2)
    return folder_name, None


def _pick_best_cv_result(
    results: list,
    year: Union[str, None]
) -> Union[Tuple[int, str], None]:
    """Choose the best CV search result, preferring year match then issue count."""
    if not results:
        return None
    if year is not None:
        year_matches = [r for r in results if str(r.get('year') or '') == year]
        if year_matches:
            best = max(year_matches, key=lambda r: r.get('issue_count') or 0)
            return best['comicvine_id'], 'volume'
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

    Phase 1: ComicInfo hits are yielded immediately (no API calls).
    Phase 2 (fuzzy_fallback only): Unmatched folders are grouped by unique
    base title, searched 10 at a time in parallel, then yielded in batches.
    This reduces API calls from one-per-folder to one-per-unique-title.

    Args:
        scan_roots: Root directories to scan.
        existing_folders: Folders already in the library (skipped).
        fuzzy_fallback: When True and no ComicInfo CV ID is found, search CV
            by the folder name as a fallback.
    """
    # Phase 1: stream ComicInfo hits; defer unmatched for batch title search
    unmatched: List[Tuple[str, str, str, Union[str, None]]] = []

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

            try:
                for cbz in list_files(folder, ('.cbz',)):
                    found = read_comicinfo_cv_id(cbz)
                    if found is not None:
                        cv_id, id_type = found
                        break
            except Exception:
                pass

            if cv_id is not None:
                LOGGER.debug('Bulk scan: %s → CV %s ID %s (comicinfo)', entry, id_type, cv_id)
                yield {
                    'folder': folder, 'file_title': entry,
                    'cv_id': cv_id, 'id_type': id_type, 'match_type': 'comicinfo'
                }
            elif fuzzy_fallback:
                title, year = _parse_folder_name(entry)
                unmatched.append((folder, entry, title, year))
            else:
                LOGGER.debug('Bulk scan: %s → no CV ID found', entry)
                yield {
                    'folder': folder, 'file_title': entry,
                    'cv_id': None, 'id_type': None, 'match_type': None
                }

    if not unmatched:
        return

    # Phase 2: batch title searches — one API call per unique base title.
    # Group folders by title so we can yield results immediately after each
    # batch completes instead of holding everything until the end.
    unique_titles = list(dict.fromkeys(t for _, _, t, _ in unmatched))
    title_to_folders: Dict[str, List[Tuple[str, str, Union[str, None]]]] = {}
    for folder, entry, title, year in unmatched:
        title_to_folders.setdefault(title, []).append((folder, entry, year))

    cv = ComicVine()

    LOGGER.info(
        'Bulk scan fuzzy phase: %d unmatched folders, %d unique titles to search',
        len(unmatched), len(unique_titles)
    )

    async def _search_batch(titles):
        return await async_gather(
            *(cv.search_volumes(t, allow_rate_limit_reached=True) for t in titles),
            return_exceptions=True
        )

    for title_batch in batched(unique_titles, 10):
        batch_results = run(_search_batch(title_batch))
        for title, results in zip(title_batch, batch_results):
            result_list = results if isinstance(results, list) else []
            LOGGER.debug(
                'Bulk scan title search: "%s" → %d results',
                title, len(result_list)
            )
            for folder, entry, year in title_to_folders.get(title, []):
                found = _pick_best_cv_result(result_list, year)
                if found is not None:
                    cv_id, id_type = found
                    match_type = 'title'
                else:
                    cv_id, id_type, match_type = None, None, None
                LOGGER.debug(
                    'Bulk scan: %s → %s (%s)',
                    entry,
                    f'CV {id_type} ID {cv_id}' if cv_id else 'no CV ID found',
                    match_type or 'none'
                )
                yield {
                    'folder': folder, 'file_title': entry,
                    'cv_id': cv_id, 'id_type': id_type, 'match_type': match_type
                }
        sleep(Constants.CV_BRAKE_TIME * len(title_batch))


def import_library_entry(
    cv_id: int,
    folder: str,
    rename_files: bool = False
) -> None:
    """Import a single series folder using a known ComicVine ID."""
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
