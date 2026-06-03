"""Regression tests for the fix_year IndexError crash (GitHub: Search All vol 1119).

Root cause: fix_year() assumed year_str had >=4 elements, but zero-padded 4-digit
strings extracted by year_regex (e.g. "0001" from a title like "(0001)") become
short integers after int() conversion (int("0001")==1), triggering IndexError at
  return int(year_str[0] + year_str[2] + year_str[1] + year_str[3])
"""

import sys
import unittest
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Minimal sys.modules patching so backend modules can be imported without the
# full production dependency set (aiohttp, flask, requests, etc.).
# ---------------------------------------------------------------------------

def _patch_externals():
    urllib3_mock = MagicMock()
    urllib3_mock.__version__ = '1.26.0'
    requests_mock = MagicMock()
    requests_exceptions = MagicMock()
    requests_exceptions.RequestException = Exception
    requests_mock.exceptions = requests_exceptions
    requests_mock.RequestException = Exception
    patches = {
        'aiohttp': MagicMock(),
        'bencoding': MagicMock(),
        'multidict': MagicMock(),
        'yarl': MagicMock(),
        'requests': requests_mock,
        'requests.adapters': MagicMock(),
        'requests.structures': MagicMock(),
        'requests.exceptions': requests_exceptions,
        'urllib3': urllib3_mock,
        'backend.internals.db': MagicMock(),
    }
    for mod, stub in patches.items():
        sys.modules.setdefault(mod, stub)


_patch_externals()


class FixYearLengthSafetyTests(unittest.TestCase):
    """fix_year() must not raise IndexError for short (< 4-digit) integers."""

    def setUp(self):
        from backend.base.helpers import fix_year
        self.fix_year = fix_year

    # --- regression cases: these all crashed before the fix ---

    def test_two_digit_year_does_not_raise(self):
        """int('0012') == 12; fix_year must survive without IndexError."""
        try:
            self.fix_year(12)
        except IndexError:
            self.fail('fix_year(12) raised IndexError (regression: vol 1119 crash)')

    def test_one_digit_year_does_not_raise(self):
        """int('0001') == 1; must not crash."""
        try:
            self.fix_year(1)
        except IndexError:
            self.fail('fix_year(1) raised IndexError')

    def test_zero_does_not_raise(self):
        try:
            self.fix_year(0)
        except IndexError:
            self.fail('fix_year(0) raised IndexError')

    def test_two_digit_99_does_not_raise(self):
        try:
            self.fix_year(99)
        except IndexError:
            self.fail('fix_year(99) raised IndexError')

    # --- existing intended corrections must still work ---

    def test_known_fix_1890_becomes_1980(self):
        self.assertEqual(self.fix_year(1890), 1980)

    def test_in_range_year_is_returned_unchanged(self):
        self.assertEqual(self.fix_year(2010), 2010)
        self.assertEqual(self.fix_year(1963), 1963)
        self.assertEqual(self.fix_year(2024), 2024)

    def test_transposed_year_2204_becomes_2024(self):
        self.assertEqual(self.fix_year(2204), 2024)


_NZB_XML_ZERO_PADDED_TITLE = '''\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>The.X-Men.(0001).2024.GROUP</title>
      <enclosure url="https://example.com/api?id=abc" length="1" type="application/x-nzb"/>
    </item>
    <item>
      <title>Good Comic 001 (2024)</title>
      <enclosure url="https://example.com/api?id=xyz" length="1" type="application/x-nzb"/>
    </item>
  </channel>
</rss>'''

_NZB_XML_GOOD_ONLY = '''\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Good Comic 001 (2024)</title>
      <enclosure url="https://example.com/api?id=xyz" length="1" type="application/x-nzb"/>
    </item>
  </channel>
</rss>'''


class NZBParserMalformedYearTests(unittest.TestCase):
    """_parse_newznab_xml must not crash on titles that produce short year ints."""

    def setUp(self):
        from backend.implementations.nzb_indexers import _parse_newznab_xml
        self._parse = _parse_newznab_xml

    def _call(self, xml):
        return self._parse(xml, 'TestIndexer', 'https://example.com', '')

    def test_zero_padded_issue_in_parens_does_not_crash(self):
        """Title like 'The.X-Men.(0001).2024.GROUP' must not raise IndexError."""
        try:
            self._call(_NZB_XML_ZERO_PADDED_TITLE)
        except IndexError:
            self.fail(
                '_parse_newznab_xml raised IndexError on zero-padded title '
                '(regression: Search All vol 1119 crash)'
            )

    def test_good_items_are_returned_when_no_malformed_title(self):
        """Sanity: normal titles parse correctly."""
        results = self._call(_NZB_XML_GOOD_ONLY)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['display_title'], 'Good Comic 001 (2024)')

    def test_good_items_survive_alongside_malformed_title(self):
        """When one NZB item has a malformed year, other items must still be returned."""
        results = self._call(_NZB_XML_ZERO_PADDED_TITLE)
        # After the fix, either:
        #   (a) fix_year is length-safe → both items returned, OR
        #   (b) per-item skip → only the good item returned
        # Either way, at least the good item must be present.
        titles = [r['display_title'] for r in results]
        self.assertIn(
            'Good Comic 001 (2024)', titles,
            f'Good item missing from results: {titles!r}'
        )


if __name__ == '__main__':
    unittest.main()
