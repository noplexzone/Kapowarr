"""Regression tests for Suwayomi manga-volume bundling.

Strategy: Suwayomi ChapterType does NOT expose volumeNumber, so bundling is
driven by parsing chapter ranges from the issue description, not by querying
volumeNumber from Suwayomi.

Covered scenarios:
1. _parse_chapter_range_from_description: various description patterns.
2. manual_search injects a bundled suwayomi:M:c1,c2,... result for a
   VOLUME_AS_ISSUE issue when the description names the chapters and Suwayomi
   has individual chapter results for all of them.
3. parse_suwayomi_volume_link routing: single vs. multi-chapter link detection.
4. _try_bundle_suwayomi_chapters silently skips pre-bundled links.
"""

import unittest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# _parse_chapter_range_from_description
# ---------------------------------------------------------------------------

class ParseChapterRangeFromDescriptionTest(unittest.TestCase):
    """Verify chapter-range extraction from issue description strings."""

    def _parse(self, desc):
        from backend.features.search import _parse_chapter_range_from_description
        return _parse_chapter_range_from_description(desc)

    def test_ellipsis_range(self):
        """'Chapter 1 ... Chapter 7' yields [1.0, 2.0, ..., 7.0]."""
        result = self._parse('Ryomen Sukuna. Chapter 1 ... Chapter 7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_dash_range(self):
        """'Chapters 1-7' yields the same range."""
        result = self._parse('Chapters 1-7 collected in this volume.')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_individual_mentions(self):
        """Individual 'Chapter N' occurrences are collected and sorted."""
        desc = 'Chapter 1: Ryomen Sukuna. Chapter 2: For Myself. Chapter 3: Girl of Steel.'
        result = self._parse(desc)
        self.assertEqual(result, [1.0, 2.0, 3.0])

    def test_empty_description_returns_empty(self):
        result = self._parse('')
        self.assertEqual(result, [])

    def test_no_chapter_mentions_returns_empty(self):
        result = self._parse('An exciting volume of Jujutsu Kaisen.')
        self.assertEqual(result, [])

    def test_to_keyword_range(self):
        """'Chapter 1 to Chapter 7' also yields the range."""
        result = self._parse('Chapter 1 to Chapter 7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])


# ---------------------------------------------------------------------------
# manual_search injects bundled result for manga issue searches
# ---------------------------------------------------------------------------

def _make_volume_data(special_version_marker='volume-as-issue', publisher='VIZ Media'):
    from backend.base.definitions import SpecialVersion, VolumeData
    special_version = (
        SpecialVersion.NORMAL
        if special_version_marker == 'normal'
        else SpecialVersion.VOLUME_AS_ISSUE
    )
    return VolumeData(
        id=1, comicvine_id=12345,
        title='Jujutsu Kaisen', alt_title=None,
        year=2019, volume_number=1,
        description='', site_url='',
        publisher=publisher,
        monitored=True, monitor_new_issues=True,
        root_folder=1, folder='', custom_folder=False,
        special_version=special_version,
        special_version_locked=False, last_cv_fetch=0,
    )


def _make_issue_data(description: str = '', issue_num: float = 1.0):
    from backend.base.definitions import IssueData
    return IssueData(
        id=10, volume_id=1, comicvine_id=99999,
        issue_number='1', calculated_issue_number=issue_num,
        title='Volume 1', date='2019-03-04',
        description=description, monitored=True, files=[],
    )


def _single_chapter_results(manga_id: int = 1756, ch_range=range(1, 8)):
    """Return individual Suwayomi chapter search results for chapters in ch_range."""
    results = []
    for i in ch_range:
        results.append({
            'link': f'suwayomi:{manga_id}:{10000 + i}',
            'display_title': f'Jujutsu Kaisen - Ch. {i}',
            'source': 'Suwayomi',
            'series': 'Jujutsu Kaisen',
            'year': None,
            'volume_number': None,
            'special_version': None,
            'issue_number': float(i),
            'annual': False,
        })
    return results


def _run_manual_search(
    issue_description: str,
    raw_results=None,
    special_version_marker='volume-as-issue',
    publisher='VIZ Media',
):
    """Run manual_search(1, 10) with mocked Volume and search_multiple_queries."""
    from backend.features.search import manual_search

    if raw_results is None:
        raw_results = _single_chapter_results()

    volume_data = _make_volume_data(special_version_marker, publisher)
    issue_data = _make_issue_data(description=issue_description)

    mock_issue = MagicMock()
    mock_issue.get_data.return_value = issue_data

    mock_volume = MagicMock()
    mock_volume.get_data.return_value = volume_data
    mock_volume.get_issues.return_value = []
    mock_volume.get_issue.return_value = mock_issue

    def fake_check_match(result, *args, **kwargs):
        return {'match': True, 'match_issue': None}

    with patch('backend.features.search.Volume', return_value=mock_volume), \
         patch('backend.features.search.run', return_value=raw_results), \
         patch('backend.features.search.check_search_result_match',
               side_effect=fake_check_match):
        return manual_search(1, 10)


class ManualSearchVAIBundleTest(unittest.TestCase):
    """manual_search must inject a bundled Suwayomi link for VOLUME_AS_ISSUE + issue_id
    when the issue description names the chapter range and Suwayomi has them all."""

    def test_bundled_link_present_when_description_has_range(self):
        """Results must include at least one bundled suwayomi:M:c1,c2,... link."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertGreaterEqual(
            len(bundled), 1,
            'Expected at least one bundled Suwayomi result',
        )

    def test_bundled_link_present_for_normal_manga_volume(self):
        """Live JJK imports may be SpecialVersion.NORMAL, not VOLUME_AS_ISSUE."""
        results = _run_manual_search(
            'Chapter 1 ... Chapter 7',
            special_version_marker='normal',
        )
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)

    def test_bundled_link_present_with_irrelevant_non_suwayomi_results(self):
        """Irrelevant NZB/GetComics hits must not suppress Suwayomi bundling."""
        raw = _single_chapter_results() + [{
            'link': 'https://example.invalid/not-a-match.nzb',
            'display_title': 'Jujutsu Kaisen Vol 26',
            'source': 'NZBGeek',
            'series': 'Jujutsu Kaisen',
            'year': 2025,
            'volume_number': 26,
            'special_version': None,
            'issue_number': None,
            'annual': False,
        }]
        results = _run_manual_search('Chapter 1 ... Chapter 7', raw_results=raw)
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)

    def test_non_manga_publisher_does_not_bundle(self):
        """Chapter-list descriptions in non-manga comics should not trigger Suwayomi bundling."""
        results = _run_manual_search(
            'Chapter 1 ... Chapter 7',
            publisher='Marvel',
        )
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 0)

    def test_bundled_link_covers_all_seven_chapters(self):
        """The bundled link must embed all 7 chapter IDs for chapters 1–7."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        _, _, ids_str = bundled[0]['link'].split(':', 2)
        ids = [int(x) for x in ids_str.split(',')]
        self.assertEqual(len(ids), 7, f'Expected 7 IDs, got {ids}')

    def test_bundled_result_issue_number_matches_issue(self):
        """bundled result issue_number must equal the issue's calculated_issue_number."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertEqual(bundled[0]['issue_number'], 1.0)

    def test_bundled_result_volume_number_set(self):
        """bundled result volume_number must equal the volume's volume_number."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertEqual(bundled[0]['volume_number'], 1)

    def test_no_bundle_when_description_has_no_chapter_range(self):
        """Without chapter info in description no bundled result is added."""
        results = _run_manual_search('An exciting volume of Jujutsu Kaisen.')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 0)

    def test_no_bundle_when_chapters_are_incomplete(self):
        """Only chapters 1–5 present but description says 1–7 → no bundle."""
        raw = _single_chapter_results(ch_range=range(1, 6))
        results = _run_manual_search('Chapter 1 ... Chapter 7', raw_results=raw)
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 0)

    def test_single_chapter_results_still_present(self):
        """Individual chapter results must remain in the returned list (as non-matches)."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        single = [r for r in results if ',' not in r.get('link', '')
                  and r.get('link', '').startswith('suwayomi:')]
        self.assertEqual(len(single), 7)

    def test_covered_chapters_are_not_match(self):
        """Individual Suwayomi chapters covered by the bundle must have match=False."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        covered = [
            r for r in results
            if r.get('link', '').startswith('suwayomi:')
            and ',' not in r.get('link', '')
        ]
        self.assertEqual(len(covered), 7, 'Expected 7 individual chapter results')
        for r in covered:
            self.assertFalse(
                r.get('match'),
                f"Chapter result {r['link']} should have match=False but got match=True",
            )

    def test_bundle_itself_is_match(self):
        """The injected bundle result must still be a match (mock returns match=True)."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertTrue(bundled[0].get('match'))

    def test_covered_chapters_have_explanatory_match_issue(self):
        """Covered chapters must carry a non-None match_issue explaining why."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        covered = [
            r for r in results
            if r.get('link', '').startswith('suwayomi:')
            and ',' not in r.get('link', '')
        ]
        for r in covered:
            self.assertIsNotNone(
                r.get('match_issue'),
                f"Covered chapter {r['link']} should have a match_issue string",
            )


# ---------------------------------------------------------------------------
# parse_suwayomi_volume_link routing: single vs. multi-chapter
# ---------------------------------------------------------------------------

class DownloadQueueSuwayomiRoutingTest(unittest.TestCase):
    """Regression: multi-chapter suwayomi link must create SuwayomiVolumeDownload."""

    def test_single_id_link_not_treated_as_volume(self):
        from backend.implementations.suwayomi import parse_suwayomi_volume_link
        link = 'suwayomi:1756:10270'
        try:
            _, ch_ids = parse_suwayomi_volume_link(link)
            is_volume = len(ch_ids) > 1
        except Exception:
            is_volume = False
        self.assertFalse(is_volume)

    def test_multi_id_link_treated_as_volume(self):
        from backend.implementations.suwayomi import parse_suwayomi_volume_link
        link = 'suwayomi:1756:10270,10271,10272,10273,10274,10275,10276'
        _, ch_ids = parse_suwayomi_volume_link(link)
        self.assertGreater(len(ch_ids), 1)


# ---------------------------------------------------------------------------
# _try_bundle_suwayomi_chapters: bundled links are silently skipped
# ---------------------------------------------------------------------------

class TryBundleIgnoresBundledLinksTest(unittest.TestCase):
    """Pre-bundled suwayomi:M:c1,c2 links in all_results must be skipped by
    _try_bundle_suwayomi_chapters (it only handles single-chapter links)."""

    def test_bundled_links_do_not_crash_try_bundle(self):
        from backend.features.search import _try_bundle_suwayomi_chapters
        from backend.base.definitions import SpecialVersion, VolumeData

        vol_data = VolumeData(
            id=1, comicvine_id=1,
            title='Jujutsu Kaisen', alt_title=None,
            year=2019, volume_number=1,
            description='', site_url='',
            publisher='VIZ Media',
            monitored=True, monitor_new_issues=True,
            root_folder=1, folder='', custom_folder=False,
            special_version=SpecialVersion.TPB,
            special_version_locked=False, last_cv_fetch=0,
        )

        all_results = [
            {
                'link': 'suwayomi:1756:10270,10271,10272',
                'issue_number': 1.0,
                'series': 'Jujutsu Kaisen',
                'source': 'Suwayomi',
                'year': None,
                'volume_number': 1,
                'special_version': None,
                'annual': False,
            }
        ]
        searchable_issues = [(1, 1.0)]

        result = _try_bundle_suwayomi_chapters(all_results, searchable_issues, vol_data)
        self.assertIsNone(result)


if __name__ == '__main__':
    unittest.main()
