import unittest

from backend.base import helpers


class LogRedactionTests(unittest.TestCase):
    def test_sensitive_url_query_values_are_redacted_for_logs(self):
        url = (
            'https://example.test/download?key=abc&apikey=def&token=ghi'
            '&password=jkl&safe=value'
        )

        redacted = helpers.redact_url_for_log(url)

        self.assertIn('key=<redacted>', redacted)
        self.assertIn('apikey=<redacted>', redacted)
        self.assertIn('token=<redacted>', redacted)
        self.assertIn('password=<redacted>', redacted)
        self.assertIn('safe=value', redacted)
        self.assertNotIn('abc', redacted)
        self.assertNotIn('def', redacted)
        self.assertNotIn('ghi', redacted)
        self.assertNotIn('jkl', redacted)


if __name__ == '__main__':
    unittest.main()
