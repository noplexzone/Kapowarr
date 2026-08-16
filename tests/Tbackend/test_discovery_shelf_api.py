import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod


class DiscoveryShelfApiTests(unittest.TestCase):
    def _client(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        return app.test_client()

    def _auth_patches(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        return (
            patch.object(api_mod, 'request', flask_request),
            patch.object(api_mod, 'Settings', return_value=settings),
            patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'),
        )

    def _item(self, source='comicvine', metadata_id='1'):
        return {
            'metadata_source': source,
            'metadata_id': metadata_id,
            'comicvine_id': int(metadata_id) if str(metadata_id).isdigit() else metadata_id,
            'title': f'Title {metadata_id}',
        }

    def _comicvine(self):
        comicvine = MagicMock()
        comicvine.browse_catalog_volumes = AsyncMock(return_value={
            'items': [self._item('comicvine', '100')],
            'total': 1,
            'offset': 0,
            'page_size': 10,
            'has_more': False,
        })
        comicvine.get_upcoming_releases = AsyncMock(return_value=[self._item('comicvine', '200')])
        comicvine.get_new_volumes = AsyncMock(return_value=[self._item('comicvine', '300')])
        return comicvine

    def _assert_envelope(self, response):
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertIn('error', body)
        self.assertIsNone(body['error'])
        self.assertIn('result', body)
        return body['result']

    def test_supported_shelf_combinations_return_envelopes(self):
        cases = [
            ('comic', 'recently-started', False),
            ('comic', 'recently-started', True),
            ('comic', 'upcoming-launches', False),
            ('comic', 'upcoming-launches', True),
            ('comic', 'recently-active', False),
            ('comic', 'recently-active', True),
            ('manga', 'recently-started', False),
            ('manga', 'recently-started', True),
            ('manga', 'recently-updated', False),
            ('manga', 'recently-updated', True),
        ]
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        manga_page = {
            'items': [self._item('mangadex', 'manga-1')],
            'total': 1,
            'offset': 0,
            'page_size': 10,
            'has_more': False,
        }
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'ComicVine', return_value=comicvine
        ), patch.object(api_mod, 'browse_mangadex_catalog', return_value=manga_page), patch.object(
            api_mod, '_exclude_added_provider_results', side_effect=lambda items: items
        ):
            for section, shelf_type, exclude_added in cases:
                with self.subTest(section=section, shelf_type=shelf_type, exclude_added=exclude_added):
                    response = self._client().get('/api/discovery', query_string={
                        'section': section,
                        'type': shelf_type,
                        'paginated': 'true',
                        'limit': '10',
                        'exclude_added': 'true' if exclude_added else 'false',
                    })
                    result = self._assert_envelope(response)
                    self.assertIn('items', result)


    def test_recently_started_uses_derived_new_volumes_service(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.get_new_volumes = AsyncMock(return_value=[self._item('comicvine', '300')])
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
                'paginated': 'true',
                'offset': '0',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'][0]['metadata_id'], '300')
        comicvine.get_new_volumes.assert_awaited_once_with(limit=11)
        comicvine.browse_catalog_volumes.assert_not_awaited()

    def test_upcoming_uses_upcoming_launch_service(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'upcoming-launches',
                'paginated': 'true',
                'offset': '0',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'][0]['metadata_id'], '200')
        comicvine.get_upcoming_releases.assert_awaited_once_with(limit=11)
        comicvine.browse_catalog_volumes.assert_not_awaited()

    def test_missing_shelf_type_is_validation_error(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'comic'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'KeyNotFound')

    def test_rejects_unsupported_shelf_type(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'comic', 'type': 'story-arcs'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_rejects_comic_only_shelf_for_manga(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'manga', 'type': 'upcoming-launches'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_rejects_manga_only_shelf_for_comics(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'comic', 'type': 'recently-updated'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_rejects_invalid_section(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'movie', 'type': 'recently-started'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_empty_provider_result_returns_valid_envelope(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(return_value={
            'items': [],
            'total': 0,
            'offset': 0,
            'page_size': 10,
            'has_more': False,
        })
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-active',
                'paginated': 'true',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'], [])

    def test_provider_error_propagates_as_server_failure_without_name_error(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(side_effect=RuntimeError('provider down'))
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
                'paginated': 'true',
                'exclude_added': 'true',
            })
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('exclude_added', response.get_data(as_text=True))

    def test_url_base_prefixed_route_returns_valid_envelope(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/kapowarr/ui/api')
        settings = MagicMock()
        settings.sv.auth_password = None
        comicvine = self._comicvine()
        with patch.object(api_mod, 'request', flask_request), patch.object(api_mod, 'Settings', return_value=settings), patch.object(
            api_mod.StartTypeHandlers, 'diffuse_timer'
        ), patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = app.test_client().get('/kapowarr/ui/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-active',
                'paginated': 'true',
            })
        self._assert_envelope(response)


if __name__ == '__main__':
    unittest.main()
