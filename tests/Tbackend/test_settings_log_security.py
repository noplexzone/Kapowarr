import unittest

from backend.internals.settings import _settings_for_log


class SettingsLoggingSecurityTests(unittest.TestCase):
    def test_secret_values_are_redacted_from_settings_logs(self):
        logged = _settings_for_log({
            'host': '127.0.0.1',
            'api_key': 'generated-secret',
            'auth_password': 'login-secret',
            'comicvine_api_key': 'metadata-secret',
            'proxy_password': 'proxy-secret',
            'provider_api_token': 'provider-secret',
        })

        self.assertEqual(logged['host'], '127.0.0.1')
        for key in (
            'api_key', 'auth_password', 'comicvine_api_key',
            'proxy_password', 'provider_api_token',
        ):
            self.assertEqual(logged[key], '[REDACTED]')
        rendered = repr(logged)
        for secret in (
            'generated-secret', 'login-secret', 'metadata-secret',
            'proxy-secret', 'provider-secret',
        ):
            self.assertNotIn(secret, rendered)


if __name__ == '__main__':
    unittest.main()
