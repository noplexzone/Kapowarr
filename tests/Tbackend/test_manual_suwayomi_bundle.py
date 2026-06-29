"""Tests for manual Suwayomi chapter bundle search feature.

Covers:
1. parse_manual_chapter_expression - range, list, decimal, error cases.
2. manual_suwayomi_bundle_search - integration via mocked Suwayomi search.
"""

import unittest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# parse_manual_chapter_expression
# ---------------------------------------------------------------------------

class ParseManualChapterExpressionTest(unittest.TestCase):

    def _parse(self, expr):
        from backend.features.search import parse_manual_chapter_expression
        return parse_manual_chapter_expression(expr)

    def test_simple_range(self):
        result = self._parse('1-7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_range_with_spaces(self):
        result = self._parse('1 - 7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_range_en_dash(self):
        result = self._parse('264–271')
        self.assertEqual(result, [264.0, 265.0, 266.0, 267.0, 268.0, 269.0, 270.0, 271.0])

    def test_comma_separated(self):
        result = self._parse('1,2,3,4,5,6,7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_comma_separated_with_spaces(self):
        result = self._parse('1, 2, 3')
        self.assertEqual(result, [1.0, 2.0, 3.0])

    def test_single_chapter(self):
        result = self._parse('5')
        self.assertEqual(result, [5.0])

    def test_decimal_chapter(self):
        result = self._parse('262.2')
        self.assertEqual(result, [262.2])

    def test_decimal_in_comma_list(self):
        result = self._parse('1, 1.5, 2')
        self.assertEqual(result, [1.0, 1.5, 2.0])

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            self._parse('')

    def test_whitespace_only_raises(self):
        with self.assertRaises(ValueError):
            self._parse('   ')

    def test_reversed_range_raises(self):
        with self.assertRaises(ValueError):
            self._parse('7-1')

    def test_non_numeric_raises(self):
        with self.assertRaises(ValueError):
            self._parse('abc')

    def test_mixed_invalid_raises(self):
        with self.assertRaises(ValueError):
            self._parse('1,abc,3')

    def test_deduplication(self):
        result = self._parse('1,2,2,3')
        self.assertEqual(result, [1.0, 2.0, 3.0])

    def test_large_range(self):
        result = self._parse('264-271')
        self.assertEqual(len(result), 8)
        self.assertEqual(result[0], 264.0)
        self.assertEqual(result[-1], 271.0)


# ---------------------------------------------------------------------------
# manual_suwayomi_bundle_search helpers
# ---------------------------------------------------------------------------

def _make_volume_data(title='Jujutsu Kaisen', alt_title=None, volume_number=1,
                      publisher='VIZ Media'):
    from backend.base.definitions import SpecialVersion, VolumeData
    return VolumeData(
        id=1, comicvine_id=12345,
        title=title, alt_title=alt_title,
        year=2019, volume_number=volume_number,
        description='', site_url='',
        publisher=publisher,
        monitored=True, monitor_new_issues=True,
        root_folder=1, folder='', custom_folder=False,
        special_version=SpecialVersion.VOLUME_AS_ISSUE,
        special_version_locked=False, last_cv_fetch=0,
    )


def _make_issue_data(volume_id=1, issue_num=1.0):
    from backend.base.definitions import IssueData
    return IssueData(
        id=10, volume_id=volume_id, comicvine_id=99999,
        issue_number=str(int(issue_num)),
        calculated_issue_number=issue_num,
        title=f'Volume {int(issue_num)}', date='2019-03-04',
        description='', monitored=True, files=[],
    )


def _suwayomi_results(manga_id=1756, ch_range=range(1, 8), source='Atsumaru'):
    results = []
    for i in ch_range:
        results.append({
            'link': f'suwayomi:{manga_id}:{10000 + i}',
            'display_title': f'Jujutsu Kaisen - Ch. {i} [{source}]',
            'source': 'Suwayomi',
            'series': 'Jujutsu Kaisen',
            'year': None,
            'volume_number': None,
            'special_version': None,
            'issue_number': float(i),
            'annual': False,
            '_sw_source': source,
        })
    return results


def _run_manual_suwayomi_bundle_search(
    chapter_expression,
    suwayomi_results=None,
    issue_num=1.0,
    volume_number=1,
):
    from backend.features.search import manual_suwayomi_bundle_search

    if suwayomi_results is None:
        suwayomi_results = _suwayomi_results()

    volume_data = _make_volume_data(volume_number=volume_number)
    issue_data = _make_issue_data(issue_num=issue_num)

    mock_issue = MagicMock()
    mock_issue.get_data.return_value = issue_data

    mock_volume = MagicMock()
    mock_volume.get_data.return_value = volume_data

    mock_library_issue = MagicMock()
    mock_library_issue.get_data.return_value = issue_data

    with patch('backend.features.search.Library') as mock_lib, \
         patch('backend.features.search.Volume', return_value=mock_volume), \
         patch('backend.features.search.SearchSuwayomi') as mock_search_cls:
        mock_lib.get_issue.return_value = mock_library_issue
        mock_search_instance = MagicMock()
        mock_search_instance._search_sync.return_value = suwayomi_results
        mock_search_cls.return_value = mock_search_instance

        return manual_suwayomi_bundle_search(10, chapter_expression)


# ---------------------------------------------------------------------------
# manual_suwayomi_bundle_search tests
# ---------------------------------------------------------------------------

class ManualSuwayomiBundleSearchTest(unittest.TestCase):

    def test_returns_bundle_for_complete_chapters(self):
        results = _run_manual_suwayomi_bundle_search('1-7')
        self.assertEqual(len(results), 1)
        link = results[0]['link']
        self.assertIn(',', link)
        self.assertTrue(link.startswith('suwayomi:'))

    def test_bundle_link_contains_all_chapter_ids(self):
        results = _run_manual_suwayomi_bundle_search('1-7')
        _, _, ids_str = results[0]['link'].split(':', 2)
        ids = [int(x) for x in ids_str.split(',')]
        self.assertEqual(len(ids), 7)

    def test_display_title_contains_manual_ch(self):
        results = _run_manual_suwayomi_bundle_search('1-7')
        self.assertIn('Manual Ch.', results[0]['display_title'])

    def test_display_title_contains_vol(self):
        results = _run_manual_suwayomi_bundle_search('1-7', issue_num=3.0)
        self.assertIn('Vol. 3', results[0]['display_title'])

    def test_match_is_true(self):
        results = _run_manual_suwayomi_bundle_search('1-7')
        self.assertTrue(results[0]['match'])

    def test_match_issue_is_none(self):
        results = _run_manual_suwayomi_bundle_search('1-7')
        self.assertIsNone(results[0]['match_issue'])

    def test_returns_empty_when_chapters_incomplete(self):
        partial = _suwayomi_results(ch_range=range(1, 5))
        results = _run_manual_suwayomi_bundle_search('1-7', suwayomi_results=partial)
        self.assertEqual(results, [])

    def test_comma_separated_expression(self):
        results = _run_manual_suwayomi_bundle_search('1,2,3,4,5,6,7')
        self.assertEqual(len(results), 1)
        self.assertIn('Manual Ch.', results[0]['display_title'])

    def test_invalid_expression_raises_value_error(self):
        from backend.features.search import manual_suwayomi_bundle_search
        mock_issue_data = _make_issue_data()
        mock_volume_data = _make_volume_data()
        mock_library_issue = MagicMock()
        mock_library_issue.get_data.return_value = mock_issue_data
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = mock_volume_data
        with patch('backend.features.search.Library') as mock_lib, \
             patch('backend.features.search.Volume', return_value=mock_volume):
            mock_lib.get_issue.return_value = mock_library_issue
            with self.assertRaises(ValueError):
                manual_suwayomi_bundle_search(10, '')

    def test_reversed_range_raises_value_error(self):
        from backend.features.search import manual_suwayomi_bundle_search
        mock_issue_data = _make_issue_data()
        mock_volume_data = _make_volume_data()
        mock_library_issue = MagicMock()
        mock_library_issue.get_data.return_value = mock_issue_data
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = mock_volume_data
        with patch('backend.features.search.Library') as mock_lib, \
             patch('backend.features.search.Volume', return_value=mock_volume):
            mock_lib.get_issue.return_value = mock_library_issue
            with self.assertRaises(ValueError):
                manual_suwayomi_bundle_search(10, '7-1')

    def test_source_tag_in_display_title(self):
        results = _run_manual_suwayomi_bundle_search('1-7')
        self.assertIn('[Atsumaru]', results[0]['display_title'])


if __name__ == '__main__':
    unittest.main()
