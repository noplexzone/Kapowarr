# -*- coding: utf-8 -*-
"""Metron API client for optional ComicVine-backed enrichment."""

from __future__ import annotations

from dataclasses import dataclass
from json import JSONDecodeError
from time import sleep
from typing import Any, Dict, List, Mapping, Optional
from urllib.parse import urljoin

import requests
from requests import Response, Session
from requests.exceptions import RequestException, Timeout

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
    def todict(self) -> Dict[str, Optional[int]]:
        return self.__dict__.copy()

class MetronError(Exception):
    status = 'error'
    def __init__(self, message: str = '', rate_limit: Optional[MetronRateLimit] = None) -> None:
        super().__init__(message or self.status)
        self.rate_limit = rate_limit
class MetronAuthenticationError(MetronError): status = 'authentication_failed'
class MetronPermissionError(MetronError): status = 'permission_denied'
class MetronNotFoundError(MetronError): status = 'not_found'
class MetronNotModifiedError(MetronError): status = 'not_modified'
class MetronRateLimitedError(MetronError): status = 'rate_limited'
class MetronTemporaryError(MetronError): status = 'temporary_failure'
class MetronInvalidResponseError(MetronError): status = 'invalid_response'
class MetronTimeoutError(MetronError): status = 'timeout'
class MetronNetworkError(MetronError): status = 'network_error'

def _parse_int(value: Optional[str]) -> Optional[int]:
    if value is None or value == '':
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None

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

class MetronClient:
    def __init__(self, token: str, session: Optional[Session] = None, base_url: str = METRON_BASE_URL, timeout: int = 20, sleep_fn=sleep) -> None:
        self.token = token.strip()
        self.session = session or requests.Session()
        self.base_url = base_url.rstrip('/') + '/'
        self.timeout = timeout
        self.sleep_fn = sleep_fn
        version = get_about_data().get('version', 'unknown')
        self.user_agent = f'Kapowarr/{version} MetronEnrichment'
    def _headers(self, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        headers = {'Accept': 'application/json', 'Authorization': f'Bearer {self.token}', 'User-Agent': self.user_agent}
        if extra:
            headers.update(extra)
        return headers
    def _url(self, endpoint_or_url: str) -> str:
        if endpoint_or_url.startswith(('http://', 'https://')):
            return endpoint_or_url
        return urljoin(self.base_url, endpoint_or_url.lstrip('/'))
    def _request(self, method: str, endpoint_or_url: str, *, params: Optional[Mapping[str, Any]] = None, headers: Optional[Mapping[str, str]] = None, retry_safe: bool = True) -> Response:
        if not self.token:
            raise MetronAuthenticationError('Metron token is not configured')
        attempts = 2 if retry_safe else 1
        for attempt in range(attempts):
            try:
                response = self.session.request(method, self._url(endpoint_or_url), params=params, headers=self._headers(headers), timeout=self.timeout)
            except Timeout as exc:
                raise MetronTimeoutError('Metron request timed out') from exc
            except RequestException as exc:
                raise MetronNetworkError('Metron network request failed') from exc
            rate = parse_rate_limit_headers(response.headers)
            if response.status_code in (500, 502, 503, 504):
                if attempt + 1 < attempts:
                    self.sleep_fn(rate.retry_after or 1)
                    continue
                raise MetronTemporaryError('Metron server is temporarily unavailable', rate)
            if response.status_code == 401:
                raise MetronAuthenticationError('Metron token was rejected', rate)
            if response.status_code == 403:
                raise MetronPermissionError('Metron permission denied', rate)
            if response.status_code == 304:
                raise MetronNotModifiedError('Metron resource not modified', rate)
            if response.status_code == 404:
                raise MetronNotFoundError('Metron resource not found', rate)
            if response.status_code == 429:
                raise MetronRateLimitedError('Metron rate limit reached', rate)
            if response.status_code >= 400:
                raise MetronInvalidResponseError(f'Metron returned HTTP {response.status_code}', rate)
            return response
        raise MetronTemporaryError('Metron request failed')
    def _json(self, response: Response) -> Any:
        content_type = (response.headers.get('Content-Type') or '').lower()
        if content_type and 'json' not in content_type:
            raise MetronInvalidResponseError('Metron returned a non-JSON response')
        try:
            return response.json()
        except (ValueError, JSONDecodeError) as exc:
            raise MetronInvalidResponseError('Metron returned invalid JSON') from exc
    def test_connection(self) -> Dict[str, Any]:
        response = self._request('GET', 'series/', params={'page_size': 1}, retry_safe=False)
        payload = self._json(response)
        if not isinstance(payload, (dict, list)):
            raise MetronInvalidResponseError('Metron test response had unexpected shape')
        return {'ok': True, 'rate_limit': parse_rate_limit_headers(response.headers).todict()}
    def get_paginated(self, endpoint: str, params: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        next_url: Optional[str] = endpoint
        next_params: Optional[Mapping[str, Any]] = dict(params or {})
        while next_url:
            response = self._request('GET', next_url, params=next_params)
            payload = self._json(response)
            if isinstance(payload, list):
                page_items = payload; next_url = None
            elif isinstance(payload, dict):
                raw_results = payload.get('results')
                if raw_results is None:
                    page_items = [payload]; next_url = None
                elif isinstance(raw_results, list):
                    page_items = raw_results; next_url = payload.get('next') or None; next_params = None
                else:
                    raise MetronInvalidResponseError('Metron pagination results had unexpected shape')
            else:
                raise MetronInvalidResponseError('Metron response had unexpected shape')
            for item in page_items:
                if isinstance(item, dict):
                    items.append(item)
        return items
    def find_series_by_comicvine_id(self, comicvine_id: int) -> List[Dict[str, Any]]:
        return self.get_paginated('series/', {'cv_id': comicvine_id})
    def get_series(self, series_id: str, last_modified: Optional[str] = None) -> Dict[str, Any]:
        headers = {'If-Modified-Since': last_modified} if last_modified else None
        response = self._request('GET', f'series/{series_id}/', headers=headers, retry_safe=True)
        payload = self._json(response)
        if isinstance(payload, dict):
            payload['_metron_last_modified'] = response.headers.get('Last-Modified') or last_modified
            payload['_metron_etag'] = response.headers.get('ETag')
        return payload
