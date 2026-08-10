import os
import unittest
from unittest.mock import patch

from backend.internals.server import Server, WebSocket


class CorsSecurityTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'KAPOWARR_CORS_ORIGINS': 'https://trusted.example, moz-extension://trusted-id'
        })
        self.env.start()
        self.client = Server._create_app().test_client()

    def tearDown(self):
        self.env.stop()

    def test_real_browser_preflight_allows_configured_origin_and_auth_header(self):
        response = self.client.options('/api/settings', headers={
            'Origin': 'https://trusted.example',
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'content-type,x-api-key',
        })
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://trusted.example')
        self.assertIn('X-Api-Key', response.headers['Access-Control-Allow-Headers'])
        self.assertIn('PUT', response.headers['Access-Control-Allow-Methods'])
        self.assertIn('Origin', response.headers['Vary'])

    def test_preflight_rejects_unconfigured_origin(self):
        response = self.client.options('/api/settings', headers={
            'Origin': 'https://attacker.example',
            'Access-Control-Request-Method': 'DELETE',
        })
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        self.assertIn('Origin', response.headers['Vary'])

    def test_preflight_rejects_unapproved_method_or_header(self):
        for headers in (
            {
                'Origin': 'https://trusted.example',
                'Access-Control-Request-Method': 'TRACE',
            },
            {
                'Origin': 'https://trusted.example',
                'Access-Control-Request-Method': 'PUT',
                'Access-Control-Request-Headers': 'X-Api-Key, X-Unsafe',
            },
        ):
            with self.subTest(headers=headers):
                response = self.client.options('/api/settings', headers=headers)
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('Access-Control-Allow-Origin', response.headers)

    def test_passwordless_key_provisioning_is_same_origin_only(self):
        response = self.client.options('/api/auth', headers={
            'Origin': 'https://trusted.example',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Content-Type',
        })
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)

    def test_configured_origin_is_reflected_only_on_api_responses(self):
        response = self.client.get(
            '/api/health', headers={'Origin': 'https://trusted.example'}
        )
        self.assertEqual(
            response.headers['Access-Control-Allow-Origin'],
            'https://trusted.example'
        )
        self.assertIn('Origin', response.headers['Vary'])

        denied = self.client.get(
            '/api/health', headers={'Origin': 'https://attacker.example'}
        )
        self.assertNotIn('Access-Control-Allow-Origin', denied.headers)
        self.assertIn('Origin', denied.headers['Vary'])

    def test_socketio_allows_same_origin_and_configured_origins_only(self):
        with patch.object(WebSocket, 'init_app') as init_app:
            Server._create_app()
        origin_allowed = init_app.call_args.kwargs['cors_allowed_origins']
        environ = {
            'wsgi.url_scheme': 'https',
            'HTTP_HOST': 'kapowarr.example',
        }
        self.assertTrue(origin_allowed('https://kapowarr.example', environ))
        self.assertTrue(origin_allowed('https://trusted.example', environ))
        self.assertFalse(origin_allowed('https://attacker.example', environ))

    def test_socketio_defaults_to_same_origin_only(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(WebSocket, 'init_app') as init_app:
            Server._create_app()
        origin_allowed = init_app.call_args.kwargs['cors_allowed_origins']
        environ = {
            'wsgi.url_scheme': 'http',
            'HTTP_HOST': 'kapowarr.local:5656',
        }
        self.assertTrue(origin_allowed('http://kapowarr.local:5656', environ))
        self.assertFalse(origin_allowed('https://attacker.example', environ))

    def test_socketio_honors_forwarded_same_origin(self):
        with patch.object(WebSocket, 'init_app') as init_app:
            Server._create_app()
        origin_allowed = init_app.call_args.kwargs['cors_allowed_origins']
        environ = {
            'wsgi.url_scheme': 'http',
            'HTTP_HOST': 'kapowarr:5656',
            'HTTP_X_FORWARDED_PROTO': 'https',
            'HTTP_X_FORWARDED_HOST': 'comics.example',
        }
        self.assertTrue(origin_allowed('https://comics.example', environ))

    def test_wildcard_and_null_origins_are_never_enabled(self):
        with patch.dict(os.environ, {
            'KAPOWARR_CORS_ORIGINS': '*, null'
        }, clear=True), patch.object(WebSocket, 'init_app') as init_app:
            client = Server._create_app().test_client()

        response = client.options('/api/settings', headers={
            'Origin': 'https://attacker.example',
            'Access-Control-Request-Method': 'DELETE',
        })
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        origin_allowed = init_app.call_args.kwargs['cors_allowed_origins']
        self.assertFalse(origin_allowed('https://attacker.example', {
            'wsgi.url_scheme': 'http',
            'HTTP_HOST': 'kapowarr.local:5656',
        }))

    def test_cors_headers_are_not_added_to_ui_routes(self):
        response = self.client.get('/ui/', headers={'Origin': 'https://trusted.example'})
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        self.assertNotIn('Vary', response.headers)


if __name__ == '__main__':
    unittest.main()
