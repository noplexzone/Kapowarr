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
    MetronRateLimitedError,
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


def extract_terms(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    terms: List[Dict[str, str]] = []
    for term_type, keys in (('character', ('characters', 'character_credits')), ('genre', ('genres', 'genre'))):
        for key in keys:
            values = payload.get(key)
            if values is None:
                continue
            if isinstance(values, dict):
                values = values.get('results') or values.get('items') or []
            if not isinstance(values, list):
                continue
            for index, item in enumerate(values):
                if isinstance(item, str):
                    name = item.strip()
                    external_id = name.lower()
                elif isinstance(item, dict):
                    external_id, name = _name_id(item, f'{key}:{index}')
                else:
                    continue
                if name:
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
        payload = self.client.get_series(series_id, cache.get('last_modified'))
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
            (METRON_PROVIDER, RESOURCE_SERIES, series_id, dumps(payload), None, payload.get('modified') or payload.get('last_modified'), ts, None),
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
