# -*- coding: utf-8 -*-
"""File/issue match conflict persistence and repair helpers."""
from __future__ import annotations
from hashlib import sha256
from json import dumps
from os.path import basename, exists
from shutil import move
from time import time
from typing import Any, Dict, Iterable, List, Optional
from backend.base.files import create_folder
from backend.base.logging import LOGGER
from backend.internals.db import get_db
from backend.internals.settings import Settings
CONFLICT_REASONS = {'file_claims_multiple_issues','issue_already_has_file','multiple_files_claim_issue','multi_issue_range','duplicate_content','nonidentical_duplicate','ambiguous_issue_number','filename_metadata_conflict','destination_collision','postprocessing_incomplete'}
def content_hash(filepath: str) -> Optional[str]:
    if not filepath or not exists(filepath): return None
    digest = sha256()
    with open(filepath, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()
def _safe_json(value: Any) -> str:
    try: return dumps(value, default=str, sort_keys=True, separators=(',', ':'))
    except Exception: return dumps({'repr': repr(value)}, sort_keys=True, separators=(',', ':'))
def record_conflict(*, volume_id: int, filepath: str, reason: str, file_id: Optional[int] = None, proposed_issue_id: Optional[int] = None, proposed_issue_numbers: Any = None, source_type: str = 'scan', download_id: Optional[int] = None, parser_result: Any = None, resolution: Optional[str] = None, resolved_at: Optional[int] = None, hash_value: Optional[str] = None) -> int:
    if reason not in CONFLICT_REASONS: LOGGER.warning('Recording unknown file match conflict reason: %s', reason)
    ts = round(time())
    if hash_value is None: hash_value = content_hash(filepath)
    cursor = get_db()
    cursor.execute("""INSERT INTO file_match_conflicts(volume_id, file_id, filepath, proposed_issue_id, proposed_issue_numbers, reason, source_type, download_id, content_hash, parser_result, created_at, resolved_at, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""", (volume_id, file_id, filepath, proposed_issue_id, _safe_json(proposed_issue_numbers), reason, source_type, download_id, hash_value, _safe_json(parser_result), ts, resolved_at, resolution))
    return cursor.lastrowid
def choose_canonical_file(filepaths: Iterable[str]) -> str:
    def key(path: str):
        name = basename(path); suffix_penalty = 1 if any(token in name for token in (' (1)',' (2)',' (3)',' (4)',' (5)',' (6)',' (7)',' (8)',' (9)')) else 0
        return (suffix_penalty, len(name), name.lower(), path)
    return sorted(filepaths, key=key)[0]
def default_quarantine_folder() -> str:
    configured = getattr(Settings().sv, 'file_match_quarantine_folder', None)
    if configured: return configured
    from backend.base.definitions import Constants
    from backend.base.files import folder_path
    return folder_path(*Constants.TEMP_DOWNLOAD_FOLDER, 'file_match_quarantine')
def quarantine_file(filepath: str, *, reason: str, volume_id: int) -> Optional[str]:
    if not filepath or not exists(filepath): return None
    folder = default_quarantine_folder(); create_folder(folder)
    target = f"{folder}/{volume_id}-{reason}-{basename(filepath)}"
    if exists(target): target = f"{target}.{round(time())}"
    move(filepath, target); return target
def unresolved_conflicts(volume_id: Optional[int] = None) -> List[Dict[str, Any]]:
    cursor = get_db()
    if volume_id is None:
        return cursor.execute("SELECT * FROM file_match_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC, id DESC;").fetchalldict()
    return cursor.execute("SELECT * FROM file_match_conflicts WHERE volume_id = ? AND resolved_at IS NULL ORDER BY created_at DESC, id DESC;", (volume_id,)).fetchalldict()
