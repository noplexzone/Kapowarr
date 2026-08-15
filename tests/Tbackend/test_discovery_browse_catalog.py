import unittest
from unittest.mock import patch

from backend.implementations import mangadex

class FakeResponse:
    def __init__(self, data):
        self._data = data
    def raise_for_status(self):
        return None
    def json(self):
        return self._data

class FakeSession:
    def __init__(self, payload, routes=None):
        self.payload = payload
        self.routes = routes or {}
        self.calls = []
        self.headers = {}
    def get(self, url, params=None, timeout=None):
        params = list(params or [])
        self.calls.append((url, params, timeout))
        for suffix, payload in self.routes.items():
            if url.endswith(suffix):
                return FakeResponse(payload)
        return FakeResponse(self.payload)

class DiscoveryBrowseCatalogTests(unittest.TestCase):
    def _payload(self, count):
        return {
            'total': count,
            'data': [
                {'id': f'manga-{idx}', 'attributes': {'title': {'en': f'Manga {idx}'}, 'year': 2020 + idx, 'status': 'ongoing', 'originalLanguage': 'ja', 'publicationDemographic': 'seinen', 'contentRating': 'safe'}, 'relationships': []}
                for idx in range(count)
            ]
        }

    def test_mangadex_catalog_fetches_limit_plus_one_for_has_more(self):
        session = FakeSession(self._payload(4))
        with patch.object(mangadex.MangaDexClient, '__init__', lambda self: (setattr(self, '_base_url', mangadex.MANGADEX_API_URL), setattr(self, '_ssn', session), None)[-1]):
            page = mangadex.browse_mangadex_catalog(offset=0, limit=3, status='ongoing', demographic='seinen', original_language='ja')
        self.assertTrue(page['has_more'])
        self.assertEqual(len(page['items']), 3)
        params = session.calls[0][1]
        self.assertIn(('limit', '4'), params)
        self.assertIn(('status[]', 'ongoing'), params)
        self.assertIn(('publicationDemographic[]', 'seinen'), params)
        self.assertIn(('originalLanguage[]', 'ja'), params)

    def test_mangadex_catalog_partial_page_has_no_more(self):
        session = FakeSession(self._payload(2))
        with patch.object(mangadex.MangaDexClient, '__init__', lambda self: (setattr(self, '_base_url', mangadex.MANGADEX_API_URL), setattr(self, '_ssn', session), None)[-1]):
            page = mangadex.browse_mangadex_catalog(offset=0, limit=3)
        self.assertFalse(page['has_more'])
        self.assertEqual([item['metadata_source'] for item in page['items']], ['mangadex', 'mangadex'])
        self.assertTrue(all(item['issue_count'] is None for item in page['items']))


    def test_mangadex_catalog_does_not_force_english_translation_filter(self):
        session = FakeSession(self._payload(1))
        with patch.object(mangadex.MangaDexClient, '__init__', lambda self: (setattr(self, '_base_url', mangadex.MANGADEX_API_URL), setattr(self, '_ssn', session), None)[-1]):
            mangadex.browse_mangadex_catalog(offset=0, limit=3)
        params = session.calls[0][1]
        self.assertNotIn(('availableTranslatedLanguage[]', 'en'), params)

    def test_mangadex_catalog_resolves_tag_and_author_names_to_uuids(self):
        routes = {
            '/manga/tag': {'data': [{'id': '11111111-1111-1111-1111-111111111111', 'attributes': {'name': {'en': 'Action'}}}]},
            '/author': {'data': [{'id': '22222222-2222-2222-2222-222222222222', 'attributes': {'name': 'CLAMP'}}]},
        }
        session = FakeSession(self._payload(1), routes)
        with patch.object(mangadex.MangaDexClient, '__init__', lambda self: (setattr(self, '_base_url', mangadex.MANGADEX_API_URL), setattr(self, '_ssn', session), None)[-1]):
            mangadex.browse_mangadex_catalog(offset=0, limit=3, tags='Action', author='CLAMP')
        params = session.calls[-1][1]
        self.assertIn(('includedTags[]', '11111111-1111-1111-1111-111111111111'), params)
        self.assertIn(('authors[]', '22222222-2222-2222-2222-222222222222'), params)

    def test_mangadex_decade_fetches_the_full_ten_year_range(self):
        session = FakeSession(self._payload(1))
        with patch.object(mangadex.MangaDexClient, '__init__', lambda self: (setattr(self, '_base_url', mangadex.MANGADEX_API_URL), setattr(self, '_ssn', session), None)[-1]):
            mangadex.browse_mangadex_catalog(offset=0, limit=30, decade='1990')
        years = [dict(call[1]).get('year') for call in session.calls]
        self.assertEqual(years, [str(year) for year in range(1990, 2000)])

    def test_mangadex_catalog_rejects_unsupported_status(self):
        with self.assertRaises(ValueError):
            mangadex.browse_mangadex_catalog(status='publisher-like-filter')

if __name__ == '__main__':
    unittest.main()
