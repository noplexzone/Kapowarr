import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod


class PaginationApiDefaultsTests(unittest.TestCase):
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

    def test_volumes_preserves_legacy_list_without_opt_in(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        volumes = [{'id': 1, 'title': 'Saga'}]
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod.Library, 'get_public_volumes', return_value=volumes
        ) as get_all:
            response = self._client().get('/api/volumes')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['result'], volumes)
        get_all.assert_called_once_with(
            api_mod.LibrarySorting.TITLE, None, 'comic'
        )

    def test_volumes_paginated_mode_defaults_to_first_page(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod.Library, 'get_public_volumes_page', return_value=([], 0)
        ) as get_page:
            response = self._client().get('/api/volumes?paginated=true')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['result']['items'], [])
        get_page.assert_called_once_with(
            api_mod.LibrarySorting.TITLE, None, 'comic', 0, 60
        )

    def test_history_legacy_and_paginated_shapes(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        entries = [{'source': 'test'}]
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'get_download_history', return_value=entries
        ) as get_history, patch.object(
            api_mod, 'get_download_history_count', return_value=1
        ) as get_count:
            legacy = self._client().get('/api/activity/history')
            paginated = self._client().get('/api/activity/history?paginated=true')

        self.assertEqual(legacy.get_json()['result'], entries)
        self.assertEqual(paginated.get_json()['result']['entries'], entries)
        self.assertEqual(paginated.get_json()['result']['total'], 1)
        self.assertEqual(get_history.call_count, 2)
        get_count.assert_called_once_with(None, None)

    def test_history_failed_filter_is_applied_to_list_and_count(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'get_download_history', return_value=[]
        ) as get_history, patch.object(
            api_mod, 'get_download_history_count', return_value=0
        ) as get_count:
            response = self._client().get(
                '/api/activity/history?paginated=true&state=failed'
            )

        self.assertEqual(response.status_code, 200)
        get_history.assert_called_once_with(None, None, 0, 'failed')
        get_count.assert_called_once_with(None, None, 'failed')

    def test_exact_comicvine_metadata_lookup_uses_requested_identifier(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = MagicMock()
        comicvine.search_volumes = AsyncMock(return_value=[{
            'comicvine_id': 4050,
            'metadata_source': 'comicvine',
            'metadata_id': '4050',
            'title': 'Saga',
            'cover': b'not-json-safe',
        }])
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'ComicVine', return_value=comicvine
        ):
            response = self._client().get(
                '/api/volumes/search/exact?metadata_source=comicvine'
                '&metadata_id=4050&section=comic'
            )

        self.assertEqual(response.status_code, 200)
        result = response.get_json()['result']
        self.assertEqual(result['metadata_id'], '4050')
        self.assertNotIn('cover', result)
        comicvine.search_volumes.assert_awaited_once_with('cv:4050', section='comic')

    def test_blocklist_legacy_and_paginated_shapes(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        entry = MagicMock()
        entry.todict.return_value = {'id': 3}
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'get_blocklist', return_value=[entry]
        ), patch.object(api_mod, 'get_blocklist_count', return_value=1) as get_count:
            legacy = self._client().get('/api/blocklist')
            paginated = self._client().get('/api/blocklist?paginated=true')

        self.assertEqual(legacy.get_json()['result'], [{'id': 3}])
        self.assertEqual(paginated.get_json()['result']['entries'], [{'id': 3}])
        self.assertEqual(paginated.get_json()['result']['total'], 1)
        get_count.assert_called_once_with()

    def test_resetting_hosting_setting_restarts_with_hosting_mode(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.get_public_settings.return_value.todict.return_value = {}
        server = MagicMock()
        with patch.object(api_mod, 'request', flask_request), patch.object(
            api_mod, 'Settings', return_value=settings
        ), patch.object(api_mod, 'Server', return_value=server), patch.object(
            api_mod.StartTypeHandlers, 'diffuse_timer'
        ):
            response = self._client().delete(
                '/api/settings', json={'reset_keys': ['host']}
            )

        self.assertEqual(response.status_code, 200)
        settings.backup_hosting_settings.assert_called_once_with()
        server.restart.assert_called_once_with(
            api_mod.StartType.RESTART_HOSTING_CHANGES
        )

    def test_resetting_proxy_setting_restarts_server(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.get_public_settings.return_value.todict.return_value = {}
        server = MagicMock()
        with patch.object(api_mod, 'request', flask_request), patch.object(
            api_mod, 'Settings', return_value=settings
        ), patch.object(api_mod, 'Server', return_value=server), patch.object(
            api_mod.StartTypeHandlers, 'diffuse_timer'
        ):
            response = self._client().delete(
                '/api/settings', json={'reset_keys': ['proxy_host']}
            )

        self.assertEqual(response.status_code, 200)
        server.restart.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
