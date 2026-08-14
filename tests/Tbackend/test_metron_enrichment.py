import unittest
from unittest.mock import patch

from backend.implementations.metron import (
    MetronAuthenticationError, MetronClient, MetronInvalidResponseError,
    MetronNotModifiedError, MetronRateLimitedError, parse_rate_limit_headers, safe_headers,
)
from backend.features.metron_enrichment import extract_terms
from backend.internals.settings import Constants, PublicSettingsValues, _settings_for_log


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"results": []}
        self.headers = headers or {'Content-Type': 'application/json'}
    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)


class MetronClientSecurityTests(unittest.TestCase):
    @patch('backend.implementations.metron.get_about_data', return_value={'version': '9.9.9'})
    def test_bearer_header_pagination_and_redaction(self, _about):
        session = FakeSession([
            FakeResponse(payload={'results': [{'id': 1}], 'next': 'https://metron.cloud/api/series/?page=2'}),
            FakeResponse(payload={'results': [{'id': 2}], 'next': None}),
        ])
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
        self.assertEqual(client.get_paginated('series/', {'cv_id': 123}), [{'id': 1}, {'id': 2}])
        first_headers = session.calls[0][2]['headers']
        self.assertEqual(first_headers['Authorization'], 'Bearer TEST_METRON_TOKEN_REDACTED')
        self.assertNotIn('TEST_METRON_TOKEN_REDACTED', session.calls[0][1])
        self.assertEqual(safe_headers(first_headers)['Authorization'], '[REDACTED]')

    def test_error_classes_and_rate_limit_headers(self):
        rate = parse_rate_limit_headers({'X-RateLimit-Burst-Remaining': '0', 'Retry-After': '42'})
        self.assertEqual(rate.burst_remaining, 0)
        self.assertEqual(rate.retry_after, 42)
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([FakeResponse(429, headers={'Retry-After': '5', 'Content-Type': 'application/json'})]))
        with self.assertRaises(MetronRateLimitedError):
            client.test_connection()
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([FakeResponse(401)]))
        with self.assertRaises(MetronAuthenticationError):
            client.test_connection()
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([FakeResponse(200, payload='<html>', headers={'Content-Type': 'text/html'})]))
        with self.assertRaises(MetronInvalidResponseError):
            client.test_connection()

    def test_not_modified_and_last_modified_are_supported(self):
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([
            FakeResponse(304, headers={'Content-Type': 'application/json'}),
        ]))
        with self.assertRaises(MetronNotModifiedError):
            client.get_series('9001', 'Wed, 21 Oct 2015 07:28:00 GMT')
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([
            FakeResponse(payload={'id': 9001}, headers={'Content-Type': 'application/json', 'Last-Modified': 'Thu, 22 Oct 2015 07:28:00 GMT', 'ETag': 'W/"series-9001"'}),
        ]))
        payload = client.get_series('9001')
        self.assertEqual(payload['_metron_last_modified'], 'Thu, 22 Oct 2015 07:28:00 GMT')
        self.assertNotIn('_metron_etag', payload)

    def test_extract_terms_indexes_additive_metron_payload_without_duplicates(self):
        payload = {
            'characters': [{'id': 1, 'name': 'Ada'}, {'id': 1, 'name': 'Ada'}],
            'genres': ['Noir'],
            'credits': [{'id': 2, 'name': 'Writer One'}],
            'imprint': {'id': 3, 'name': 'Imprint House'},
            'aliases': ['Alt Title'],
            'identifiers': [{'source': 'isbn', 'value': '123'}],
            'images': [{'url': 'https://example.invalid/cover.jpg', 'type': 'cover'}],
        }
        terms = extract_terms(payload)
        self.assertIn({'term_type': 'character', 'external_id': '1', 'name': 'Ada'}, terms)
        self.assertIn({'term_type': 'genre', 'external_id': 'noir', 'name': 'Noir'}, terms)
        self.assertIn({'term_type': 'creator', 'external_id': '2', 'name': 'Writer One'}, terms)
        self.assertIn({'term_type': 'imprint', 'external_id': '3', 'name': 'Imprint House'}, terms)
        self.assertIn({'term_type': 'alternate_title', 'external_id': 'alt title', 'name': 'Alt Title'}, terms)
        self.assertIn({'term_type': 'identifier', 'external_id': '123', 'name': 'isbn'}, terms)
        self.assertEqual([t for t in terms if t['term_type'] == 'character'], [{'term_type': 'character', 'external_id': '1', 'name': 'Ada'}])

    def test_metron_token_masked_in_public_settings_and_logs(self):
        public = PublicSettingsValues(metron_api_token='TEST_METRON_TOKEN_REDACTED').todict()
        self.assertEqual(public['metron_api_token'], Constants.CREDENTIAL_REPLACEMENT)
        logged = _settings_for_log({'metron_api_token': 'TEST_METRON_TOKEN_REDACTED', 'host': '127.0.0.1'})
        self.assertEqual(logged['metron_api_token'], '[REDACTED]')
        self.assertNotIn('TEST_METRON_TOKEN_REDACTED', repr(logged))


if __name__ == '__main__':
    unittest.main()
