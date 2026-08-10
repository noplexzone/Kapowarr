import unittest
from unittest.mock import MagicMock, patch

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

    def test_volumes_defaults_to_first_page(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod.Library, 'get_public_volumes_page', return_value=([], 0)
        ) as get_page:
            response = self._client().get('/api/volumes')

        self.assertEqual(response.status_code, 200)
        get_page.assert_called_once_with(
            api_mod.LibrarySorting.TITLE, None, 'comic', 0, 60
        )

    def test_history_defaults_to_first_page(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'get_download_history', return_value=[]
        ) as get_history, patch.object(
            api_mod, 'get_download_history_count', return_value=0
        ):
            response = self._client().get('/api/activity/history')

        self.assertEqual(response.status_code, 200)
        get_history.assert_called_once_with(None, None, 0)

    def test_blocklist_defaults_to_first_page(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'get_blocklist', return_value=[]
        ) as get_blocklist, patch.object(api_mod, 'get_blocklist_count', return_value=0):
            response = self._client().get('/api/blocklist')

        self.assertEqual(response.status_code, 200)
        get_blocklist.assert_called_once_with(0)


if __name__ == '__main__':
    unittest.main()
