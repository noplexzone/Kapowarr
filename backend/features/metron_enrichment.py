# -*- coding: utf-8 -*-
"""Central Metron enrichment and provider-link persistence."""

from __future__ import annotations

from json import dumps, loads
from time import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from backend.base.definitions import Constants
from backend.base.logging import LOGGER
from backend.implementations.metron import (
    METRON_PROVIDER, MetronAuthenticationError, MetronClient, MetronError,
    MetronNotModifiedError, MetronRateLimitedError,
)
from backend.internals.db import commit, get_db
from backend.internals.settings import Settings

RESOURCE_SERIES = 'series'
STATUS_LINKED = 'linked'
STATUS_UNAVAILABLE = 'unavailable'
STATUS_REVIEW = 'review_required'


def now_ts() -> int:
    return round(time())


def _json_or_empty(value: str) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        loaded = loads(value)
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def metron_configured() -> bool:
    sv = Settings().sv
    return bool(sv.metron_enabled and sv.metron_api_token and sv.metron_api_token != Constants.CREDENTIAL_REPLACEMENT)


def get_metron_client() -> MetronClient:
    return MetronClient(Settings().sv.metron_api_token)


def _string_id(item: Dict[str, Any]) -> Optional[str]:
    for key in ('id', 'pk', 'series_id'):
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value)
    url = item.get('url') or item.get('resource_url')
    if isinstance(url, str):
        parts = [p for p in url.rstrip('/').split('/') if p]
        if parts:
            return parts[-1]
    return None


def _name_id(item: Dict[str, Any], fallback: str) -> Tuple[str, str]:
    external_id = _string_id(item) or fallback
    name = str(item.get('name') or item.get('title') or item.get('full_name') or external_id).strip()
    return external_id, name


def _iter_values(payload: Dict[str, Any], keys: Tuple[str, ...]) -> Iterable[Any]:
    for key in keys:
        values = payload.get(key)
        if values is None:
            continue
        if isinstance(values, dict):
            nested = values.get('results') or values.get('items') or values.get('data')
            values = nested if nested is not None else [values]
        if not isinstance(values, list):
            values = [values]
        for value in values:
            yield value


def extract_terms(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    """Normalize additive Metron data into indexed local provenance terms.

    The official schema can grow; this accepts optional/null/mixed list shapes and
    keeps unknown richer provider payload in provider_cache for troubleshooting.
    """
    terms: List[Dict[str, str]] = []
    field_map: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
        ('character', ('characters', 'character_credits')),
        ('genre', ('genres', 'genre')),
        ('creator', ('creators', 'credits', 'creator_credits')),
        ('imprint', ('imprint', 'imprints')),
        ('alternate_title', ('aliases', 'alternative_titles', 'alternate_titles')),
        ('identifier', ('identifiers', 'external_ids')),
        ('artwork', ('images', 'covers', 'alternate_artwork')),
    )
    seen = set()
    for term_type, keys in field_map:
        for index, item in enumerate(_iter_values(payload, keys)):
            if isinstance(item, str):
                name = item.strip()
                external_id = name.lower()
            elif isinstance(item, dict):
                external_id, name = _name_id(item, f'{term_type}:{index}')
                if term_type == 'identifier':
                    name = str(item.get('source') or item.get('provider') or item.get('type') or name).strip()
                    external_id = str(item.get('id') or item.get('value') or external_id).strip()
                if term_type == 'artwork':
                    name = str(item.get('caption') or item.get('type') or item.get('image') or item.get('url') or name).strip()
            else:
                continue
            if not name:
                continue
            key = (term_type, external_id, name)
            if key not in seen:
                seen.add(key)
                terms.append({'term_type': term_type, 'external_id': external_id, 'name': name})
    return terms


class MetronEnrichmentService:
    def __init__(self, client: Optional[MetronClient] = None) -> None:
        self.client = client or get_metron_client()

    @staticmethod
    def get_link(volume_id: int) -> Optional[Dict[str, Any]]:
        return get_db().execute(
            """SELECT * FROM volume_provider_links
            WHERE volume_id = ? AND provider = ? AND resource_type = ? LIMIT 1;""",
            (volume_id, METRON_PROVIDER, RESOURCE_SERIES),
        ).fetchonedict()

    @staticmethod
    def get_volume_provenance(volume_id: int) -> Dict[str, Any]:
        link = MetronEnrichmentService.get_link(volume_id)
        terms = get_db().execute(
            """SELECT term_type, external_id, name, provider
            FROM volume_enrichment_terms
            WHERE volume_id = ?
            ORDER BY term_type, name COLLATE NOCASE;""",
            (volume_id,),
        ).fetchalldict()
        badges = [{'provider': 'comicvine', 'label': 'Canonical: ComicVine', 'role': 'canonical'}]
        if link and link.get('review_status') == STATUS_LINKED:
            badges.append({'provider': 'metron', 'label': 'Enriched by: Metron', 'role': 'enrichment'})
        return {
            'canonical_provider': 'comicvine',
            'enriched_by': ['metron'] if link and link.get('review_status') == STATUS_LINKED else [],
            'provider_badges': badges,
            'metron': {
                'series_id': link.get('external_id') if link else None,
                'match_status': link.get('review_status') if link else None,
                'match_method': link.get('match_method') if link else None,
                'last_successful_enrichment': link.get('last_successful_enrichment') if link else None,
                'last_checked': link.get('last_checked') if link else None,
            },
            'enrichment_terms': terms,
        }

    def match_from_comicvine(self, volume_id: int, comicvine_id: int) -> Dict[str, Any]:
        checked_at = now_ts()
        matches = self.client.find_series_by_comicvine_id(comicvine_id)
        valid = [m for m in matches if _string_id(m)]
        if len(valid) == 1:
            series_id = _string_id(valid[0]) or ''
            self._upsert_link(volume_id, series_id, STATUS_LINKED, 'comicvine_id', 1.0, checked_at)
            return {'status': STATUS_LINKED, 'series_id': series_id}
        if not valid:
            self._upsert_link(volume_id, '', STATUS_UNAVAILABLE, 'comicvine_id', 0.0, checked_at)
            return {'status': STATUS_UNAVAILABLE, 'series_id': None}
        self._upsert_link(volume_id, '', STATUS_REVIEW, 'comicvine_id', 0.0, checked_at)
        return {'status': STATUS_REVIEW, 'series_id': None, 'candidates': [_string_id(v) for v in valid]}

    def refresh_volume(self, volume_id: int) -> Dict[str, Any]:
        row = get_db().execute(
            """SELECT v.id, v.comicvine_id, rf.section, v.metadata_source
            FROM volumes v INNER JOIN root_folders rf ON rf.id = v.root_folder
            WHERE v.id = ? LIMIT 1;""",
            (volume_id,),
        ).fetchonedict()
        if not row:
            return {'status': 'missing'}
        if row['section'] != 'comic' or row['metadata_source'] != 'comicvine':
            return {'status': 'skipped_manga'}
        link = self.get_link(volume_id)
        if not link or not link.get('external_id'):
            matched = self.match_from_comicvine(volume_id, int(row['comicvine_id']))
            if matched['status'] != STATUS_LINKED:
                return matched
            link = self.get_link(volume_id)
        series_id = str(link['external_id'])
        cache = get_db().execute(
            """SELECT last_modified FROM provider_cache
            WHERE provider = ? AND resource_type = ? AND external_id = ?;""",
            (METRON_PROVIDER, RESOURCE_SERIES, series_id),
        ).fetchonedict() or {}
        try:
            payload = self.client.get_series(series_id, cache.get('last_modified'))
        except MetronNotModifiedError:
            cached_payload = get_db().execute(
                """SELECT payload FROM provider_cache
                WHERE provider = ? AND resource_type = ? AND external_id = ?;""",
                (METRON_PROVIDER, RESOURCE_SERIES, series_id),
            ).fetchonedict() or {}
            payload = loads(cached_payload.get('payload') or '{}')
        self.apply_payload(volume_id, series_id, payload)
        ts = now_ts()
        get_db().execute(
            """UPDATE volume_provider_links
            SET review_status = ?, last_successful_enrichment = ?, last_checked = ?
            WHERE volume_id = ? AND provider = ? AND resource_type = ?;""",
            (STATUS_LINKED, ts, ts, volume_id, METRON_PROVIDER, RESOURCE_SERIES),
        )
        Settings().update({'metron_last_enrichment_run': ts})
        commit()
        return {'status': STATUS_LINKED, 'series_id': series_id, 'terms': extract_terms(payload)}

    def relink(self, volume_id: int, series_id: str) -> Dict[str, Any]:
        self._upsert_link(volume_id, series_id.strip(), STATUS_LINKED, 'manual', 1.0, now_ts())
        return self.refresh_volume(volume_id)

    @staticmethod
    def unlink(volume_id: int) -> Dict[str, Any]:
        db = get_db()
        db.execute('DELETE FROM volume_enrichment_terms WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))
        db.execute('DELETE FROM volume_provider_links WHERE volume_id = ? AND provider = ? AND resource_type = ?;', (volume_id, METRON_PROVIDER, RESOURCE_SERIES))
        commit()
        return {'status': 'removed'}

    def apply_payload(self, volume_id: int, series_id: str, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError('Metron payload must be a dict')
        db = get_db()
        ts = now_ts()
        db.execute(
            """INSERT INTO provider_cache(provider, resource_type, external_id, payload, etag, last_modified, fetched_at, expires_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, resource_type, external_id) DO UPDATE SET
                payload = excluded.payload,
                etag = excluded.etag,
                last_modified = excluded.last_modified,
                fetched_at = excluded.fetched_at,
                expires_at = excluded.expires_at;""",
            (METRON_PROVIDER, RESOURCE_SERIES, series_id, dumps(payload), payload.get('_metron_etag'), payload.get('_metron_last_modified') or payload.get('modified') or payload.get('last_modified'), ts, None),
        )
        db.execute('DELETE FROM volume_enrichment_terms WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))
        db.executemany(
            """INSERT OR IGNORE INTO volume_enrichment_terms(volume_id, provider, term_type, external_id, name)
            VALUES(?, ?, ?, ?, ?);""",
            ((volume_id, METRON_PROVIDER, t['term_type'], t['external_id'], t['name']) for t in extract_terms(payload)),
        )
        # Scalar precedence: only fill blank ComicVine fields. Keep canonical nonempty values intact.
        scalar_updates: Dict[str, Any] = {}
        row = db.execute('SELECT publisher, description FROM volumes WHERE id = ?;', (volume_id,)).fetchonedict() or {}
        imprint = payload.get('imprint')
        if not row.get('publisher') and isinstance(imprint, dict):
            scalar_updates['publisher'] = imprint.get('name')
        elif not row.get('publisher') and isinstance(imprint, str):
            scalar_updates['publisher'] = imprint.strip()
        desc = payload.get('desc') or payload.get('description')
        if not row.get('description') and isinstance(desc, str) and desc.strip():
            scalar_updates['description'] = desc.strip()
        if scalar_updates:
            assignments = ', '.join(f'{k} = :{k}' for k in scalar_updates)
            scalar_updates['id'] = volume_id
            db.execute(f'UPDATE volumes SET {assignments} WHERE id = :id;', scalar_updates)
        commit()

    @staticmethod
    def _upsert_link(volume_id: int, external_id: str, status: str, method: str, confidence: float, ts: int) -> None:
        get_db().execute(
            """INSERT INTO volume_provider_links(
                volume_id, provider, resource_type, external_id, match_method,
                match_confidence, review_status, linked_at, last_checked
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(volume_id, provider, resource_type) DO UPDATE SET
                external_id = excluded.external_id,
                match_method = excluded.match_method,
                match_confidence = excluded.match_confidence,
                review_status = excluded.review_status,
                last_checked = excluded.last_checked;""",
            (volume_id, METRON_PROVIDER, RESOURCE_SERIES, external_id, method, confidence, status, ts, ts),
        )
        commit()


def get_backfill_status() -> Dict[str, Any]:
    row = get_db().execute('SELECT * FROM metron_backfill_state WHERE id = 1;').fetchonedict()
    if not row:
        return {'status': 'idle', 'total': 0, 'processed': 0, 'matched': 0, 'unmatched': 0, 'review_required': 0, 'failed': 0}
    return dict(row)


def update_backfill_state(**kwargs: Any) -> None:
    current = get_backfill_status()
    current.update(kwargs)
    current.setdefault('id', 1)
    current['updated_at'] = now_ts()
    fields = ('id', 'status', 'total', 'processed', 'matched', 'unmatched', 'review_required', 'failed', 'current_volume_id', 'rate_limit_paused_until', 'cancel_requested', 'started_at', 'updated_at', 'completed_at')
    values = {field: current.get(field) for field in fields}
    get_db().execute(
        """INSERT INTO metron_backfill_state(id, status, total, processed, matched, unmatched, review_required, failed, current_volume_id, rate_limit_paused_until, cancel_requested, started_at, updated_at, completed_at)
        VALUES(:id, :status, :total, :processed, :matched, :unmatched, :review_required, :failed, :current_volume_id, :rate_limit_paused_until, :cancel_requested, :started_at, :updated_at, :completed_at)
        ON CONFLICT(id) DO UPDATE SET
            status = excluded.status, total = excluded.total, processed = excluded.processed,
            matched = excluded.matched, unmatched = excluded.unmatched,
            review_required = excluded.review_required, failed = excluded.failed,
            current_volume_id = excluded.current_volume_id,
            rate_limit_paused_until = excluded.rate_limit_paused_until,
            cancel_requested = excluded.cancel_requested,
            started_at = excluded.started_at, updated_at = excluded.updated_at,
            completed_at = excluded.completed_at;""",
        values,
    )
    Settings().update({'metron_backfill_status': dumps(get_backfill_status())})
    commit()


def safe_test_connection() -> Dict[str, Any]:
    try:
        result = get_metron_client().test_connection()
        ts = now_ts()
        Settings().update({
            'metron_last_successful_connection': ts,
            'metron_rate_limit_status': dumps(result.get('rate_limit') or {}),
        })
        return {'success': True, 'status': 'ok', 'description': 'Connection successful', 'rate_limit': result.get('rate_limit')}
    except MetronError as exc:
        if isinstance(exc, MetronAuthenticationError):
            Settings().update({'metron_enabled': False})
        rate = exc.rate_limit.todict() if exc.rate_limit else None
        if rate:
            Settings().update({'metron_rate_limit_status': dumps(rate)})
        return {'success': False, 'status': exc.status, 'description': str(exc), 'rate_limit': rate}


# ---- Hardened Phase 6 review/provenance/rate/backfill helpers ----
from uuid import uuid4
from backend.implementations.metron import get_rate_limit_state

STATUS_PENDING = 'pending'
STATUS_DISMISSED = 'dismissed'
SCALAR_FALLBACK_FIELDS = {
    'title': ('name', 'title'),
    'year': ('year_began', 'year'),
    'publisher': ('publisher', 'imprint'),
    'description': ('desc', 'description', 'summary'),
    'volume_number': ('volume', 'volume_number'),
}


def _display_value(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get('name') or value.get('title') or value.get('id') or '').strip()
    if value is None:
        return ''
    return str(value).strip()


def _first_payload_value(payload: Dict[str, Any], keys: Tuple[str, ...]) -> str:
    for key in keys:
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, list):
            value = value[0] if value else None
        result = _display_value(value)
        if result:
            return result
    return ''


def _volume_is_comicvine_comic(volume_id: int) -> bool:
    row = get_db().execute(
        """SELECT v.metadata_source, rf.section FROM volumes v
        INNER JOIN root_folders rf ON rf.id = v.root_folder WHERE v.id = ? LIMIT 1;""",
        (volume_id,),
    ).fetchonedict()
    return bool(row and row['section'] == 'comic' and row['metadata_source'] == 'comicvine')


def _clear_candidates(volume_id: int) -> None:
    get_db().execute('DELETE FROM provider_match_candidates WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))


def _candidate_from_payload(volume_id: int, item: Dict[str, Any], review_group_id: str) -> Dict[str, Any]:
    external_id = _string_id(item) or ''
    return {
        'volume_id': volume_id,
        'provider': METRON_PROVIDER,
        'resource_type': RESOURCE_SERIES,
        'candidate_external_id': external_id,
        'title': str(item.get('name') or item.get('title') or external_id).strip(),
        'year': item.get('year_began') or item.get('year') or None,
        'publisher': _display_value(item.get('publisher')),
        'cover_url': _display_value(item.get('image') or item.get('cover')),
        'summary': str(item.get('desc') or item.get('description') or item.get('summary') or '')[:2000],
        'confidence': 1.0 if external_id else 0.0,
        'match_reason': 'comicvine_id',
        'review_group_id': review_group_id,
        'review_status': STATUS_REVIEW,
        'payload': dumps(item, separators=(',', ':')),
    }


def _insert_candidate(candidate: Dict[str, Any]) -> None:
    ts = now_ts()
    get_db().execute(
        """INSERT INTO provider_match_candidates(
            volume_id, provider, resource_type, candidate_external_id, title, year, publisher,
            cover_url, summary, confidence, match_reason, review_group_id, review_status, payload, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
        (candidate['volume_id'], candidate['provider'], candidate['resource_type'], candidate['candidate_external_id'], candidate['title'],
         candidate.get('year'), candidate.get('publisher'), candidate.get('cover_url'), candidate.get('summary'), candidate.get('confidence'),
         candidate.get('match_reason'), candidate.get('review_group_id'), candidate.get('review_status'), candidate.get('payload'), ts, ts),
    )


def get_review_candidates(volume_id: Optional[int] = None, status: str = STATUS_REVIEW, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    params: List[Any] = [METRON_PROVIDER, status]
    where = 'provider = ? AND review_status = ?'
    if volume_id is not None:
        where += ' AND volume_id = ?'; params.append(volume_id)
    count = get_db().execute(f'SELECT COUNT(*) FROM provider_match_candidates WHERE {where};', tuple(params)).fetchone()[0]
    rows = get_db().execute(
        f"""SELECT id, volume_id, provider, resource_type, candidate_external_id, title, year,
               publisher, cover_url, summary, confidence, match_reason, review_group_id,
               review_status, created_at, updated_at FROM provider_match_candidates
           WHERE {where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?;""",
        (*params, min(max(limit, 1), 100), max(offset, 0)),
    ).fetchalldict()
    return {'total': count, 'candidates': rows, 'limit': limit, 'offset': offset}


def _hardened_get_volume_provenance(volume_id: int) -> Dict[str, Any]:
    base = MetronEnrichmentService.get_link(volume_id)
    terms = get_db().execute(
        """SELECT term_type, external_id, name, provider FROM volume_enrichment_terms
        WHERE volume_id = ? ORDER BY term_type, name COLLATE NOCASE;""",
        (volume_id,),
    ).fetchalldict()
    scalars = get_db().execute(
        """SELECT field_name, normalized_value, provider, external_provider_id, updated_at
        FROM volume_metadata_enrichment WHERE volume_id = ? AND provider = ? AND active = 1
        ORDER BY field_name;""",
        (volume_id, METRON_PROVIDER),
    ).fetchalldict()
    badges = [{'provider': 'comicvine', 'label': 'Canonical: ComicVine', 'role': 'canonical'}]
    if base and base.get('review_status') == STATUS_LINKED:
        badges.append({'provider': 'metron', 'label': 'Enriched by: Metron', 'role': 'enrichment'})
    return {
        'canonical_provider': 'comicvine',
        'enriched_by': ['metron'] if base and base.get('review_status') == STATUS_LINKED else [],
        'provider_badges': badges,
        'metron': {
            'series_id': base.get('external_id') if base else None,
            'match_status': base.get('review_status') if base else None,
            'match_method': base.get('match_method') if base else None,
            'last_successful_enrichment': base.get('last_successful_enrichment') if base else None,
            'last_checked': base.get('last_checked') if base else None,
        },
        'scalar_fallbacks': scalars,
        'enrichment_terms': terms,
    }


def _hardened_match_from_comicvine(self, volume_id: int, comicvine_id: int) -> Dict[str, Any]:
    if not _volume_is_comicvine_comic(volume_id):
        return {'status': 'skipped_manga'}
    checked_at = now_ts()
    matches = self.client.find_series_by_comicvine_id(comicvine_id)
    valid = [m for m in matches if _string_id(m)]
    _clear_candidates(volume_id)
    if len(valid) == 1:
        series_id = _string_id(valid[0]) or ''
        self._upsert_link(volume_id, series_id, STATUS_LINKED, 'comicvine_id', 1.0, checked_at)
        return {'status': STATUS_LINKED, 'series_id': series_id}
    if not valid:
        self._upsert_link(volume_id, '', STATUS_UNAVAILABLE, 'comicvine_id', 0.0, checked_at)
        return {'status': STATUS_UNAVAILABLE, 'series_id': None}
    review_group_id = str(uuid4())
    self._upsert_link(volume_id, '', STATUS_REVIEW, 'comicvine_id', 0.0, checked_at)
    for item in valid:
        _insert_candidate(_candidate_from_payload(volume_id, item, review_group_id))
    commit()
    return {'status': STATUS_REVIEW, 'series_id': None, 'review_group_id': review_group_id, 'candidates': get_review_candidates(volume_id)['candidates']}


def _hardened_apply_payload(self, volume_id: int, series_id: str, payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError('Metron payload must be a dict')
    db = get_db(); ts = now_ts()
    db.execute(
        """INSERT INTO provider_cache(provider, resource_type, external_id, payload, etag, last_modified, fetched_at, expires_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, resource_type, external_id) DO UPDATE SET
            payload = excluded.payload, last_modified = excluded.last_modified,
            fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;""",
        (METRON_PROVIDER, RESOURCE_SERIES, series_id, dumps(payload, separators=(',', ':')), None,
         payload.get('_metron_last_modified') or payload.get('modified') or payload.get('last_modified'), ts, None),
    )
    db.execute('UPDATE volume_metadata_enrichment SET active = 0, updated_at = ? WHERE volume_id = ? AND provider = ?;', (ts, volume_id, METRON_PROVIDER))
    for field_name, keys in SCALAR_FALLBACK_FIELDS.items():
        value = _first_payload_value(payload, keys)
        if value:
            db.execute(
                """INSERT INTO volume_metadata_enrichment(volume_id, provider, field_name, normalized_value, external_provider_id, updated_at, active)
                VALUES(?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(volume_id, provider, field_name) DO UPDATE SET
                    normalized_value = excluded.normalized_value,
                    external_provider_id = excluded.external_provider_id,
                    updated_at = excluded.updated_at,
                    active = 1;""",
                (volume_id, METRON_PROVIDER, field_name, value, series_id, ts),
            )
    db.execute('DELETE FROM volume_enrichment_terms WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))
    db.executemany(
        """INSERT OR IGNORE INTO volume_enrichment_terms(volume_id, provider, term_type, external_id, name)
        VALUES(?, ?, ?, ?, ?);""",
        ((volume_id, METRON_PROVIDER, t['term_type'], t['external_id'], t['name']) for t in extract_terms(payload)),
    )
    commit()


def _hardened_unlink(volume_id: int) -> Dict[str, Any]:
    db = get_db(); ts = now_ts()
    db.execute('UPDATE volume_metadata_enrichment SET active = 0, updated_at = ? WHERE volume_id = ? AND provider = ?;', (ts, volume_id, METRON_PROVIDER))
    db.execute('DELETE FROM volume_enrichment_terms WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))
    db.execute('DELETE FROM provider_match_candidates WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))
    db.execute('DELETE FROM volume_provider_links WHERE volume_id = ? AND provider = ? AND resource_type = ?;', (volume_id, METRON_PROVIDER, RESOURCE_SERIES))
    commit(); return {'status': 'removed'}


def relink_pending(volume_id: int, series_id: str, candidate_id: Optional[int] = None) -> Dict[str, Any]:
    series_id = series_id.strip()
    if not series_id:
        raise ValueError('Metron series ID is required')
    if candidate_id is not None:
        candidate = get_db().execute(
            """SELECT * FROM provider_match_candidates WHERE id = ? AND volume_id = ? AND provider = ? LIMIT 1;""",
            (candidate_id, volume_id, METRON_PROVIDER),
        ).fetchonedict()
        if not candidate or str(candidate['candidate_external_id']) != series_id:
            raise ValueError('Candidate does not match this volume')
    MetronEnrichmentService._upsert_link(volume_id, series_id, STATUS_PENDING, 'manual', 1.0, now_ts())
    return {'status': STATUS_PENDING, 'series_id': series_id}


def resolve_candidate(candidate_id: int) -> Dict[str, Any]:
    candidate = get_db().execute('SELECT * FROM provider_match_candidates WHERE id = ? LIMIT 1;', (candidate_id,)).fetchonedict()
    if not candidate:
        raise ValueError('Candidate not found')
    result = relink_pending(int(candidate['volume_id']), str(candidate['candidate_external_id']), candidate_id)
    get_db().execute("UPDATE provider_match_candidates SET review_status = 'resolved', updated_at = ? WHERE volume_id = ? AND provider = ?;", (now_ts(), candidate['volume_id'], METRON_PROVIDER))
    commit(); return {'volume_id': int(candidate['volume_id']), **result}


def dismiss_review(volume_id: int) -> Dict[str, Any]:
    get_db().execute('DELETE FROM provider_match_candidates WHERE volume_id = ? AND provider = ?;', (volume_id, METRON_PROVIDER))
    commit(); return {'status': STATUS_DISMISSED}


def metron_settings_status() -> Dict[str, Any]:
    sv = Settings().sv
    state = get_db().execute('SELECT * FROM metron_backfill_state WHERE id = 1;').fetchonedict() or {}
    return {
        'enabled': bool(sv.metron_enabled),
        'token_configured': bool(sv.metron_api_token and sv.metron_api_token != Constants.CREDENTIAL_REPLACEMENT),
        'token_masked': Constants.CREDENTIAL_REPLACEMENT if sv.metron_api_token else '',
        'last_successful_connection': sv.metron_last_successful_connection or None,
        'last_enrichment': sv.metron_last_enrichment_run or None,
        'rate_limit': get_rate_limit_state(),
        'backfill': dict(state),
    }


def queue_metron_enrichment(volume_id: int) -> Optional[int]:
    if not metron_configured() or not _volume_is_comicvine_comic(volume_id):
        return None
    try:
        from backend.features.tasks import MetronEnrichmentTask, TaskHandler
        return TaskHandler().add(MetronEnrichmentTask(volume_id))
    except Exception:
        LOGGER.exception('Failed to queue Metron enrichment for volume %d', volume_id)
        return None


def browse_enriched_terms(term_type: str, query: str = '', page: int = 1, page_size: int = 50) -> Dict[str, Any]:
    if term_type not in ('character', 'genre'):
        raise ValueError('Unsupported Metron browse term')
    limit = min(max(int(page_size or 50), 1), 100); offset = max(int(page or 1) - 1, 0) * limit
    params: List[Any] = [term_type, METRON_PROVIDER]
    where = 'vet.term_type = ? AND vet.provider = ?'
    if query:
        where += ' AND vet.name LIKE ?'; params.append(f'%{query}%')
    count = get_db().execute(f"SELECT COUNT(DISTINCT vet.name) FROM volume_enrichment_terms vet WHERE {where};", tuple(params)).fetchone()[0]
    rows = get_db().execute(
        f"""SELECT vet.name, COUNT(DISTINCT v.id) AS volume_count
        FROM volume_enrichment_terms vet
        INNER JOIN volumes v ON v.id = vet.volume_id
        INNER JOIN root_folders rf ON rf.id = v.root_folder
        WHERE {where} AND rf.section = 'comic' AND v.metadata_source = 'comicvine'
        GROUP BY vet.name ORDER BY vet.name COLLATE NOCASE LIMIT ? OFFSET ?;""",
        (*params, limit, offset),
    ).fetchalldict()
    return {'terms': rows, 'total': count, 'page': page, 'page_size': limit}



def browse_enriched_volumes(term_type: str, term: str = '', query: str = '', offset: int = 0, limit: int = 30, sort: str = 'title') -> Dict[str, Any]:
    """Return canonical ComicVine-backed local comics indexed by Metron terms."""
    if term_type not in ('character', 'genre'):
        raise ValueError('Unsupported Metron browse term')
    limit = min(max(int(limit or 30), 1), 100)
    offset = max(int(offset or 0), 0)
    params: List[Any] = [term_type, METRON_PROVIDER]
    where = "vet.term_type = ? AND vet.provider = ? AND rf.section = 'comic' AND v.metadata_source = 'comicvine'"
    if term:
        where += ' AND vet.name = ?'; params.append(term)
    if query:
        where += ' AND v.title LIKE ?'; params.append(f'%{query}%')
    order = 'v.title COLLATE NOCASE ASC'
    if sort in ('year', 'recently_started'):
        order = 'COALESCE(v.year, 0) DESC, v.title COLLATE NOCASE ASC'
    count = get_db().execute(
        f"""SELECT COUNT(DISTINCT v.id) FROM volumes v
        INNER JOIN root_folders rf ON rf.id = v.root_folder
        INNER JOIN volume_enrichment_terms vet ON vet.volume_id = v.id
        WHERE {where};""",
        tuple(params),
    ).fetchone()[0]
    rows = get_db().execute(
        f"""SELECT v.id, v.comicvine_id, v.metadata_source, v.metadata_id, v.metadata_language,
            v.title, v.year, v.publisher, v.volume_number,
            COUNT(DISTINCT i.id) AS issue_count,
            vet.name AS metron_term
        FROM volumes v
        INNER JOIN root_folders rf ON rf.id = v.root_folder
        INNER JOIN volume_enrichment_terms vet ON vet.volume_id = v.id
        LEFT JOIN issues i ON i.volume_id = v.id
        WHERE {where}
        GROUP BY v.id
        ORDER BY {order}
        LIMIT ? OFFSET ?;""",
        (*params, limit, offset),
    ).fetchalldict()
    items = []
    for row in rows:
        item = dict(row)
        item['already_added'] = item['id']
        item['metadata_source_label'] = 'ComicVine + Metron'
        item['source_note'] = f"Filtered by local Metron {term_type} enrichment; ComicVine remains canonical."
        item['status'] = f"Metron {term_type}: {item.pop('metron_term', term)}"
        items.append(item)
    return {
        'items': items,
        'total': int(count or 0),
        'offset': offset,
        'page_size': limit,
        'has_more': offset + len(items) < int(count or 0),
        'source_note': f"{term_type.title()} filter uses locally indexed Metron enrichment for ComicVine-backed comics only.",
    }

def update_backfill_terminal(result_status: str, volume_id: int, counters: Optional[Dict[str, int]] = None, error: str = '') -> None:
    row = get_db().execute('SELECT * FROM metron_backfill_state WHERE id = 1;').fetchonedict() or {'id': 1, 'status': 'running'}
    counters = counters or {}
    row['processed'] = int(row.get('processed') or 0) + 1
    row['last_terminal_volume_id'] = volume_id
    row['current_volume_id'] = volume_id
    row['updated_at'] = now_ts()
    if error:
        row['last_error'] = error
    for key in ('matched', 'unmatched', 'review_required', 'failed', 'skipped'):
        row[key] = int(row.get(key) or 0) + int(counters.get(key, 0))
    fields = ('id','status','total','total_estimate','processed','matched','unmatched','review_required','failed','skipped','current_volume_id','last_terminal_volume_id','rate_limit_paused_until','last_error','resume_time','cancel_requested','started_at','updated_at','completed_at')
    for f in fields:
        row.setdefault(f, 0 if f not in ('last_error','resume_time','completed_at') else None)
    get_db().execute("""INSERT INTO metron_backfill_state(id,status,total,total_estimate,processed,matched,unmatched,review_required,failed,skipped,current_volume_id,last_terminal_volume_id,rate_limit_paused_until,last_error,resume_time,cancel_requested,started_at,updated_at,completed_at)
        VALUES(:id,:status,:total,:total_estimate,:processed,:matched,:unmatched,:review_required,:failed,:skipped,:current_volume_id,:last_terminal_volume_id,:rate_limit_paused_until,:last_error,:resume_time,:cancel_requested,:started_at,:updated_at,:completed_at)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,total=excluded.total,total_estimate=excluded.total_estimate,processed=excluded.processed,matched=excluded.matched,unmatched=excluded.unmatched,review_required=excluded.review_required,failed=excluded.failed,skipped=excluded.skipped,current_volume_id=excluded.current_volume_id,last_terminal_volume_id=excluded.last_terminal_volume_id,rate_limit_paused_until=excluded.rate_limit_paused_until,last_error=excluded.last_error,resume_time=excluded.resume_time,cancel_requested=excluded.cancel_requested,started_at=excluded.started_at,updated_at=excluded.updated_at,completed_at=excluded.completed_at;""", {f: row.get(f) for f in fields})
    commit()


MetronEnrichmentService.get_volume_provenance = staticmethod(_hardened_get_volume_provenance)
MetronEnrichmentService.match_from_comicvine = _hardened_match_from_comicvine
MetronEnrichmentService.apply_payload = _hardened_apply_payload
MetronEnrichmentService.unlink = staticmethod(_hardened_unlink)
MetronEnrichmentService.get_review_candidates = staticmethod(get_review_candidates)
MetronEnrichmentService.volume_is_comicvine_comic = staticmethod(_volume_is_comicvine_comic)
