# -*- coding: utf-8 -*-
"""Tests for download source priority in auto_search.

Tests that auto_search respects the configurable comic/manga source priority
setting, choosing results from the highest-priority source that has a match.

Written before the feature exists so they currently FAIL; passing them is the
implementation signal.
"""

import unittest
from unittest.mock import MagicMock, patch

from backend.base.definitions import SpecialVersion
from backend.features import search as search_module


# ---------------------------------------------------------------------------
# Default settings values
# ---------------------------------------------------------------------------

class SourcePriorityDefaultsTest(unittest.TestCase):
    """Verify default source priority settings exist and have correct values."""

    def test_comic_default_priority(self):
        from backend.internals.settings import SettingsValues
        sv = SettingsValues()
        self.assertEqual(list(sv.comic_source_priority), ['usenet', 'getcomics'])

    def test_manga_default_priority(self):
        from backend.internals.settings import SettingsValues
        sv = SettingsValues()
        self.assertEqual(list(sv.manga_source_priority), ['suwayomi', 'usenet', 'getcomics'])

    def test_source_priority_rejects_duplicates(self):
        from backend.base.custom_exceptions import InvalidKeyValue
        from backend.internals.settings import Settings

        settings = object.__new__(Settings)
        format_value = getattr(settings, '_Settings__format_value')
        with self.assertRaises(InvalidKeyValue):
            format_value('comic_source_priority', ['usenet', 'usenet'], True)
        with self.assertRaises(InvalidKeyValue):
            format_value(
                'manga_source_priority',
                ['suwayomi', 'usenet', 'getcomics', 'getcomics'],
                True,
            )


# ---------------------------------------------------------------------------
# Helpers shared by priority tests
# ---------------------------------------------------------------------------

def _fake_result(source_id, match=True):
    """Create a minimal fake MatchedSearchResultData for the given source."""
    if source_id == 'suwayomi':
        link = 'suwayomi:1756:10001,10002,10003,10004,10005,10006,10007'
        src = 'Suwayomi'
        sv = None
        issue_num = (1.0, 7.0)
    elif source_id == 'getcomics':
        link = 'https://getcomics.org/comics/test/'
        src = 'GetComics'
        sv = SpecialVersion.TPB
        issue_num = (1.0, 7.0)
    else:  # usenet
        link = 'https://nzbgeek.info/geek.php?guid=abc123'
        src = 'NZBGeek'
        sv = SpecialVersion.TPB
        issue_num = (1.0, 7.0)
    return {
        'link': link,
        'display_title': f'Test from {src}',
        'source': src,
        'series': 'Test Series',
        'year': 2020,
        'volume_number': 1,
        'special_version': sv,
        'issue_number': issue_num,
        'annual': False,
        'match': match,
        'match_issue': None,
    }


def _make_volume_mock(publisher, special_version=SpecialVersion.TPB):
    vd = MagicMock()
    vd.monitored = True
    vd.special_version = special_version
    vd.publisher = publisher
    vd.year = 2020
    vd.volume_number = 1
    vd.title = 'Test Series'
    vd.alt_title = None

    vol = MagicMock()
    vol.get_data.return_value = vd
    vol.get_issues.return_value = []
    vol.get_open_issues.return_value = [(1, 1.0)]
    return vol


def _run_auto_search(
    all_results,
    publisher,
    comic_priority,
    manga_priority,
    special_version=SpecialVersion.TPB,
):
    """Run auto_search(1) mocking Volume, manual_search, and Settings priority."""
    vol = _make_volume_mock(publisher, special_version)

    mock_sv = MagicMock()
    mock_sv.manga_source_priority = manga_priority
    mock_sv.comic_source_priority = comic_priority

    orig_manual = search_module.manual_search
    orig_volume = search_module.Volume
    try:
        search_module.manual_search = lambda vid, iid=None, **kwargs: list(all_results)
        search_module.Volume = lambda vid: vol
        with patch('backend.internals.settings.Settings') as MockSettings:
            MockSettings.return_value.sv = mock_sv
            return search_module.auto_search(1)
    finally:
        search_module.manual_search = orig_manual
        search_module.Volume = orig_volume


# ---------------------------------------------------------------------------
# Priority-based auto_search selection
# ---------------------------------------------------------------------------

class AutoSearchSourcePriorityTest(unittest.TestCase):
    """auto_search must pick the highest-priority matched source."""

    def test_manga_suwayomi_first_picks_suwayomi(self):
        """Manga + suwayomi first → suwayomi result chosen over usenet."""
        results = [_fake_result('usenet'), _fake_result('suwayomi')]
        chosen = _run_auto_search(
            results,
            publisher='VIZ Media',
            comic_priority=['usenet', 'getcomics'],
            manga_priority=['suwayomi', 'usenet', 'getcomics'],
        )
        self.assertEqual(len(chosen), 1)
        self.assertTrue(
            chosen[0]['link'].startswith('suwayomi:'),
            f'Expected suwayomi result, got source={chosen[0]["source"]}',
        )

    def test_manga_usenet_first_picks_usenet(self):
        """Manga + usenet first → usenet result chosen over suwayomi."""
        results = [_fake_result('usenet'), _fake_result('suwayomi')]
        chosen = _run_auto_search(
            results,
            publisher='VIZ Media',
            comic_priority=['usenet', 'getcomics'],
            manga_priority=['usenet', 'suwayomi', 'getcomics'],
        )
        self.assertEqual(len(chosen), 1)
        self.assertFalse(
            chosen[0]['link'].startswith('suwayomi:'),
            f'Expected non-suwayomi result, got source={chosen[0]["source"]}',
        )
        self.assertEqual(chosen[0]['source'], 'NZBGeek')

    def test_comic_suwayomi_absent_from_priority_picks_next_best(self):
        """Comic volume with [usenet, getcomics] priority: suwayomi result
        gets lowest rank because it is not in the priority list."""
        # suwayomi appears in all_results (hypothetically) but should not win
        results = [_fake_result('suwayomi'), _fake_result('getcomics')]
        chosen = _run_auto_search(
            results,
            publisher='Marvel',
            comic_priority=['usenet', 'getcomics'],
            manga_priority=['suwayomi', 'usenet', 'getcomics'],
        )
        self.assertEqual(len(chosen), 1)
        self.assertFalse(
            chosen[0]['link'].startswith('suwayomi:'),
            'Comics: suwayomi must not win when not in priority list',
        )
        self.assertEqual(chosen[0]['source'], 'GetComics')

    def test_getcomics_over_usenet_when_first(self):
        """GetComics first → getcomics result chosen over usenet."""
        results = [_fake_result('usenet'), _fake_result('getcomics')]
        chosen = _run_auto_search(
            results,
            publisher='Marvel',
            comic_priority=['getcomics', 'usenet'],
            manga_priority=['suwayomi', 'getcomics', 'usenet'],
        )
        self.assertEqual(len(chosen), 1)
        self.assertEqual(chosen[0]['source'], 'GetComics')

    def test_falls_back_when_highest_priority_source_absent(self):
        """If highest-priority source has no result, next priority source is used."""
        results = [_fake_result('getcomics')]  # No usenet result
        chosen = _run_auto_search(
            results,
            publisher='Marvel',
            comic_priority=['usenet', 'getcomics'],
            manga_priority=['suwayomi', 'usenet', 'getcomics'],
        )
        self.assertEqual(len(chosen), 1)
        self.assertEqual(chosen[0]['source'], 'GetComics')

    def test_no_match_returns_empty(self):
        """No matched results → empty list returned."""
        results = [_fake_result('usenet', match=False)]
        chosen = _run_auto_search(
            results,
            publisher='Marvel',
            comic_priority=['usenet', 'getcomics'],
            manga_priority=['suwayomi', 'usenet', 'getcomics'],
        )
        self.assertEqual(chosen, [])

    def test_manga_suwayomi_vs_getcomics_priority(self):
        """Manga + [getcomics, suwayomi] order → getcomics beats suwayomi."""
        results = [_fake_result('suwayomi'), _fake_result('getcomics')]
        chosen = _run_auto_search(
            results,
            publisher='VIZ Media',
            comic_priority=['usenet', 'getcomics'],
            manga_priority=['getcomics', 'suwayomi', 'usenet'],
        )
        self.assertEqual(len(chosen), 1)
        self.assertEqual(chosen[0]['source'], 'GetComics')


if __name__ == '__main__':
    unittest.main()
