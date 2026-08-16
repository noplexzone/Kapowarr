import unittest
from unittest.mock import MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod


class SavedFiltersApiTests(unittest.TestCase):
    def _client(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        return app.test_client()

    def _auth_patches(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.sv.api_key = 'test-api-key'
        return (
            patch.object(api_mod, 'request', flask_request),
            patch.object(api_mod, 'Settings', return_value=settings),
            patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'),
        )

    def test_saved_filters_endpoints_are_removed(self):
        with self._auth_context():
            client = self._client()
            self.assertEqual(client.get('/api/savedfilters?section=comic').status_code, 404)
            self.assertEqual(client.post('/api/savedfilters', json={
                'section': 'comic',
                'name': 'Missing comics',
                'query': {'filter': 'wanted'},
            }, headers={'X-Api-Key': 'test-api-key'}).status_code, 404)
            self.assertEqual(client.put('/api/savedfilters/1', json={
                'name': 'Unread comics',
            }, headers={'X-Api-Key': 'test-api-key'}).status_code, 404)
            self.assertEqual(client.delete('/api/savedfilters/1', headers={'X-Api-Key': 'test-api-key'}).status_code, 404)

    def _auth_context(self):
        patches = self._auth_patches()
        class Context:
            def __enter__(_self):
                for p in patches:
                    p.__enter__()
            def __exit__(_self, exc_type, exc, tb):
                for p in reversed(patches):
                    p.__exit__(exc_type, exc, tb)
        return Context()


if __name__ == '__main__':
    unittest.main()
