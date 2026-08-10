# -*- coding: utf-8 -*-

from asyncio import run
from datetime import datetime
from io import BytesIO
from os import makedirs, remove
from os.path import basename, dirname, exists, getsize, join, splitext
from typing import Any, Dict, List, Tuple, Type, Union

import json as _json

from flask import Blueprint, Response, request, send_file, stream_with_context

from backend.base.custom_exceptions import (InvalidKeyValue,
                                            KeyNotFound, TaskNotFound)
from backend.base.definitions import (BlocklistReason, BlocklistReasonID,
                                      Constants, CredentialData, CredentialSource,
                                      DownloadSource, FileMatch,
                                      KapowarrException, LibraryFilter,
                                      LibrarySorting, MonitorScheme,
                                      SpecialVersion, StartType, VolumeData)
from backend.base.helpers import force_suffix, hash_credential
from backend.base.logging import LOGGER, get_log_file_contents
from backend.features.download_queue import (DownloadHandler,
                                             delete_download_history,
                                             get_download_history,
                                             get_download_history_count)
from backend.base.files import delete_file_folder, folder_is_inside_folder
from backend.features.library_import import (generate_bulk_scan,
                                             prepare_bulk_scan)
from backend.features.mass_edit import run_mass_editor_action
from backend.features.search import manual_search, manual_suwayomi_bundle_search
from backend.features.tasks import (BulkLibraryImport, ImportFilesVolume,
                                    RefreshAndScanVolume,
                                    Task, TaskHandler,
                                    delete_task_history, get_task_history,
                                    get_task_planning, record_and_track_download,
                                    task_library)
from backend.features.reader import clear_cache, get_page, get_page_count, serve_pdf_file
from backend.implementations.blocklist import (add_to_blocklist,
                                               delete_blocklist,
                                               delete_blocklist_entry,
                                               get_blocklist,
                                               get_blocklist_count,
                                               get_blocklist_entry)
from backend.implementations.comicvine import ComicVine
from backend.implementations.conversion import preview_mass_convert
from backend.implementations.converters import ConvertersManager
from backend.implementations.credentials import Credentials
from backend.implementations.external_clients import ExternalClients
from backend.implementations.nzb_indexers import NZBIndexers
from backend.implementations.file_matching import (get_file_matching,
                                                   set_file_matching)
from backend.implementations.naming import (generate_volume_folder_name,
                                            preview_mass_rename)
from backend.implementations.remote_mapping import RemoteMappings
from backend.implementations.root_folders import RootFolders
from backend.implementations.volumes import (Library, delete_issue_file,
                                             rematch_volume)
from backend.internals.db import get_db
from backend.internals.db_models import FilesDB
from backend.internals.server import Server, StartTypeHandlers
from backend.internals.settings import Settings, get_about_data

api = Blueprint('api', __name__)


def return_api(
    result: Any,
    error: Union[str, None] = None,
    code: int = 200
) -> Tuple[Dict[str, Any], int]:
    return {'error': error, 'result': result}, code


def error_handler(method) -> Any:
    """Used as decodator. Catches the errors that can occur in the endpoint and returns the correct api error
    """
    def wrapper(*args, **kwargs):
        try:
            return method(*args, **kwargs)

        except KapowarrException as e:
            return return_api(**e.api_response)

    wrapper.__name__ = method.__name__
    return wrapper


def extract_key(request, key: str, check_existence: bool = True) -> Any:
    """Extract and format a value of a parameter from a request

    Args:
        request (Request): The request from which to get the values.
        key (str): The key of which to get and format the value.
        check_existence (bool, optional): Require the key to be given in the request. Defaults to True.

    Raises:
        KeyNotFound: The key is not found in the request.
        InvalidKeyValue: The value of a key is invalid.
        TaskNotFound: The task was not found

    Returns:
        Any: The formatted value of the key.
    """
    value: Any = request.values.get(key)
    if value is None:
        get_json = getattr(request, 'get_json', None)
        if callable(get_json):
            try:
                json_body = get_json(silent=True)
            except TypeError:
                json_body = get_json()
            if isinstance(json_body, dict):
                value = json_body.get(key)

    if value is None and key == 'api_key':
        value = (
            request.headers.get('x-api-key')
            or request.headers.get('X-Api-Key')
        )
    if check_existence and value is None:
        raise KeyNotFound(key)

    if value is not None:
        # Check value
        if key in ('volume_id', 'issue_id'):
            try:
                value = int(value)
                if key == 'volume_id':
                    Library.get_volume(value)
                else:
                    Library.get_issue(value)
            except (ValueError, TypeError):
                raise InvalidKeyValue(key, value)

        elif key == 'cmd':
            task = task_library.get(value)
            if task is None:
                raise TaskNotFound(value)
            value = task

        elif key == 'api_key':
            if not value or value != Settings().sv.api_key:
                raise InvalidKeyValue(key, value)

        elif key == 'sort':
            try:
                value = LibrarySorting[value.upper()]
            except KeyError:
                raise InvalidKeyValue(key, value)

        elif key == 'filter':
            try:
                value = LibraryFilter[value.upper()] if value else None
            except KeyError:
                raise InvalidKeyValue(key, value)

        elif key in (
            'root_folder_id', 'root_folder',
            'offset', 'limit', 'index'
        ):
            try:
                value = int(value)
            except (ValueError, TypeError):
                raise InvalidKeyValue(key, value)

        elif key in ('monitor', 'delete_folder', 'rename_files', 'only_english',
                    'limit_parent_folder', 'force_match'):
            if isinstance(value, bool):
                pass
            elif value == 'true':
                value = True
            elif value == 'false':
                value = False
            else:
                raise InvalidKeyValue(key, value)

        elif key in ('query', 'folder_filter'):
            if not value:
                raise InvalidKeyValue(key, value)

    else:
        # Default value
        if key == 'sort':
            value = LibrarySorting.TITLE

        elif key == 'filter':
            value = None

        elif key == 'monitor':
            value = True

        elif key == 'delete_folder':
            value = False

        elif key == 'offset':
            value = 0

        elif key == 'rename_files':
            value = False

        elif key == 'limit':
            value = 20

        elif key == 'only_english':
            value = True

        elif key == 'limit_parent_folder':
            value = False

        elif key == 'force_match':
            value = False

    return value

# =====================
# Authentication function and endpoints
# =====================


def auth(method):
    """Used as decorator and, if applied to route, restricts the route to authorized users only
    """
    def wrapper(*args, **kwargs):
        if not request.path.endswith('/cover'):
            LOGGER.debug(f'{request.method} {request.path}')

        # Skip api_key validation when no auth password is configured.
        # This matches the standard *arr behaviour: a fresh install
        # (no password set) allows requests without authentication.
        if getattr(Settings().sv, 'auth_password', None):
            try:
                extract_key(request, 'api_key')
            except (KeyNotFound, InvalidKeyValue):
                ip = request.environ.get(
                    'HTTP_X_FORWARDED_FOR',
                    request.remote_addr
                )
                LOGGER.warning(f'Unauthorised request from {ip}')
                return return_api({}, 'ApiKeyInvalid', 401)

        StartTypeHandlers.diffuse_timer(StartType.RESTART_HOSTING_CHANGES)

        result = method(*args, **kwargs)

        if not isinstance(result, Response) and result[1] > 300:
            LOGGER.debug(
                f'{request.method} {request.path} {result[1]} {result[0]}')

        return result

    wrapper.__name__ = method.__name__
    return wrapper


@api.route('/health')
def api_health():
    return {'healthy': True}, 200


@api.route('/auth', methods=['POST'])
def api_auth():
    settings = Settings().get_settings()

    ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)

    if settings.auth_password:
        username_correct = True
        if settings.auth_username:
            given_username = request.get_json().get('username') or ''
            hashed_username = hash_credential(
                settings.auth_salt,
                given_username
            )
            username_correct = hashed_username == settings.auth_username

        given_password = request.get_json().get('password') or ''
        hashed_password = hash_credential(
            settings.auth_salt,
            given_password
        )
        password_correct = hashed_password == settings.auth_password

        if not (username_correct and password_correct):
            LOGGER.warning(f'Login attempt failed from {ip}')
            return return_api({}, 'PasswordInvalid', 401)

    LOGGER.info(f'Login attempt successful from {ip}')
    return return_api({'api_key': settings.api_key})


@api.route('/auth/check', methods=['POST'])
@error_handler
@auth
def api_auth_check():
    return return_api({})


@api.route('/public', methods=['GET'])
@error_handler
def api_public():
    settings = Settings().get_settings()

    if settings.auth_username and settings.auth_password:
        authentication_method = 2
    elif settings.auth_password:
        authentication_method = 1
    else:
        authentication_method = 0

    result = {
        'authentication_method': authentication_method
    }

    return return_api(result)


# =====================
# Tasks
# =====================
@api.route('/system/about', methods=['GET'])
@error_handler
@auth
def api_about():
    return return_api(get_about_data())


@api.route('/system/logs', methods=['GET'])
@error_handler
@auth
def api_logs():
    sio = get_log_file_contents()
    tail = extract_key(request, 'tail', False)

    if tail is not None:
        # Return last N lines as plain text
        lines = sio.getvalue().splitlines()
        tail_lines = lines[-int(tail):] if tail else lines
        return return_api('\n'.join(tail_lines))

    return send_file(
        BytesIO(sio.getvalue().encode('utf-8')),
        mimetype="application/octet-stream",
        download_name=f'Kapowarr_log_{datetime.now().strftime("%Y_%m_%d_%H_%M")}.txt'
    ), 200


@api.route('/system/tasks', methods=['GET', 'POST'])
@error_handler
@auth
def api_tasks():
    task_handler = TaskHandler()

    if request.method == 'GET':
        tasks = task_handler.get_all()
        return return_api(tasks)

    elif request.method == 'POST':
        data = request.get_json()
        if not isinstance(data, dict):
            raise InvalidKeyValue(value=data)

        task: Union[Type[Task], None] = task_library.get(data.get('cmd', ''))
        if not task:
            raise TaskNotFound(data.get('cmd', ''))

        kwargs = {}
        if task.action in (
            'refresh_and_scan',
            'auto_search', 'auto_search_issue',
            'mass_rename', 'mass_rename_issue',
            'mass_convert', 'mass_convert_issue'
        ):
            volume_id = data.get('volume_id')
            if not volume_id or not isinstance(volume_id, int):
                raise InvalidKeyValue('volume_id', volume_id)
            kwargs['volume_id'] = volume_id

        if task.action in (
            'auto_search_issue',
            'mass_rename_issue',
            'mass_convert_issue'
        ):
            issue_id = data.get('issue_id')
            if not issue_id or not isinstance(issue_id, int):
                raise InvalidKeyValue('issue_id', issue_id)
            kwargs['issue_id'] = issue_id

        if task.action in (
            'mass_rename', 'mass_rename_issue',
            'mass_convert', 'mass_convert_issue'
        ):
            filepath_filter = data.get('filepath_filter')
            if not (
                filepath_filter is None
                or isinstance(filepath_filter, list)
            ):
                raise InvalidKeyValue('filepath_filter', filepath_filter)
            kwargs['filepath_filter'] = filepath_filter or []

        if task.action == 'update_all':
            allow_skipping = data.get('allow_skipping', True)
            if not isinstance(allow_skipping, bool):
                raise InvalidKeyValue('allow_skipping', allow_skipping)
            kwargs['allow_skipping'] = allow_skipping

        task_instance = task(**kwargs)
        result = task_handler.add(task_instance)
        return return_api({'id': result}, code=201)


@api.route('/system/tasks/history', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_task_history():
    if request.method == 'GET':
        offset = extract_key(request, 'offset', False)
        tasks = get_task_history(offset)
        return return_api(tasks)

    elif request.method == 'DELETE':
        delete_task_history()
        return return_api({})


@api.route('/system/tasks/planning', methods=['GET'])
@error_handler
@auth
def api_task_planning():
    result = get_task_planning()
    return return_api(result)


@api.route('/system/tasks/<int:task_id>', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_task(task_id: int):
    task_handler = TaskHandler()

    if request.method == 'GET':
        task = task_handler.get_one(task_id)
        return return_api(task)

    elif request.method == 'DELETE':
        task_handler.remove(task_id)
        return return_api({})


@api.route('/system/power/shutdown', methods=['POST'])
@error_handler
@auth
def api_shutdown():
    Server().shutdown()
    return return_api({})


@api.route('/system/power/restart', methods=['POST'])
@error_handler
@auth
def api_restart():
    Server().restart()
    return return_api({})

# =====================
# Settings
# =====================


@api.route('/settings', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_settings():
    settings = Settings()
    if request.method == 'GET':
        result = settings.get_public_settings().todict()
        return return_api(result)

    elif request.method == 'PUT':
        data = request.get_json()

        hosting_changes = any(
            s in data
            and data[s] is not None
            and data[s] != getattr(settings.sv, s)
            for s in ('host', 'port', 'url_base')
        )
        proxy_changes = any(
            s in data
            and data[s] != getattr(settings.sv, s)
            for s in (
                'proxy_type', 'proxy_host', 'proxy_port',
                'proxy_username', 'proxy_password', 'proxy_ignored_addresses'
            )
        )

        if hosting_changes:
            settings.backup_hosting_settings()

        settings.update(data, from_public=True)

        if hosting_changes:
            Server().restart(StartType.RESTART_HOSTING_CHANGES)
        elif proxy_changes:
            Server().restart()

        return return_api(settings.get_public_settings().todict())

    elif request.method == 'DELETE':
        data = request.get_json()

        reset_keys = data.get('reset_keys')
        if not (
            isinstance(reset_keys, list)
            and all((
                isinstance(k, str)
                for k in reset_keys
            ))
        ):
            raise InvalidKeyValue('reset_keys', reset_keys)

        hosting_changes = any(
            s in data
            and data[s] is not None
            and data[s] != getattr(settings.sv, s)
            for s in ('host', 'port', 'url_base')
        )
        proxy_changes = any(
            s in data
            and data[s] != getattr(settings.sv, s)
            for s in (
                'proxy_type', 'proxy_host', 'proxy_port',
                'proxy_username', 'proxy_password', 'proxy_ignored_addresses'
            )
        )

        if hosting_changes:
            settings.backup_hosting_settings()

        for reset_key in reset_keys:
            settings.reset(reset_key, from_public=True)

        if hosting_changes:
            Server().restart(StartType.RESTART_HOSTING_CHANGES)
        elif proxy_changes:
            Server().restart()

        return return_api(settings.get_public_settings().todict())


@api.route('/settings/api_key', methods=['POST'])
@error_handler
@auth
def api_settings_api_key():
    settings = Settings()
    settings.generate_api_key()
    return return_api(settings.get_public_settings().todict())


@api.route('/settings/availableformats', methods=['GET'])
@error_handler
@auth
def api_settings_available_formats():
    result = list(ConvertersManager.get_available_formats())
    return return_api(result)


@api.route('/settings/suwayomi/sources', methods=['GET'])
@error_handler
@auth
def api_settings_suwayomi_sources():
    from backend.implementations.suwayomi import SuwayomiClient
    client = SuwayomiClient()
    if not client.is_configured():
        return return_api({'sources': []})
    try:
        sources = client.get_sources()
        return return_api({'sources': sources})
    except Exception as e:
        LOGGER.debug('Suwayomi: failed to fetch sources: %s', e)
        return return_api({'sources': []})


@api.route('/rootfolder', methods=['GET', 'POST'])
@error_handler
@auth
def api_rootfolder():
    root_folders = RootFolders()

    if request.method == 'GET':
        result = [
            rf.todict()
            for rf in root_folders.get_all()
        ]
        return return_api(result)

    elif request.method == 'POST':
        data: dict = request.get_json()
        folder = data.get('folder')
        if folder is None:
            raise KeyNotFound('folder')
        section = data.get('section', 'comic')
        if section not in ('comic', 'manga'):
            raise InvalidKeyValue('section', section)
        root_folder = root_folders.add(folder, section=section).todict()
        return return_api(root_folder, code=201)


@api.route('/rootfolder/<int:id>', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_rootfolder_id(id: int):
    root_folders = RootFolders()

    if request.method == 'GET':
        root_folder = root_folders.get_one(id).todict()
        return return_api(root_folder)

    elif request.method == 'PUT':
        data: dict = request.get_json()
        section = data.get('section')
        if section is not None:
            if section not in ('comic', 'manga'):
                raise InvalidKeyValue('section', section)
            root_folders.update_section(id, section)
        folder: Union[str, None] = data.get('folder')
        if folder:
            root_folders.rename(id, folder)
        return return_api({})

    elif request.method == 'DELETE':
        root_folders.delete(id)
        return return_api({})


@api.route('/remotemapping', methods=['GET', 'POST'])
@error_handler
@auth
def api_remote_mappings():
    remote_mappings = RemoteMappings

    if request.method == 'GET':
        return return_api(remote_mappings.get_all())

    elif request.method == 'POST':
        data: dict = request.get_json()

        external_download_client_id = data.get('external_download_client_id')
        remote_path = data.get('remote_path')
        local_path = data.get('local_path')

        if (
            not isinstance(external_download_client_id, int)
            or external_download_client_id < 1
        ):
            raise InvalidKeyValue(
                'external_download_client_id',
                external_download_client_id
            )

        if not isinstance(remote_path, str) or not remote_path:
            raise InvalidKeyValue('remote_path', remote_path)

        if not isinstance(local_path, str) or not local_path:
            raise InvalidKeyValue('local_path', local_path)

        result = remote_mappings.add(
            external_download_client_id,
            remote_path,
            local_path
        ).get()
        return return_api(result, code=201)


@api.route('/remotemapping/<int:id>', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_remote_mapping(id: int):
    remote_mapping = RemoteMappings.get_one(id)

    if request.method == 'GET':
        return return_api(remote_mapping.get())

    elif request.method == 'PUT':
        data: dict = request.get_json()

        external_download_client_id = data.get('external_download_client_id')
        remote_path = data.get('remote_path')
        local_path = data.get('local_path')

        if not (
            external_download_client_id is None
            or (
                isinstance(external_download_client_id, int)
                and external_download_client_id >= 1
            )
        ):
            raise InvalidKeyValue(
                'external_download_client_id',
                external_download_client_id
            )

        if not (
            remote_path is None
            or (
                isinstance(remote_path, str)
                and remote_path
            )
        ):
            raise InvalidKeyValue('remote_path', remote_path)

        if not (
            local_path is None
            or (
                isinstance(local_path, str)
                and local_path
            )
        ):
            raise InvalidKeyValue('local_path', local_path)

        result = remote_mapping.update(
            external_download_client_id,
            remote_path,
            local_path
        )
        return return_api(result, code=201)

    elif request.method == 'DELETE':
        remote_mapping.delete()
        return return_api({})


# =====================
# Library Import
# =====================
@api.route('/libraryimport/bulk', methods=['GET', 'POST'])
@error_handler
@auth
def api_library_import_bulk():
    if request.method == 'GET':
        folder_filter = extract_key(
            request,
            'folder_filter',
            check_existence=False
        )
        fuzzy_fallback = request.args.get('fuzzy_fallback', '').lower() == 'true'
        quick = request.args.get('quick', '').lower() == 'true'

        # Validate + collect roots before streaming (errors surface here,
        # caught by @error_handler before the Response is created)
        scan_roots, existing_folders = prepare_bulk_scan(folder_filter)

        def _generate():
            for item in generate_bulk_scan(
                scan_roots, existing_folders,
                fuzzy_fallback=fuzzy_fallback, quick=quick
            ):
                yield _json.dumps(item) + '\n'

        return Response(
            stream_with_context(_generate()),
            mimetype='application/x-ndjson'
        )

    elif request.method == 'POST':
        data = request.get_json()
        if (
            not isinstance(data, list)
            or not all(
                isinstance(e, dict)
                and 'folder' in e
                and 'cv_id' in e
                and 'file_title' in e
                for e in data
            )
        ):
            raise InvalidKeyValue

        task = BulkLibraryImport(data)
        task_id = TaskHandler().add(task)
        return return_api({'task_id': task_id}, code=201)

@api.route('/libraryimport/delete', methods=['POST'])
@error_handler
@auth
def api_library_import_delete():
    folders = request.get_json()
    if not isinstance(folders, list) or not all(isinstance(f, str) for f in folders):
        raise InvalidKeyValue('folders', folders)

    root_folders = RootFolders().get_folder_list()
    for folder in folders:
        # folder_is_inside_folder(base, child) — rf is the root (base), folder is the child
        if any(folder_is_inside_folder(rf, folder) for rf in root_folders):
            delete_file_folder(folder)

    return return_api({})


# =====================
# Discovery
# =====================


@api.route('/discovery', methods=['GET'])
@error_handler
@auth
def api_discovery():
    discovery_type = extract_key(request, 'type')
    section = extract_key(request, 'section', False) or 'comic'
    cv = ComicVine()

    if discovery_type == 'upcoming':
        if section == 'manga':
            results = run(cv.get_upcoming_releases_manga())
        else:
            results = run(cv.get_upcoming_releases())
    elif discovery_type == 'new':
        if section == 'manga':
            results = run(cv.get_new_volumes_manga())
        else:
            results = run(cv.get_new_volumes())
        for r in results:
            if 'cover' in r:
                del r['cover']
    elif discovery_type == 'story-arcs':
        query = extract_key(request, 'query', False) or ''
        if section == 'manga':
            results = run(cv.get_story_arcs_manga(query=query))
        else:
            results = run(cv.get_story_arcs(query=query))
        return return_api(results)
    else:
        raise InvalidKeyValue('type', discovery_type)

    return return_api(results)


@api.route('/discovery/story-arc/<int:arc_id>', methods=['GET'])
@error_handler
@auth
def api_discovery_story_arc(arc_id: int):
    cv = ComicVine()
    result = run(cv.get_story_arc_volumes(arc_id))
    return return_api(result)


# =====================
# Library + Volumes
# =====================


@api.route('/volumes/search', methods=['GET', 'POST'])
@error_handler
@auth
def api_volumes_search():
    if request.method == 'GET':
        query = extract_key(request, 'query')
        section = extract_key(request, 'section', False) or 'comic'
        metadata_source = (
            extract_key(request, 'metadata_source', False)
            or 'comicvine'
        )

        def search_comicvine() -> List[dict]:
            results = run(ComicVine().search_volumes(query, section=section))
            for r in results:
                r['metadata_source'] = 'comicvine'
                r['metadata_id'] = str(r['comicvine_id'])
                del r["cover"] # type: ignore
            return results

        def search_mangadex() -> List[dict]:
            if section != 'manga':
                raise InvalidKeyValue('metadata_source', 'mangadex')
            from backend.implementations.mangadex import search_mangadex_volumes
            results = search_mangadex_volumes(query)
            db = get_db()
            for r in results:
                already_added = db.execute(
                    """
                    SELECT id
                    FROM volumes
                    WHERE metadata_source = 'mangadex'
                        AND metadata_id = ?
                        AND metadata_language = ?
                    LIMIT 1;
                    """,
                    (r['metadata_id'], r.get('metadata_language') or 'en')
                ).fetchone()
                r['already_added'] = already_added[0] if already_added else None
            return results

        if metadata_source == 'all':
            comicvine_results = search_comicvine()
            if section != 'manga' or comicvine_results:
                return return_api(comicvine_results)
            return return_api(search_mangadex())

        if metadata_source == 'mangadex':
            return return_api(search_mangadex())

        if metadata_source != 'comicvine':
            raise InvalidKeyValue('metadata_source', metadata_source)

        return return_api(search_comicvine())

    elif request.method == 'POST':
        data: Dict[str, Any] = request.get_json()
        for key in (
            'comicvine_id',
            'title', 'year', 'volume_number',
            'publisher'
        ):
            if key not in data:
                raise KeyNotFound(key)

        vd = VolumeData(
            id=0,
            comicvine_id=data['comicvine_id'],
            title=data['title'],
            alt_title=data['title'],
            year=data['year'],
            publisher=data['publisher'],
            volume_number=data['volume_number'],
            description="",
            site_url="",
            monitored=True,
            monitor_new_issues=True,
            root_folder=1,
            folder="",
            custom_folder=False,
            special_version=SpecialVersion(data.get('special_version')),
            special_version_locked=False,
            last_cv_fetch=0
        )

        folder = generate_volume_folder_name(vd)
        return return_api({'folder': folder})


@api.route('/volumes', methods=['GET', 'POST'])
@error_handler
@auth
def api_volumes():
    if request.method == 'GET':
        query = extract_key(request, 'query', False)
        sort = extract_key(request, 'sort', False)
        filter = extract_key(request, 'filter', False)
        section = extract_key(request, 'section', False) or 'comic'
        offset = extract_key(request, 'offset', False)
        requested_limit = extract_key(request, 'limit', False)
        limit = 60 if requested_limit is None else requested_limit
        if section not in ('comic', 'manga'):
            raise InvalidKeyValue('section', section)
        if offset < 0:
            raise InvalidKeyValue('offset', offset)
        if limit < 1 or limit > 100:
            raise InvalidKeyValue('limit', limit)

        LOGGER.debug(
            'api_volumes GET: query=%r sort=%r filter=%r section=%r '
            'offset=%r limit=%r',
            query, sort, filter, section, offset, limit
        )
        try:
            if query:
                matching = Library.search(
                    query, sort or LibrarySorting.TITLE, filter, section
                )
                total = len(matching)
                start = offset * limit
                volumes = matching[start:start + limit]
            else:
                volumes, total = Library.get_public_volumes_page(
                    sort or LibrarySorting.TITLE,
                    filter,
                    section,
                    offset,
                    limit
                )
            LOGGER.debug(
                'api_volumes GET: returning %d of %d volumes',
                len(volumes), total
            )
        except Exception as e:
            LOGGER.exception('api_volumes GET: unexpected error: %s', e)
            raise

        return return_api({
            'items': volumes,
            'total': total,
            'offset': offset,
            'page_size': limit
        })

    elif request.method == 'POST':
        data: dict = request.get_json()

        metadata_source = data.get('metadata_source') or 'comicvine'
        if metadata_source not in ('comicvine', 'mangadex'):
            raise InvalidKeyValue('metadata_source', metadata_source)

        comicvine_id = data.get('comicvine_id')
        metadata_id = data.get('metadata_id')
        metadata_language = data.get('metadata_language') or 'en'
        if not isinstance(metadata_language, str) or not metadata_language:
            raise InvalidKeyValue('metadata_language', metadata_language)
        if metadata_source == 'comicvine' and comicvine_id is None:
            raise KeyNotFound('comicvine_id')
        if metadata_source == 'mangadex' and not isinstance(metadata_id, str):
            raise KeyNotFound('metadata_id')

        root_folder_id = data.get('root_folder_id')
        if root_folder_id is None:
            raise KeyNotFound('root_folder_id')

        monitor = data.get('monitor', data.get('monitor_volume', True))
        if not isinstance(monitor, bool):
            raise InvalidKeyValue('monitor', monitor)

        monitoring_scheme = data.get('monitoring_scheme') or "all"
        try:
            monitoring_scheme = MonitorScheme(monitoring_scheme)
        except ValueError:
            raise InvalidKeyValue("monitoring_scheme", monitoring_scheme)

        monitor_new_issues = data.get('monitor_new_issues', data.get('monitor_issues', True))
        if not isinstance(monitor_new_issues, bool):
            raise InvalidKeyValue('monitor_new_issues', monitor_new_issues)

        volume_folder = data.get('volume_folder') or None

        auto_search = data.get('auto_search', True)
        if not isinstance(auto_search, bool):
            raise InvalidKeyValue('auto_search', auto_search)

        special_version = data.get('special_version') or None
        if special_version == 'auto':
            sv = None
        else:
            try:
                sv = SpecialVersion(special_version)
            except ValueError:
                raise InvalidKeyValue('special_version', special_version)

        if metadata_source == 'mangadex':
            volume_id = Library.add_mangadex(
                metadata_id,
                root_folder_id,
                monitor,
                monitoring_scheme,
                monitor_new_issues,
                volume_folder,
                sv,
                auto_search
            )
        else:
            volume_id = Library.add(
                comicvine_id,
                root_folder_id,
                monitor,
                monitoring_scheme,
                monitor_new_issues,
                volume_folder,
                sv,
                auto_search
            )
        volume_info = Library.get_volume(volume_id).get_public_data()
        return return_api(volume_info, code=201)


@api.route('/volumes/stats', methods=['GET'])
@error_handler
@auth
def api_volumes_stats():
    section = extract_key(request, 'section', False) or 'comic'
    result = Library.get_stats(section)
    return return_api(result)


@api.route('/nav/badges', methods=['GET'])
@error_handler
@auth
def api_nav_badges():
    import os
    import re as _re

    db = get_db()

    volume_count: int = db.execute('SELECT COUNT(*) FROM volumes;').fetchone()[0] or 0
    comic_count: int = db.execute(
        "SELECT COUNT(*) FROM volumes v INNER JOIN root_folders rf ON rf.id = v.root_folder WHERE rf.section = 'comic';"
    ).fetchone()[0] or 0
    manga_count: int = db.execute(
        "SELECT COUNT(*) FROM volumes v INNER JOIN root_folders rf ON rf.id = v.root_folder WHERE rf.section = 'manga';"
    ).fetchone()[0] or 0
    queue_count: int = len(DownloadHandler().get_all())

    # Count subfolders in root folders not already imported
    import_count = 0
    try:
        existing = {
            force_suffix(r[0]) for r in db.execute('SELECT folder FROM volumes;').fetchall()
            if r[0]
        }
        for root in RootFolders().get_folder_list():
            try:
                for entry in os.listdir(root):
                    full = os.path.join(root, entry)
                    if os.path.isdir(full) and force_suffix(os.path.abspath(full)) not in existing:
                        import_count += 1
            except OSError:
                pass
    except Exception:
        pass

    # Mismatch count — mirrors isMismatch + isForeignPublisher in folder_check.js
    _FOREIGN_SIGNALS = (
        'verlag', 'deutschland', 'deutsch', 'gmbh',
        'éditions', 'editeur', 'française',
        'editore', 'edizioni', 'planeta',
        'carlsen', 'egmont ehapa', 'splitter', 'cross cult',
        'glenat', 'glénat',
    )

    def _norm(s: str) -> str:
        s = s.lower()
        s = _re.sub(r'\(\d{4}\)', '', s)
        s = _re.sub(r'[:\\*?"<>|,]', '', s)
        s = s.replace("'", '')
        s = _re.sub(r'[^a-z0-9 ]', ' ', s)
        return _re.sub(r'\s+', ' ', s).strip()

    def _is_mismatch(folder: str, title: str) -> bool:
        parts = folder.replace('\\', '/').split('/')
        base = parts[-1] or (parts[-2] if len(parts) > 1 else '')
        nf, nt = _norm(base), _norm(title)
        return bool(nf and nt and nt not in nf and nf not in nt)

    def _is_foreign(publisher: str) -> bool:
        p = publisher.lower()
        return any(sig in p for sig in _FOREIGN_SIGNALS)

    rows = db.execute('SELECT folder, title, publisher FROM volumes;').fetchall()
    mismatch_count = sum(
        1 for folder, title, publisher in rows
        if (folder and _is_mismatch(folder, title or ''))
        or (publisher and _is_foreign(publisher))
    )

    return return_api({
        'volumes': volume_count,
        'comics': comic_count,
        'manga': manga_count,
        'queue': queue_count,
        'library_import': import_count,
        'mismatch': mismatch_count,
    })


@api.route('/volumes/<int:id>', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_volume(id: int):
    volume = Library.get_volume(id)

    if request.method == 'GET':
        volume_info = volume.get_public_data()
        return return_api(volume_info)

    elif request.method == 'PUT':
        edit_info: Dict[str, Any] = request.get_json()

        if 'root_folder' in edit_info:
            volume.change_root_folder(edit_info['root_folder'])

        if 'volume_folder' in edit_info:
            volume.change_volume_folder(edit_info['volume_folder'])

        if 'monitoring_scheme' in edit_info:
            try:
                monitoring_scheme = MonitorScheme(
                    edit_info['monitoring_scheme']
                )

            except ValueError:
                raise InvalidKeyValue(
                    'monitoring_scheme',
                    edit_info['monitoring_scheme']
                )

            volume.apply_monitor_scheme(monitoring_scheme)

        volume.update({
            k: v
            for k, v in edit_info.items()
            if k not in ('root_folder', 'volume_folder', 'monitoring_scheme')
        })
        return return_api(None)

    elif request.method == 'DELETE':
        delete_folder = extract_key(
            request,
            'delete_folder',
            check_existence=False
        )
        volume.delete(delete_folder=delete_folder)
        return return_api({})


@api.route('/volumes/<int:id>/import', methods=['POST'])
@error_handler
@auth
def api_volume_import(id: int):
    from werkzeug.utils import secure_filename

    volume = Library.get_volume(id)
    folder = volume.vd.folder
    makedirs(folder, exist_ok=True)

    uploads = request.files.getlist('files')
    if not uploads or all(not f.filename for f in uploads):
        raise KeyNotFound('files')

    saved_paths = []
    for upload in uploads:
        if not upload.filename:
            continue
        filename = secure_filename(upload.filename)
        if not filename:
            continue
        filepath = join(folder, filename)
        upload.save(filepath)
        saved_paths.append(filepath)

    if not saved_paths:
        raise KeyNotFound('files')

    match_map: Dict[str, List[int]] = {}
    match_map_raw = request.form.get('match_map')
    if match_map_raw:
        raw_map = _json.loads(match_map_raw)
        filename_to_path = {basename(p): p for p in saved_paths}
        for fname, issue_ids in raw_map.items():
            safe_fname = secure_filename(fname)
            if safe_fname in filename_to_path:
                match_map[filename_to_path[safe_fname]] = issue_ids

    task_id = TaskHandler().add(ImportFilesVolume(id, saved_paths, match_map=match_map or None))
    return return_api({'task_id': task_id}, code=201)


@api.route('/volumes/<int:id>/cover', methods=['GET'])
@error_handler
@auth
def api_volume_cover(id: int):
    cover = Library.get_volume(id).get_cover()
    return send_file(
        cover,
        mimetype='image/jpeg'
    ), 200


@api.route('/volumes/<int:id>/rematch', methods=['PUT'])
@error_handler
@auth
def api_volume_rematch(id: int):
    data: dict = request.get_json()
    new_cv_id = data.get('comicvine_id')
    if new_cv_id is None:
        raise KeyNotFound('comicvine_id')
    if not isinstance(new_cv_id, int):
        raise InvalidKeyValue('comicvine_id', new_cv_id)
    new_title = data.get('new_title') or None
    if new_title is not None and not isinstance(new_title, str):
        new_title = None
    rematch_volume(id, new_cv_id)
    task_id = TaskHandler().add(RefreshAndScanVolume(id, new_title=new_title))
    return return_api({'task_id': task_id}, code=202)


@api.route('/issues/<int:id>', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_issues(id: int):
    issue = Library.get_issue(id)

    if request.method == 'GET':
        result = issue.get_data()
        return return_api(result)

    elif request.method == 'PUT':
        edit_info: dict = request.get_json()
        monitored = edit_info.get('monitored')
        if monitored is not None:
            issue.update({'monitored': monitored})

        result = issue.get_data()
        return return_api(result)

    elif request.method == 'DELETE':
        issue.delete()
        return return_api({})


# =====================
# Issue cover art
# =====================

@api.route('/issues/<int:issue_id>/cover-options', methods=['GET'])
@error_handler
@auth
def api_issue_cover_options(issue_id: int):
    """Return MangaDex cover candidates for a given issue's print volume."""
    from backend.implementations.mangadex import find_volume_cover_candidates

    issue = Library.get_issue(issue_id)
    issue_data = issue.get_data()
    volume = Library.get_volume(issue_data.volume_id)
    volume_data = volume.get_data()

    mangadex_candidates = find_volume_cover_candidates(
        volume_data.title,
        issue_data.calculated_issue_number,
    )

    comicvine_candidate = None
    try:
        comicvine_candidate = run(
            ComicVine().fetch_issue_cover_candidate(issue_data.comicvine_id)
        )
    except KapowarrException:
        raise
    except Exception as e:
        LOGGER.warning(
            "ComicVine cover lookup failed for issue %s: %s",
            issue_data.comicvine_id,
            e,
        )

    if comicvine_candidate:
        english_mangadex = [
            c for c in mangadex_candidates
            if str(c.get('locale') or '').lower() == 'en'
        ]
        candidates = [comicvine_candidate, *english_mangadex]
    else:
        candidates = mangadex_candidates

    return return_api(candidates)


@api.route('/mangadex/cover-proxy', methods=['GET'])
@error_handler
@auth
def api_mangadex_cover_proxy():
    """Proxy MangaDex cover images so previews do not hotlink their CDN."""
    from urllib.parse import urlparse
    import requests as _requests

    cover_url = extract_key(request, 'url')
    if not isinstance(cover_url, str):
        raise InvalidKeyValue('url', cover_url)

    parsed_cover_url = urlparse(cover_url)
    allowed_cover_url = (
        parsed_cover_url.scheme == 'https'
        and (
            (
                parsed_cover_url.netloc == 'uploads.mangadex.org'
                and parsed_cover_url.path.startswith('/covers/')
            )
            or (
                parsed_cover_url.netloc == 'comicvine.gamespot.com'
                and parsed_cover_url.path.startswith('/a/uploads/')
            )
        )
    )
    if not allowed_cover_url:
        raise InvalidKeyValue('url', cover_url)

    resp = _requests.get(
        cover_url,
        headers={'User-Agent': Constants.DEFAULT_USERAGENT},
        timeout=Constants.REQUEST_TIMEOUT,
    )
    resp.raise_for_status()

    mimetype = resp.headers.get('content-type') or 'image/jpeg'
    if not mimetype.startswith('image/'):
        raise InvalidKeyValue('url', cover_url)

    return Response(
        resp.content,
        mimetype=mimetype,
        headers={'Cache-Control': 'private, max-age=3600'}
    ), 200


# =====================
# Comic Reader — serve pages from CBZ/CBR/PDF files
# =====================
@api.route('/files/<int:file_id>/info', methods=['GET'])
@error_handler
@auth
def api_file_info(file_id: int):
    """Get page count and file metadata for the reader."""
    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')

    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')

    ext = splitext(filepath)[1].lower()
    is_pdf = ext == '.pdf'

    page_count = 0 if is_pdf else get_page_count(filepath)

    return return_api({
        'file_id': file_id,
        'filepath': filepath,
        'file_type': ext.lstrip('.'),
        'page_count': page_count,
        'is_pdf': is_pdf,
        'size': file_data.get('size', 0),
    })


@api.route('/files/<int:file_id>/page/<int:page_num>', methods=['GET'])
@error_handler
@auth
def api_file_page(file_id: int, page_num: int):
    """Serve a single page from a comic file as an image."""
    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')

    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')

    ext = splitext(filepath)[1].lower()

    if ext == '.pdf':
        if page_num == 0:
            pdf_bytes, mimetype, filename = serve_pdf_file(filepath)
            return Response(
                pdf_bytes,
                mimetype=mimetype,
                headers={
                    'Content-Disposition':
                        f'inline; filename="{filename}"',
                    'Cache-Control': 'private, max-age=3600',
                }
            ), 200
        else:
            raise InvalidKeyValue('page_num', page_num)

    try:
        image_bytes, mimetype = get_page(filepath, page_num)
    except IndexError:
        raise InvalidKeyValue('page_num', page_num)
    except ValueError as e:
        raise InvalidKeyValue('file_type', str(e))

    return Response(
        image_bytes,
        mimetype=mimetype,
        headers={'Cache-Control': 'private, max-age=3600'}
    ), 200


@api.route('/files/<int:file_id>/raw', methods=['GET'])
@error_handler
@auth
def api_file_raw(file_id: int):
    """Serve the raw file for browser-native handling (PDFs)."""
    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')

    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')

    ext = splitext(filepath)[1].lower()
    mimetype = 'application/pdf' if ext == '.pdf' else \
        'application/octet-stream'

    return send_file(
        filepath,
        mimetype=mimetype,
        as_attachment=False,
        download_name=basename(filepath),
    ), 200


# =====================
# Manual File Match
# =====================
@api.route('/volumes/<int:id>/manualmatch', methods=['GET', 'PUT'])
@error_handler
@auth
def api_manual_match(id: int):
    Library.get_volume(id)

    if request.method == 'GET':
        result = get_file_matching(id)
        return return_api(result)

    elif request.method == 'PUT':
        file_matching_changes = request.get_json()
        if not isinstance(file_matching_changes, list):
            raise InvalidKeyValue('body', file_matching_changes)

        entry_types = FileMatch.__annotations__
        for entry in file_matching_changes:
            if not isinstance(entry, dict):
                raise InvalidKeyValue('body', file_matching_changes)
            if not all(
                key in entry_types
                and (
                    (
                        isinstance(value, list)
                        and all(isinstance(i_id, int) for i_id in value)
                    )
                    if entry_types[key] == List[int] else
                    isinstance(value, entry_types[key])
                )
                for key, value in entry.items()
            ):
                raise InvalidKeyValue('body', file_matching_changes)

        set_file_matching(id, file_matching_changes)

        return return_api({})


# =====================
# Renaming
# =====================
@api.route('/volumes/<int:id>/rename', methods=['GET'])
@error_handler
@auth
def api_rename(id: int):
    Library.get_volume(id)
    all_namings = preview_mass_rename(id)[0]
    only_renamings = {
        before: after
        for before, after in all_namings.items()
        if before != after
    }
    return return_api(only_renamings)


@api.route('/issues/<int:id>/rename', methods=['GET'])
@error_handler
@auth
def api_rename_issue(id: int):
    volume_id = Library.get_issue(id).get_data().volume_id
    all_namings = preview_mass_rename(volume_id, id)[0]
    only_renamings = {
        before: after
        for before, after in all_namings.items()
        if before != after
    }
    return return_api(only_renamings)

# =====================
# File Conversion
# =====================


@api.route('/volumes/<int:id>/convert', methods=['GET'])
@error_handler
@auth
def api_convert(id: int):
    Library.get_volume(id)
    result = preview_mass_convert(id)
    return return_api(result)


@api.route('/issues/<int:id>/convert', methods=['GET'])
@error_handler
@auth
def api_convert_issue(id: int):
    volume_id = Library.get_issue(id).get_data().volume_id
    result = preview_mass_convert(volume_id, id)
    return return_api(result)

# =====================
# Manual search + Download
# =====================


@api.route('/volumes/<int:id>/manualsearch', methods=['GET'])
@error_handler
@auth
def api_volume_manual_search(id: int):
    Library.get_volume(id)
    query = extract_key(request, 'query', check_existence=False)
    result = manual_search(id, custom_query=query)
    return return_api(result)


@api.route('/volumes/<int:id>/download', methods=['POST'])
@error_handler
@auth
def api_volume_download(id: int):
    Library.get_volume(id)
    link: str = extract_key(request, 'link')
    force_match: bool = extract_key(request, 'force_match')
    display_title: str = extract_key(request, 'display_title', check_existence=False) or ''
    result = record_and_track_download(link, id, None, force_match, display_title)
    return return_api(
        {
            'result': (result or (None,))[0],
            'fail_reason': result[1].value if result[1] else result[1]
        },
        code=201
    )


@api.route('/issues/<int:id>/manualsearch', methods=['GET'])
@error_handler
@auth
def api_issue_manual_search(id: int):
    volume_id = Library.get_issue(id).get_data().volume_id
    query = extract_key(request, 'query', check_existence=False)
    result = manual_search(
        volume_id,
        id,
        custom_query=query,
    )
    return return_api(result)


@api.route('/issues/<int:id>/download', methods=['POST'])
@error_handler
@auth
def api_issue_download(id: int):
    volume_id = Library.get_issue(id).get_data().volume_id
    link = extract_key(request, 'link')
    force_match: bool = extract_key(request, 'force_match')
    display_title: str = extract_key(request, 'display_title', check_existence=False) or ''
    result = record_and_track_download(link, volume_id, id, force_match, display_title)
    return return_api(
        {
            'result': result[0],
            'fail_reason': result[1].value if result[1] else result[1]
        },
        code=201
    )


@api.route('/issues/<int:id>/suwayomi/manual-bundle/search', methods=['POST'])
@error_handler
@auth
def api_issue_suwayomi_manual_bundle_search(id: int):
    Library.get_issue(id)
    chapters_expr = extract_key(request, 'chapters')
    try:
        result = manual_suwayomi_bundle_search(id, chapters_expr)
    except ValueError as e:
        return return_api({}, str(e), 400)
    return return_api(result)


@api.route('/activity/queue', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_downloads():
    download_handler = DownloadHandler()

    if request.method == 'GET':
        result = download_handler.get_all()
        return return_api(result)

    elif request.method == 'DELETE':
        download_handler.remove_all()
        return return_api({})


@api.route(
    '/activity/queue/<int:download_id>',
    methods=['GET', 'PUT', 'DELETE']
)
@error_handler
@auth
def api_delete_download(download_id: int):
    download_handler = DownloadHandler()

    if request.method == 'GET':
        result = download_handler.get_one(download_id).as_dict()
        return return_api(result)

    elif request.method == 'PUT':
        index: int = extract_key(request, 'index')
        download_handler.set_queue_location(download_id, index)
        return return_api({})

    elif request.method == 'DELETE':
        data: Dict[str, Any] = request.get_json(silent=True) or {}
        blocklist = data.get('blocklist', False)
        if not isinstance(blocklist, bool):
            raise InvalidKeyValue('blocklist', blocklist)

        download_handler.remove(download_id, blocklist)
        return return_api({})


@api.route('/activity/history', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_download_history():
    if request.method == 'GET':
        volume_id: int = extract_key(request, 'volume_id', False)
        issue_id: int = extract_key(request, 'issue_id', False)
        offset: int = extract_key(request, 'offset', False)
        result = get_download_history(
            volume_id, issue_id,
            offset
        )
        total = get_download_history_count(volume_id, issue_id)
        return return_api({
            'entries': result,
            'total': total,
            'offset': offset,
            'page_size': 50
        })

    elif request.method == 'DELETE':
        delete_download_history()
        return return_api({})


@api.route('/activity/folder', methods=['DELETE'])
@error_handler
@auth
def api_empty_download_folder():
    DownloadHandler().empty_download_folder()
    return return_api({})

# =====================
# Blocklist
# =====================


@api.route('/blocklist', methods=['GET', 'POST', 'DELETE'])
@error_handler
@auth
def api_blocklist():
    if request.method == 'GET':
        offset = extract_key(request, 'offset', False)

        blocklist = get_blocklist(offset)
        result = [
            b.todict()
            for b in blocklist
        ]
        return return_api({
            'entries': result,
            'total': get_blocklist_count(),
            'offset': offset,
            'page_size': 50
        })

    elif request.method == 'POST':
        data = request.get_json()
        if not isinstance(data, dict):
            raise InvalidKeyValue(value=data)

        web_link = data.get('web_link')
        if not (web_link and isinstance(web_link, str)):
            raise InvalidKeyValue('web_link', web_link)

        web_title = data.get('web_title')
        if not (
            web_title is None
            or web_title
                and isinstance(web_title, str)
        ):
            raise InvalidKeyValue('web_title', web_title)

        web_sub_title = data.get('web_sub_title')
        if not (
            web_sub_title is None
            or web_sub_title
                and isinstance(web_sub_title, str)
        ):
            raise InvalidKeyValue('web_sub_title', web_sub_title)

        download_link = data.get('download_link')
        if not (
            download_link is None
            or download_link
                and isinstance(download_link, str)
        ):
            raise InvalidKeyValue('download_link', download_link)

        source = data.get('source')
        if not (
            source is None
            or source
                and isinstance(source, str)
        ):
            raise InvalidKeyValue('source', source)

        if not data.get('source'):
            source = None
        else:
            try:
                source = DownloadSource(data['source'])
            except ValueError:
                raise InvalidKeyValue('source', data['source'])

        volume_id = data.get('volume_id')
        if not (volume_id and isinstance(volume_id, int)):
            raise InvalidKeyValue('volume_id', volume_id)

        issue_id = data.get('issue_id')
        if not (
            issue_id is None
            or issue_id
                and isinstance(issue_id, int)
        ):
            raise InvalidKeyValue('issue_id', issue_id)

        try:
            reason = BlocklistReason[
                BlocklistReasonID(data.get('reason_id')).name
            ]

        except ValueError:
            raise InvalidKeyValue('reason_id', data.get('reason_id'))

        result = add_to_blocklist(
            web_link=web_link,
            web_title=web_title,
            web_sub_title=web_sub_title,
            download_link=download_link,
            source=source,
            volume_id=volume_id,
            issue_id=issue_id,
            reason=reason
        ).todict()
        return return_api(result, code=201)

    elif request.method == 'DELETE':
        delete_blocklist()
        return return_api({})


@api.route('/blocklist/<int:id>', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_blocklist_entry(id: int):
    if request.method == 'GET':
        result = get_blocklist_entry(id).todict()
        return return_api(result)

    elif request.method == 'DELETE':
        delete_blocklist_entry(id)
        return return_api({})


# =====================
# Credentials
# =====================
@api.route('/credentials', methods=['GET', 'POST'])
@error_handler
@auth
def api_credentials():
    cred = Credentials()

    if request.method == 'GET':
        result = [
            c.todict(hide_password=True)
            for c in cred.get_all()
        ]
        return return_api(result)

    elif request.method == 'POST':
        data = request.get_json()
        if not isinstance(data, dict):
            raise InvalidKeyValue(value=data)

        if 'source' not in data:
            raise KeyNotFound('source')

        try:
            source = CredentialSource(
                data["source"]
            )

        except ValueError:
            raise InvalidKeyValue('source', data["source"])

        result = cred.add(CredentialData(
            id=-1,
            source=source,
            username=data.get("username"),
            email=data.get("email"),
            password=data.get("password"),
            api_key=data.get("api_key")
        ))
        return return_api(result.todict(hide_password=True), code=201)


@api.route('/credentials/<int:id>', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_credential(id: int):
    cred = Credentials()
    if request.method == 'GET':
        result = cred.get_one(id).todict(hide_password=True)
        return return_api(result)

    elif request.method == 'DELETE':
        cred.delete(id)
        return return_api({})


# =====================
# Torrent Clients
# =====================
@api.route('/externalclients', methods=['GET', 'POST'])
@error_handler
@auth
def api_external_clients():
    if request.method == 'GET':
        result = ExternalClients.get_clients()
        return return_api(result)

    elif request.method == 'POST':
        data: dict = request.get_json()
        data = {
            k: data.get(k)
            for k in (
                'client_type',
                'title', 'base_url',
                'username', 'password', 'api_token',
                'category'
            )
        }
        result = ExternalClients.add(**data).get_client_data()
        return return_api(result, code=201)


@api.route('/externalclients/options', methods=['GET'])
@error_handler
@auth
def api_external_clients_keys():
    result = {
        k: {
            'tokens': list(v.required_tokens),
            'download_type': v.download_type.value
        }
        for k, v in ExternalClients.get_client_types().items()
    }
    return return_api(result)


@api.route('/externalclients/test', methods=['POST'])
@error_handler
@auth
def api_external_clients_test():
    data: dict = request.get_json()
    data = {
        k: data.get(k)
        for k in (
            'client_type', 'base_url',
            'username', 'password', 'api_token'
        )
    }
    result = ExternalClients.test(**data)
    return return_api(result)


@api.route('/externalclients/<int:id>', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_external_client(id: int):
    client = ExternalClients.get_client(id)

    if request.method == 'GET':
        result = client.get_client_data()
        return return_api(result)

    elif request.method == 'PUT':
        data: dict = request.get_json()
        data = {
            k: data.get(k)
            for k in (
                'title', 'base_url',
                'username', 'password', 'api_token',
                'category'
            )
        }
        client.update_client(data)
        return return_api(client.get_client_data())

    elif request.method == 'DELETE':
        client.delete_client()
        return return_api({})


# =====================
# Mass Editor
# =====================
@api.route('/masseditor', methods=['POST'])
@error_handler
@auth
def api_mass_editor():
    data = request.get_json()
    if not isinstance(data, dict):
        raise InvalidKeyValue('body', data)
    if 'action' not in data:
        raise KeyNotFound('action')
    if 'volume_ids' not in data:
        raise KeyNotFound('volume_ids')

    action: str = data['action']
    volume_ids: Union[List[int], Any] = data['volume_ids']
    args: Dict[str, Any] = data.get('args', {})

    if not (
        isinstance(volume_ids, list)
        and all(isinstance(v, int) for v in volume_ids)
    ):
        raise InvalidKeyValue('volume_ids', volume_ids)

    if not isinstance(args, dict):
        raise InvalidKeyValue('args', args)

    run_mass_editor_action(action, volume_ids, **args)
    return return_api({})


# =====================
# Files
# =====================
@api.route('/files/<int:f_id>', methods=['GET', 'DELETE'])
@error_handler
@auth
def api_files(f_id: int):
    if request.method == 'GET':
        result = FilesDB.fetch(file_id=f_id)[0]
        return return_api(result)

    elif request.method == 'DELETE':
        delete_issue_file(f_id)
        return return_api({})


@api.route('/files/<int:file_id>/cover-page', methods=['POST'])
@error_handler
@auth
def api_file_add_cover_page(file_id: int):
    """Prepend (or append) a downloaded cover image as a page in a PDF file.

    Body: { cover_url: str, position?: "prepend" | "append" }
    Response: { file_id, size }

    Only PDF files are supported.
    """
    import shutil
    import tempfile

    data = request.get_json(silent=True) or {}
    cover_url = data.get('cover_url')
    position = data.get('position', 'prepend')

    if not cover_url or not isinstance(cover_url, str):
        raise KeyNotFound('cover_url')
    from urllib.parse import urlparse
    parsed_cover_url = urlparse(cover_url)
    allowed_cover_url = (
        parsed_cover_url.scheme == 'https'
        and (
            (
                parsed_cover_url.netloc == 'uploads.mangadex.org'
                and parsed_cover_url.path.startswith('/covers/')
            )
            or (
                parsed_cover_url.netloc == 'comicvine.gamespot.com'
                and parsed_cover_url.path.startswith('/a/uploads/')
            )
        )
    )
    if not allowed_cover_url:
        raise InvalidKeyValue('cover_url', cover_url)
    if position not in ('prepend', 'append'):
        raise InvalidKeyValue('position', position)

    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')

    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')

    ext = splitext(filepath)[1].lower()
    if ext != '.pdf':
        raise InvalidKeyValue('file_type', 'Only PDF files are supported')

    tmp_path = None
    try:
        import img2pdf
        from io import BytesIO as _BytesIO
        from pypdf import PdfReader as _PdfReader, PdfWriter as _PdfWriter
        import requests as _requests

        resp = _requests.get(
            cover_url,
            headers={'User-Agent': Constants.DEFAULT_USERAGENT},
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()

        cover_pdf_bytes = img2pdf.convert(_BytesIO(resp.content))
        cover_reader = _PdfReader(_BytesIO(cover_pdf_bytes))
        original_reader = _PdfReader(filepath)

        writer = _PdfWriter()
        if position == 'prepend':
            for page in cover_reader.pages:
                writer.add_page(page)
            for page in original_reader.pages:
                writer.add_page(page)
        else:
            for page in original_reader.pages:
                writer.add_page(page)
            for page in cover_reader.pages:
                writer.add_page(page)

        dir_path = dirname(filepath)
        with tempfile.NamedTemporaryFile(
            dir=dir_path, delete=False, suffix='.pdf'
        ) as tmp:
            tmp_path = tmp.name
            writer.write(tmp)

        shutil.move(tmp_path, filepath)
        tmp_path = None

        new_size = getsize(filepath)
        get_db().execute(
            "UPDATE files SET size = ? WHERE id = ?",
            (new_size, file_id),
        )
        clear_cache()

        return return_api({
            'file_id': file_id,
            'size': new_size,
        })

    except KapowarrException:
        raise
    except Exception as e:
        LOGGER.error("Failed to add cover page to %s: %s", filepath, e)
        return return_api({}, f'Failed to add cover page: {e}', 500)
    finally:
        if tmp_path:
            try:
                remove(tmp_path)
            except OSError:
                pass


@api.route('/files/raw', methods=['DELETE'])
@error_handler
@auth
def api_files_raw():
    """Delete a file from disk by filepath. Used for unmatched files without DB records."""
    data: dict = request.get_json() or {}
    filepath = data.get('filepath', '')
    if not filepath or not exists(filepath):
        raise KeyNotFound('filepath')
    if not filepath.startswith('/'):
        raise InvalidKeyValue('filepath', filepath)
    remove(filepath)
    return return_api({})


# =====================
# NZB Indexers
# =====================
@api.route('/nzbindexers', methods=['GET', 'POST'])
@error_handler
@auth
def api_nzb_indexers():
    if request.method == 'GET':
        result = [i.todict() for i in NZBIndexers.get_all()]
        return return_api(result)

    elif request.method == 'POST':
        data: dict = request.get_json() or {}
        result = NZBIndexers.add(
            name=data.get('name', ''),
            base_url=data.get('base_url', ''),
            api_key=data.get('api_key', ''),
            categories=data.get('categories', '7030,7020'),
            enabled=bool(data.get('enabled', True))
        ).todict()
        return return_api(result, code=201)


@api.route('/nzbindexers/test', methods=['POST'])
@error_handler
@auth
def api_nzb_indexers_test():
    data: dict = request.get_json() or {}
    result = NZBIndexers.test(
        base_url=data.get('base_url', ''),
        api_key=data.get('api_key', '')
    )
    return return_api(result)


@api.route('/nzbindexers/<int:id>', methods=['GET', 'PUT', 'DELETE'])
@error_handler
@auth
def api_nzb_indexer(id: int):
    if request.method == 'GET':
        result = NZBIndexers.get(id).todict()
        return return_api(result)

    elif request.method == 'PUT':
        data: dict = request.get_json() or {}
        result = NZBIndexers.update(
            indexer_id=id,
            name=data.get('name', ''),
            base_url=data.get('base_url', ''),
            api_key=data.get('api_key', ''),
            categories=data.get('categories', '7030,7020'),
            enabled=bool(data.get('enabled', True))
        ).todict()
        return return_api(result)

    elif request.method == 'DELETE':
        NZBIndexers.delete(id)
        return return_api({})
