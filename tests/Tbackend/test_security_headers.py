import unittest

from backend.internals.server import Server


class SecurityHeadersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = Server._create_app().test_client()

    def test_csp_is_applied_to_api_spa_static_and_error_responses(self):
        for path in (
            '/api/health',
            '/ui/',
            '/static/css/general.css',
            '/definitely-not-found',
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                policy = response.headers.get('Content-Security-Policy')
                self.assertIsNotNone(policy)
                self.assertIn("default-src 'self'", policy)
                self.assertIn("script-src 'self' https://cdn.socket.io", policy)
                self.assertNotIn("script-src 'self' 'unsafe-inline'", policy)
                self.assertIn("connect-src 'self' ws: wss:", policy)
                self.assertIn("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", policy)
                self.assertIn("img-src 'self' data: blob: http: https:", policy)
                self.assertIn("font-src 'self' https://fonts.gstatic.com", policy)
                self.assertIn("worker-src 'self' blob:", policy)
                self.assertIn("manifest-src 'self'", policy)
                self.assertIn("object-src 'none'", policy)
                self.assertIn("base-uri 'self'", policy)
                self.assertIn("frame-ancestors 'none'", policy)
                self.assertIn("form-action 'self'", policy)

    def test_additional_browser_security_headers_are_applied(self):
        response = self.client.get('/api/health')

        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(response.headers['Referrer-Policy'], 'same-origin')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')


if __name__ == '__main__':
    unittest.main()
