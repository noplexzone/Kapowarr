# -*- coding: utf-8 -*-

"""Persisted post-processing lifecycle records for GetComics downloads."""

from __future__ import annotations

from json import dumps as json_dumps
from time import time
from typing import Any, Dict, List, Union

from backend.base.definitions import Download, DownloadSource
from backend.internals.db import get_db

GETCOMICS_SOURCES = {
    DownloadSource.GETCOMICS.value,
    DownloadSource.GETCOMICS_TORRENT.value,
}

VALID_STATES = {
    'staged',
    'analyzed',
    'conflict',
    'applying',
    'completed',
    'failed',
    'rolled_back',
}

TERMINAL_STATES = {'completed', 'failed', 'rolled_back'}


def _source_value(download: Download) -> str:
    source = getattr(download, 'source_type', None)
    if source is None:
        return ''
    return source.value if hasattr(source, 'value') else str(source)


def is_tracked_getcomics_download(download: Download) -> bool:
    return _source_value(download) in GETCOMICS_SOURCES


def _safe_json(value: Any) -> str:
    try:
        return json_dumps(value, sort_keys=True, separators=(',', ':'))
    except Exception:
        return json_dumps({'repr': repr(value)}, sort_keys=True)


def _covered_issues_value(download: Download) -> Union[str, None]:
    covered = download.covered_issues
    if covered is None:
        return None
    if isinstance(covered, tuple):
        return ','.join(str(v) for v in covered)
    return str(covered)


def _row_payload(download: Download) -> Dict[str, Any]:
    return {
        'download_id': download.id,
        'volume_id': download.volume_id,
        'issue_id': download.issue_id,
        'covered_issues': _covered_issues_value(download),
        'source_type': _source_value(download),
        'source_name': download.source_name or '',
        'download_link': download.download_link,
        'web_link': download.web_link,
        'web_title': download.web_title,
        'web_sub_title': download.web_sub_title,
    }


def ensure_postprocessing_record(download: Download) -> Union[int, None]:
    """Create or refresh the durable lifecycle row for a GetComics import."""
    if not is_tracked_getcomics_download(download):
        return None
    row = _row_payload(download)
    now = round(time())
    cursor = get_db()
    existing = cursor.execute(
        """
        SELECT id FROM download_postprocessing_state
        WHERE download_id = ? AND source_type IN (?, ?)
        ORDER BY id DESC LIMIT 1;
        """,
        (download.id, DownloadSource.GETCOMICS.value, DownloadSource.GETCOMICS_TORRENT.value),
    ).fetchone()
    if existing:
        state_id = existing['id'] if isinstance(existing, dict) else existing[0]
        cursor.execute(
            """
            UPDATE download_postprocessing_state
            SET volume_id = :volume_id,
                issue_id = :issue_id,
                covered_issues = :covered_issues,
                source_name = :source_name,
                download_link = :download_link,
                web_link = :web_link,
                web_title = :web_title,
                web_sub_title = :web_sub_title,
                updated_at = :updated_at
            WHERE id = :id;
            """,
            {**row, 'updated_at': now, 'id': state_id},
        )
        download._postprocessing_state_id = state_id
        return state_id

    state_id = cursor.execute(
        """
        INSERT INTO download_postprocessing_state(
            download_id, volume_id, issue_id, covered_issues,
            source_type, source_name, download_link, web_link, web_title,
            web_sub_title, state, stage_details, created_at, updated_at
        ) VALUES (
            :download_id, :volume_id, :issue_id, :covered_issues,
            :source_type, :source_name, :download_link, :web_link, :web_title,
            :web_sub_title, 'staged', '{}', :created_at, :updated_at
        );
        """,
        {**row, 'created_at': now, 'updated_at': now},
    ).lastrowid
    download._postprocessing_state_id = state_id
    return state_id


def update_postprocessing_state(
    download: Download,
    state: str,
    details: Union[Dict[str, Any], List[Any], None] = None,
) -> Union[int, None]:
    """Persist a GetComics post-processing state transition."""
    if state not in VALID_STATES:
        raise ValueError(f'Invalid post-processing state: {state}')
    state_id = getattr(download, '_postprocessing_state_id', None)
    if state_id is None:
        state_id = ensure_postprocessing_record(download)
    if state_id is None:
        return None

    now = round(time())
    terminal_column = ''
    params = {
        'id': state_id,
        'state': state,
        'stage_details': _safe_json(details or {}),
        'updated_at': now,
    }
    if state in TERMINAL_STATES:
        terminal_column = ', completed_at = :completed_at'
        params['completed_at'] = now

    get_db().execute(
        f"""
        UPDATE download_postprocessing_state
        SET state = :state,
            stage_details = :stage_details,
            updated_at = :updated_at
            {terminal_column}
        WHERE id = :id;
        """,
        params,
    )
    return state_id


def mark_analyzed(download: Download) -> Union[int, None]:
    return update_postprocessing_state(
        download,
        'analyzed',
        {
            'files': list(download.files),
            'covered_issues': _covered_issues_value(download),
        },
    )


def mark_applying(download: Download) -> Union[int, None]:
    return update_postprocessing_state(
        download,
        'applying',
        {'files': list(download.files)},
    )


def mark_completed(download: Download) -> Union[int, None]:
    state_id = getattr(download, '_postprocessing_state_id', None)
    if state_id is not None:
        row = get_db().execute(
            'SELECT state FROM download_postprocessing_state WHERE id = ?',
            (state_id,),
        ).fetchone()
        if row and row['state'] in {'conflict', 'failed', 'rolled_back'}:
            return state_id
    return update_postprocessing_state(
        download,
        'completed',
        {'files': list(getattr(download, 'files', []))},
    )


def mark_failed(download: Download, error: Union[BaseException, Dict[str, Any], str, None] = None) -> Union[int, None]:
    if isinstance(error, BaseException):
        details = {'type': type(error).__name__}
    elif isinstance(error, dict):
        details = error
    elif error:
        details = {'message': str(error)}
    else:
        details = {}
    return update_postprocessing_state(download, 'failed', details)


def mark_rolled_back(download: Download, details: Union[Dict[str, Any], None] = None) -> Union[int, None]:
    return update_postprocessing_state(download, 'rolled_back', details or {})


def list_unresolved_postprocessing_states(volume_id: Union[int, None] = None) -> List[dict]:
    cursor = get_db()
    if volume_id is None:
        return cursor.execute(
            """
            SELECT * FROM download_postprocessing_state
            WHERE state NOT IN ('completed', 'rolled_back')
            ORDER BY updated_at DESC, id DESC;
            """
        ).fetchalldict()
    return cursor.execute(
        """
        SELECT * FROM download_postprocessing_state
        WHERE volume_id = ? AND state NOT IN ('completed', 'rolled_back')
        ORDER BY updated_at DESC, id DESC;
        """,
        (volume_id,),
    ).fetchalldict()
