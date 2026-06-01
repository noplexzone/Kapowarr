"""Regression test: _get_download_groups crashes with NameError when Settings
is not imported in getcomics.py (line 399 references Settings which is absent
from the module's namespace).

Before fix: patch() raises AttributeError because 'Settings' is not an
attribute of backend.implementations.getcomics.
After fix:  patch() succeeds, function returns a list without error.
"""
import unittest
from unittest.mock import MagicMock, patch

from bs4 import BeautifulSoup

from backend.implementations import getcomics

# Minimal page that has a post-contents section so the function progresses
# past the early-return guard (line 393) and reaches line 399.
_ARTICLE_HTML = (
    '<section class="post-contents">'
    '<p>Batman Vol 1 (2020) | Language English</p>'
    '</section>'
)

_SERVICE_PREF = [
    'Mega', 'MediaFire', 'WeTransfer',
    'Pixeldrain', 'UFile', 'GetComics', 'GetComics (torrent)',
]


class GetDownloadGroupsSettingsImportTest(unittest.TestCase):
    """Regression: missing `from backend.internals.settings import Settings`
    in getcomics.py causes NameError on every call to _get_download_groups."""

    def test_service_preference_sort_does_not_raise_name_error(self):
        soup = BeautifulSoup(_ARTICLE_HTML, 'html.parser')

        mock_settings_instance = MagicMock()
        mock_settings_instance.sv.service_preference = _SERVICE_PREF
        mock_settings_cls = MagicMock(return_value=mock_settings_instance)

        with patch('backend.implementations.getcomics.Settings', mock_settings_cls), \
             patch('backend.implementations.getcomics.ExternalClients') as mock_ec, \
             patch('backend.implementations.getcomics.blocklist_contains',
                   return_value=False):
            mock_ec.get_clients.return_value = []
            result = getcomics._get_download_groups(soup)

        self.assertIsInstance(result, list)
        mock_settings_cls.assert_called_once()


if __name__ == '__main__':
    unittest.main()
