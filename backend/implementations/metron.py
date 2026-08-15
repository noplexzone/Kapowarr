# -*- coding: utf-8 -*-
"""Metron API client for optional ComicVine-backed comic enrichment."""

from __future__ import annotations

from dataclasses import dataclass
from json import JSONDecodeError
from time import time
from typing import Any, Dict, List, Mapping, Optional
from urllib.parse import SplitResult, urljoin, urlsplit, urlunsplit

import requests
from requests import Response, Session
from requests.exceptions import RequestException, Timeout

from backend.internals.db import commit, get_db
from backend.internals.settings import get_about_data

METRON_BASE_URL = 'https://metron.cloud/api/'
METRON_PROVIDER = 'metron'

@dataclass(frozen=True)
class MetronRateLimit:
    burst_limit: Optional[int] = None
    burst_remaining: Optional[int] = None
    burst_reset: Optional[int] = None
    sustained_limit: Optional[int] = None
    sustained_remaining: Optional[int] = None
    sustained_reset: Optional[int] = None
    retry_after: Optional[int] = None
    @property
    def pause_until(self) -> Optional[int]:
        candidates = []
        if self.retry_after is not None:
            candidates.append(round(time()) + max(0, self.retry_after))
        if self.burst_remaining == 0 and self.burst_reset:
            candidates.append(self.burst_reset)
        if self.sustained_remaining == 0 and self.sustained_reset:
            candidates.append(self.sustained_reset)
        return max(candidates) if candidates else None
    def todict(self) -> Dict[str, Optional[int]]:
        result = self.__dict__.copy(); result['pause_until'] = self.pause_until; return result

class MetronError(Exception):
    status = 'error'; terminal = False
    def __init__(self, message: str = '', rate_limit: Optional[MetronRateLimit] = None) -> None:
        super().__init__(message or self.status); self.rate_limit = rate_limit
class MetronAuthenticationError(MetronError): status = 'authentication_failed'; terminal = True
class MetronPermissionError(MetronError): status = 'permission_denied'; terminal = True
class MetronNotFoundError(MetronError): status = 'not_found'; terminal = True
class MetronNotModifiedError(MetronError): status = 'not_modified'
class MetronRateLimitedError(MetronError): status = 'rate_limited'
class MetronTemporaryError(MetronError): status = 'temporary_failure'
class MetronInvalidResponseError(MetronError): status = 'invalid_response'; terminal = True
class MetronTimeoutError(MetronError): status = 'timeout'
class MetronNetworkError(MetronError): status = 'network_error'
class MetronPausedError(MetronRateLimitedError): status = 'paused'

def _parse_int(value: Optional[str]) -> Optional[int]:
    if value is None or value == '': return None
    try: return int(float(value))
    except (TypeError, ValueError): return None

def parse_rate_limit_headers(headers: Mapping[str, str]) -> MetronRateLimit:
    return MetronRateLimit(
        burst_limit=_parse_int(headers.get('X-RateLimit-Burst-Limit')),
        burst_remaining=_parse_int(headers.get('X-RateLimit-Burst-Remaining')),
        burst_reset=_parse_int(headers.get('X-RateLimit-Burst-Reset')),
        sustained_limit=_parse_int(headers.get('X-RateLimit-Sustained-Limit')),
        sustained_remaining=_parse_int(headers.get('X-RateLimit-Sustained-Remaining')),
        sustained_reset=_parse_int(headers.get('X-RateLimit-Sustained-Reset')),
        retry_after=_parse_int(headers.get('Retry-After')),
    )

def safe_headers(headers: Mapping[str, str]) -> Dict[str, str]:
    return {key: ('[REDACTED]' if key.lower() == 'authorization' else value) for key, value in headers.items()}

def _rate_state_row(provider: str = METRON_PROVIDER) -> Dict[str, Any]:
    try:
        return get_db().execute('SELECT * FROM provider_rate_limit_state WHERE provider = ? LIMIT 1;', (provider,)).fetchonedict() or {}
    except Exception:
        return {}

def get_rate_limit_state(provider: str = METRON_PROVIDER) -> Dict[str, Any]:
    row = _rate_state_row(provider)
    return dict(row) if row else {'provider': provider}

def update_rate_limit_state(rate: MetronRateLimit, status: str = 'ok', provider: str = METRON_PROVIDER) -> None:
    ts = round(time()); resume_at = rate.pause_until; auth_blocked = 1 if status == 'authentication_failed' else 0
    try:
        get_db().execute("""INSERT INTO provider_rate_limit_state(
        provider, burst_limit, burst_remaining, burst_reset, sustained_limit, sustained_remaining,
        sustained_reset, retry_after, resume_at, last_status, auth_blocked, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
        burst_limit=COALESCE(excluded.burst_limit, burst_limit),
        burst_remaining=COALESCE(excluded.burst_remaining, burst_remaining),
        burst_reset=COALESCE(excluded.burst_reset, burst_reset),
        sustained_limit=COALESCE(excluded.sustained_limit, sustained_limit),
        sustained_remaining=COALESCE(excluded.sustained_remaining, sustained_remaining),
        sustained_reset=COALESCE(excluded.sustained_reset, sustained_reset),
        retry_after=excluded.retry_after, resume_at=excluded.resume_at,
        last_status=excluded.last_status, auth_blocked=excluded.auth_blocked, updated_at=excluded.updated_at;""",
        (provider, rate.burst_limit, rate.burst_remaining, rate.burst_reset, rate.sustained_limit,
         rate.sustained_remaining, rate.sustained_reset, rate.retry_after, resume_at, status, auth_blocked, ts))
        commit()
    except Exception:
        return

def clear_auth_block(provider: str = METRON_PROVIDER) -> None:
    get_db().execute("""INSERT INTO provider_rate_limit_state(provider, auth_blocked, updated_at)
    VALUES(?, 0, ?) ON CONFLICT(provider) DO UPDATE SET auth_blocked = 0, last_status = 'credentials_changed', updated_at = excluded.updated_at;""", (provider, round(time())))
    commit()

def check_rate_limit_available(provider: str = METRON_PROVIDER) -> None:
    row = _rate_state_row(provider)
    if not row: return
    now = round(time())
    if row.get('auth_blocked'):
        raise MetronAuthenticationError('Metron credentials are blocked until the token changes')
    resume_at = row.get('resume_at')
    if resume_at and int(resume_at) > now:
        raise MetronPausedError(f'Metron is paused until {resume_at}')
    if row.get('burst_remaining') == 0 and row.get('burst_reset') and int(row['burst_reset']) > now:
        raise MetronPausedError(f'Metron burst quota resets at {row["burst_reset"]}')
    if row.get('sustained_remaining') == 0 and row.get('sustained_reset') and int(row['sustained_reset']) > now:
        raise MetronPausedError(f'Metron daily quota resets at {row["sustained_reset"]}')

class MetronClient:
    def __init__(self, token: str, session: Optional[Session] = None, base_url: str = METRON_BASE_URL, timeout: int = 20) -> None:
        self.token = token.strip(); self.session = session or requests.Session(); self.base_url = base_url.rstrip('/') + '/'; self.timeout = timeout
        self.user_agent = f"Kapowarr/{get_about_data().get('version', 'unknown')} MetronEnrichment"
        self._base_parts = urlsplit(self.base_url)
        self._base_port = self._effective_port(self._base_parts)
        if self._base_parts.scheme != 'https' or not self._base_parts.hostname:
            raise ValueError('Metron API base URL must be an https origin')
    @staticmethod
    def _effective_port(parts: SplitResult) -> int:
        if parts.port is not None:
            return parts.port
        return 443 if parts.scheme == 'https' else 80
    def _headers(self, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        headers = {'Accept': 'application/json', 'Authorization': f'Bearer {self.token}', 'User-Agent': self.user_agent}
        if extra: headers.update({k: v for k, v in extra.items() if v is not None})
        return headers
    def _normalise_api_path(self, endpoint_or_url: str) -> str:
        """Validate and normalize a Metron request target to a relative API path.

        Authenticated Metron requests must never leave the configured HTTPS API
        origin.  Same-origin absolute pagination or redirect targets are accepted
        only after exact scheme/host/port/userinfo/path validation, then reduced
        to the relative API path used by the configured base URL.
        """
        if not isinstance(endpoint_or_url, str) or not endpoint_or_url.strip():
            raise MetronInvalidResponseError('Metron request target was empty')
        target = endpoint_or_url.strip()
        if target.startswith('//'):
            raise MetronInvalidResponseError('Metron request target used a protocol-relative URL')
        parts = urlsplit(target)
        if parts.scheme or parts.netloc:
            if parts.scheme != 'https':
                raise MetronInvalidResponseError('Metron request target must use https')
            if parts.username is not None or parts.password is not None:
                raise MetronInvalidResponseError('Metron request target must not contain credentials')
            if not parts.hostname or parts.hostname != self._base_parts.hostname:
                raise MetronInvalidResponseError('Metron request target host is not approved')
            if self._effective_port(parts) != self._base_port:
                raise MetronInvalidResponseError('Metron request target port is not approved')
            base_path = self._base_parts.path.rstrip('/') + '/'
            if not parts.path.startswith(base_path):
                raise MetronInvalidResponseError('Metron request target path is outside the API base')
            relative_path = parts.path[len(base_path):]
            return urlunsplit(('', '', relative_path, parts.query, ''))
        return target.lstrip('/')
    def _url(self, endpoint_or_url: str) -> str:
        return urljoin(self.base_url, self._normalise_api_path(endpoint_or_url))
    def _request_once(self, method: str, endpoint_or_url: str, *, params: Optional[Mapping[str, Any]], headers: Optional[Mapping[str, str]]) -> Response:
        try:
            return self.session.request(method, self._url(endpoint_or_url), params=params, headers=self._headers(headers), timeout=self.timeout, allow_redirects=False)
        except Timeout as exc:
            raise MetronTimeoutError('Metron request timed out') from exc
        except RequestException as exc:
            raise MetronNetworkError('Metron network request failed') from exc
    def _request(self, method: str, endpoint_or_url: str, *, params: Optional[Mapping[str, Any]] = None, headers: Optional[Mapping[str, str]] = None) -> Response:
        if not self.token: raise MetronAuthenticationError('Metron token is not configured')
        check_rate_limit_available()
        redirect_count = 0
        response = self._request_once(method, endpoint_or_url, params=params, headers=headers)
        while response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get('Location')
            if not location:
                raise MetronInvalidResponseError('Metron redirect did not include a Location header')
            endpoint_or_url = self._normalise_api_path(location)
            redirect_count += 1
            if redirect_count > 5:
                raise MetronInvalidResponseError('Metron redirect chain was too long')
            if response.status_code == 303:
                method = 'GET'; params = None
            response = self._request_once(method, endpoint_or_url, params=params, headers=headers)
        rate = parse_rate_limit_headers(response.headers); status = 'ok'
        try:
            if response.status_code == 401: status = 'authentication_failed'; raise MetronAuthenticationError('Metron token was rejected', rate)
            if response.status_code == 403: status = 'permission_denied'; raise MetronPermissionError('Metron permission denied', rate)
            if response.status_code == 304: status = 'not_modified'; raise MetronNotModifiedError('Metron resource not modified', rate)
            if response.status_code == 404: status = 'not_found'; raise MetronNotFoundError('Metron resource not found', rate)
            if response.status_code == 429: status = 'rate_limited'; raise MetronRateLimitedError('Metron rate limit reached', rate)
            if response.status_code in (500, 502, 503, 504): status = 'temporary_failure'; raise MetronTemporaryError('Metron server is temporarily unavailable', rate)
            if response.status_code >= 400: status = 'invalid_response'; raise MetronInvalidResponseError(f'Metron returned HTTP {response.status_code}', rate)
            return response
        finally:
            update_rate_limit_state(rate, status)
    def _json(self, response: Response) -> Any:
        content_type = (response.headers.get('Content-Type') or '').lower()
        if content_type and 'json' not in content_type: raise MetronInvalidResponseError('Metron returned a non-JSON response')
        try: return response.json()
        except (ValueError, JSONDecodeError) as exc: raise MetronInvalidResponseError('Metron returned invalid JSON') from exc
    def test_connection(self) -> Dict[str, Any]:
        response = self._request('GET', 'series/', params={'page_size': 1}); payload = self._json(response)
        if not isinstance(payload, (dict, list)): raise MetronInvalidResponseError('Metron test response had unexpected shape')
        return {'ok': True, 'rate_limit': parse_rate_limit_headers(response.headers).todict()}
    def get_paginated(self, endpoint: str, params: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []; next_url: Optional[str] = endpoint; next_params: Optional[Mapping[str, Any]] = dict(params or {})
        while next_url:
            response = self._request('GET', next_url, params=next_params); payload = self._json(response)
            if isinstance(payload, list): page_items = payload; next_url = None
            elif isinstance(payload, dict) and isinstance(payload.get('results'), list): page_items = payload['results']; next_url = payload.get('next') or None; next_params = None
            else: raise MetronInvalidResponseError('Metron pagination results had unexpected shape')
            items.extend([item for item in page_items if isinstance(item, dict)])
        return items
    def find_series_by_comicvine_id(self, comicvine_id: int) -> List[Dict[str, Any]]:
        return self.get_paginated('series/', {'cv_id': comicvine_id})
    def get_series(self, series_id: str, last_modified: Optional[str] = None) -> Dict[str, Any]:
        headers = {'If-Modified-Since': last_modified} if last_modified else None
        response = self._request('GET', f'series/{series_id}/', headers=headers); payload = self._json(response)
        if not isinstance(payload, dict): raise MetronInvalidResponseError('Metron detail response had unexpected shape')
        payload['_metron_last_modified'] = response.headers.get('Last-Modified') or last_modified
        return payload
