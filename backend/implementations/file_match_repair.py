# -*- coding: utf-8 -*-
"""Safe issue-file integrity repair planning and application."""
from __future__ import annotations
from os.path import exists
from time import time
from typing import Any, Dict, Iterable, List, Optional, Set
from backend.base.file_extraction import extract_filename_data
from backend.implementations.file_match_conflicts import choose_canonical_file, content_hash, quarantine_file, record_conflict
from backend.implementations.file_matching import _filename_issue_range
from backend.internals.db import commit, get_db


def _rows_for_volume(volume_id: int) -> List[Dict[str, Any]]:
    return get_db().execute("""
        SELECT f.id AS file_id, f.filepath, if.issue_id, i.calculated_issue_number
        FROM files f
        INNER JOIN issues_files if ON if.file_id = f.id
        INNER JOIN issues i ON i.id = if.issue_id
        WHERE i.volume_id = ?
        ORDER BY i.calculated_issue_number, f.filepath;
    """, (volume_id,)).fetchalldict()


def dry_run_volume_repair(volume_id: int) -> Dict[str, Any]:
    rows = _rows_for_volume(volume_id)
    by_issue: Dict[int, List[Dict[str, Any]]] = {}
    by_file: Dict[int, List[Dict[str, Any]]] = {}
    actions: List[Dict[str, Any]] = []
    conflicts: List[Dict[str, Any]] = []
    for row in rows:
        row = dict(row)
        row['exists_on_disk'] = exists(row['filepath'])
        row['content_hash'] = content_hash(row['filepath']) if row['exists_on_disk'] else None
        row['parser_result'] = extract_filename_data(row['filepath']) if row['filepath'] else {}
        by_issue.setdefault(row['issue_id'], []).append(row)
        by_file.setdefault(row['file_id'], []).append(row)
        if not row['exists_on_disk']:
            actions.append({'action': 'remove_missing_mapping', 'file_id': row['file_id'], 'issue_id': row['issue_id'], 'filepath': row['filepath']})
            conflicts.append({'reason': 'postprocessing_incomplete', **row})
        issue_no = row['parser_result'].get('issue_number') if isinstance(row['parser_result'], dict) else None
        if isinstance(issue_no, tuple) or _filename_issue_range(row['filepath']):
            actions.append({'action': 'unmap_range_file', 'file_id': row['file_id'], 'issue_id': row['issue_id'], 'filepath': row['filepath']})
            conflicts.append({'reason': 'multi_issue_range', **row})
    for file_id, file_rows in by_file.items():
        issue_ids = {r['issue_id'] for r in file_rows}
        if len(issue_ids) > 1:
            for row in file_rows:
                actions.append({'action': 'remove_multi_issue_file_mapping', 'file_id': file_id, 'issue_id': row['issue_id'], 'filepath': row['filepath']})
                conflicts.append({'reason': 'file_claims_multiple_issues', **row})
    for issue_id, issue_rows in by_issue.items():
        file_ids = {r['file_id'] for r in issue_rows}
        if len(file_ids) <= 1:
            continue
        existing_rows = [r for r in issue_rows if r.get('exists_on_disk')]
        hashes = {r.get('content_hash') for r in existing_rows}
        if existing_rows and len(hashes) == 1:
            canonical_path = choose_canonical_file(r['filepath'] for r in existing_rows)
            for row in issue_rows:
                if row['filepath'] == canonical_path:
                    continue
                actions.append({'action': 'quarantine_duplicate', 'file_id': row['file_id'], 'issue_id': issue_id, 'filepath': row['filepath'], 'canonical': canonical_path})
                conflicts.append({'reason': 'duplicate_content', **row})
        else:
            for row in issue_rows:
                actions.append({'action': 'review_nonidentical_duplicate', 'file_id': row['file_id'], 'issue_id': issue_id, 'filepath': row['filepath']})
                conflicts.append({'reason': 'nonidentical_duplicate', **row})
    # Stable de-dupe action list.
    seen: Set[tuple] = set(); unique_actions = []
    for action in actions:
        key = (action['action'], action.get('file_id'), action.get('issue_id'), action.get('filepath'))
        if key in seen: continue
        seen.add(key); unique_actions.append(action)
    return {'volume_id': volume_id, 'dry_run': True, 'actions': unique_actions, 'conflicts': conflicts, 'safe_to_apply': all(a['action'] != 'review_nonidentical_duplicate' for a in unique_actions)}


def apply_volume_repair(volume_id: int, selected_actions: Optional[Iterable[int]] = None, *, backup_confirmed: bool = False) -> Dict[str, Any]:
    if not backup_confirmed:
        raise ValueError('A database backup confirmation is required before applying file-match repairs')
    plan = dry_run_volume_repair(volume_id)
    selected = set(selected_actions) if selected_actions is not None else set(range(len(plan['actions'])))
    applied = []
    for index, action in enumerate(plan['actions']):
        if index not in selected: continue
        if action['action'] == 'quarantine_duplicate':
            target = quarantine_file(action['filepath'], reason='duplicate_content', volume_id=volume_id)
            get_db().execute('DELETE FROM issues_files WHERE file_id = ? AND issue_id = ?;', (action['file_id'], action['issue_id']))
            record_conflict(volume_id=volume_id, filepath=action['filepath'], file_id=action['file_id'], proposed_issue_id=action['issue_id'], proposed_issue_numbers=[action['issue_id']], reason='duplicate_content', resolution='quarantined_duplicate', resolved_at=round(time()))
            applied.append({**action, 'quarantine_path': target})
        elif action['action'] in ('remove_missing_mapping', 'unmap_range_file', 'remove_multi_issue_file_mapping'):
            get_db().execute('DELETE FROM issues_files WHERE file_id = ? AND issue_id = ?;', (action['file_id'], action['issue_id']))
            reason = 'multi_issue_range' if action['action'] == 'unmap_range_file' else 'file_claims_multiple_issues'
            if action['action'] == 'remove_missing_mapping': reason = 'postprocessing_incomplete'
            record_conflict(volume_id=volume_id, filepath=action['filepath'], file_id=action['file_id'], proposed_issue_id=action['issue_id'], proposed_issue_numbers=[action['issue_id']], reason=reason, resolution='unmapped_for_review', resolved_at=round(time()))
            applied.append(action)
        elif action['action'] == 'review_nonidentical_duplicate':
            record_conflict(volume_id=volume_id, filepath=action['filepath'], file_id=action['file_id'], proposed_issue_id=action['issue_id'], proposed_issue_numbers=[action['issue_id']], reason='nonidentical_duplicate')
            applied.append(action)
    commit()
    return {'volume_id': volume_id, 'dry_run': False, 'applied': applied, 'remaining_plan': dry_run_volume_repair(volume_id)}
