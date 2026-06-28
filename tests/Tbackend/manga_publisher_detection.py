"""Tests for manga publisher/source detection used by Suwayomi search."""

import sys
import types
import unittest


def _install_requests_stub():
    if 'requests' in sys.modules:
        return
    requests_stub = types.ModuleType('requests')
    requests_stub.Session = object
    exceptions_stub = types.ModuleType('requests.exceptions')
    exceptions_stub.RequestException = Exception
    requests_stub.exceptions = exceptions_stub
    sys.modules['requests'] = requests_stub
    sys.modules['requests.exceptions'] = exceptions_stub


def _install_comicvine_stub():
    if 'backend.implementations.comicvine' in sys.modules:
        return
    comicvine_stub = types.ModuleType('backend.implementations.comicvine')
    comicvine_stub._ENGLISH_MANGA_PUBLISHERS = {'viz'}
    comicvine_stub._MANGA_PUBLISHERS = {'shueisha'}
    sys.modules['backend.implementations.comicvine'] = comicvine_stub


_install_requests_stub()
_install_comicvine_stub()

from backend.implementations.suwayomi import is_manga_publisher


class MangaPublisherDetectionTests(unittest.TestCase):
    def test_mangadex_metadata_source_counts_as_manga(self):
        """MangaDex-backed volumes should be eligible for Suwayomi searches."""
        self.assertTrue(is_manga_publisher('MangaDex'))

    def test_non_manga_publisher_does_not_count_as_manga(self):
        self.assertFalse(is_manga_publisher('Marvel'))


if __name__ == '__main__':
    unittest.main()
