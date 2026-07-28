"""Tests for MangaDex aggregate volume/chapter mapping.

MangaDex's normal feed hides unavailable chapters.  Kapowarr must use the
aggregate endpoint with includeUnavailable=1 and reject mappings that describe a
different edition structure than Kapowarr's manga volume-as-issue entries.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


def _closed_run_result(result):
    def fake_run(coroutine):
        coroutine.close()
        return result
    return fake_run


def _issues(*numbers):
    return [
        SimpleNamespace(
            calculated_issue_number=float(n),
            issue_number=str(n),
            date='2020-01-01',
        )
        for n in numbers
    ]


class MangaDexAggregateParseTest(unittest.TestCase):
    def test_parse_aggregate_volume_map_includes_unavailable_placeholders(self):
        from backend.implementations.mangadex import parse_aggregate_volume_map

        payload = {
            'volumes': {
                '1': {
                    'volume': '1',
                    'chapters': {
                        str(i): {
                            'chapter': str(i),
                            'isUnavailable': i > 2,
                        }
                        for i in range(1, 8)
                    },
                }
            }
        }

        self.assertEqual(
            parse_aggregate_volume_map(payload),
            {1.0: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]},
        )

    def test_parse_aggregate_skips_non_numeric_volume_and_chapter_values(self):
        from backend.implementations.mangadex import parse_aggregate_volume_map

        payload = {
            'volumes': {
                'none': {'volume': 'none', 'chapters': {'1': {'chapter': '1'}}},
                '1': {
                    'volume': '1',
                    'chapters': {
                        'none': {'chapter': 'none'},
                        '1': {'chapter': '1'},
                        '1.5': {'chapter': '1.5'},
                    },
                },
            }
        }

        self.assertEqual(parse_aggregate_volume_map(payload), {1.0: [1.0, 1.5]})


class MangaDexCompatibilityTest(unittest.TestCase):
    def test_jjk_style_mapping_is_compatible(self):
        from backend.features.search import _mangadex_map_is_compatible

        md_map = {
            1.0: [float(i) for i in range(1, 8)],
            2.0: [float(i) for i in range(8, 17)],
            3.0: [float(i) for i in range(17, 26)],
            4.0: [float(i) for i in range(26, 35)],
            5.0: [float(i) for i in range(35, 44)],
        }

        self.assertTrue(_mangadex_map_is_compatible(md_map, _issues(1, 2, 3, 4, 5)))

    def test_solo_leveling_webtoon_mapping_is_incompatible(self):
        from backend.features.search import _mangadex_map_is_compatible

        md_map = {
            1.0: [float(i) for i in range(0, 111)],
            2.0: [float(i) for i in range(111, 180)],
            3.0: [float(i) for i in range(180, 201)],
        }

        self.assertFalse(
            _mangadex_map_is_compatible(md_map, _issues(*range(1, 16)))
        )

    def test_missing_current_volume_allows_description_fallback(self):
        """Compatible map missing the issue returns (None, False) so
        description parsing can run as a fallback."""
        from backend.base.definitions import SpecialVersion, VolumeData
        from backend.features.search import _mangadex_chapters_for_issue

        volume_data = VolumeData(
            id=1, comicvine_id=1,
            title='Example Manga', alt_title=None,
            year=2020, volume_number=1,
            description='', site_url='', publisher='VIZ Media',
            monitored=True, monitor_new_issues=True,
            root_folder=1, folder='', custom_folder=False,
            special_version=SpecialVersion.VOLUME_AS_ISSUE,
            special_version_locked=False, last_cv_fetch=0,
        )

        with patch(
            'backend.features.search.get_mangadex_volume_chapter_map',
            return_value={1.0: [1.0, 2.0], 2.0: [3.0, 4.0], 3.0: [5.0, 6.0],
                          4.0: [7.0, 8.0], 5.0: [9.0, 10.0]},
        ):
            chapters, incompatible = _mangadex_chapters_for_issue(
                volume_data, _issues(1, 2, 3, 4, 5), 6.0,
            )

        self.assertIsNone(chapters)
        self.assertFalse(incompatible)


class ManualSearchMangaDexGuardTest(unittest.TestCase):
    def _volume_data(self, title='Solo Leveling'):
        from backend.base.definitions import SpecialVersion, VolumeData
        return VolumeData(
            id=1, comicvine_id=1,
            title=title, alt_title=None,
            year=2021, volume_number=1,
            description='', site_url='', publisher='Yen Press',
            monitored=True, monitor_new_issues=True,
            root_folder=1, folder='', custom_folder=False,
            special_version=SpecialVersion.VOLUME_AS_ISSUE,
            special_version_locked=False, last_cv_fetch=0,
        )

    def _issue_data(self, issue_num=1.0, description='Chapter 1 ... Chapter 3'):
        from backend.base.definitions import IssueData
        return IssueData(
            id=10, volume_id=1, comicvine_id=10,
            issue_number=str(int(issue_num)), calculated_issue_number=issue_num,
            title=f'Volume {int(issue_num)}', date='2021-01-01',
            description=description, monitored=True, files=[],
        )

    def _suwayomi_chapters(self, start, end):
        return [
            {
                'link': f'suwayomi:632:{1000 + i}',
                'display_title': f'Solo Leveling - Ch. {i}',
                'source': 'Suwayomi',
                'series': 'Solo Leveling',
                'year': None,
                'volume_number': None,
                'special_version': None,
                'issue_number': float(i),
                'annual': False,
            }
            for i in range(start, end + 1)
        ]

    def test_incompatible_mangadex_map_blocks_suwayomi_match(self):
        from backend.features.search import manual_search

        volume_data = self._volume_data()
        issue_data = self._issue_data()
        mock_issue = MagicMock()
        mock_issue.get_data.return_value = issue_data
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = volume_data
        mock_volume.get_issue.return_value = mock_issue
        mock_volume.get_issues.return_value = _issues(*range(1, 16))

        def fake_check_match(result, *args, **kwargs):
            return {'match': True, 'match_issue': None}

        solo_mangadex_map = {
            1.0: [float(i) for i in range(0, 111)],
            2.0: [float(i) for i in range(111, 180)],
            3.0: [float(i) for i in range(180, 201)],
        }

        with patch('backend.features.search.Volume', return_value=mock_volume), \
             patch('backend.features.search.run', side_effect=_closed_run_result(self._suwayomi_chapters(1, 3))), \
             patch('backend.features.search.get_mangadex_volume_chapter_map',
                   return_value=solo_mangadex_map), \
             patch('backend.features.search.check_search_result_match',
                   side_effect=fake_check_match):
            results = manual_search(1, 10)

        self.assertFalse(
            [r for r in results if r.get('link', '').startswith('suwayomi:')],
            'Incompatible MangaDex mapping must remove individual Suwayomi matches',
        )

    def test_mangadex_mapping_builds_verified_bundle(self):
        from backend.features.search import manual_search

        volume_data = self._volume_data(title='Jujutsu Kaisen')
        issue_data = self._issue_data(description='No chapter data here')
        mock_issue = MagicMock()
        mock_issue.get_data.return_value = issue_data
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = volume_data
        mock_volume.get_issue.return_value = mock_issue
        mock_volume.get_issues.return_value = _issues(1, 2, 3, 4, 5)

        raw_results = [
            {
                'link': f'suwayomi:1756:{1000 + i}',
                'display_title': f'Jujutsu Kaisen - Ch. {i}',
                'source': 'Suwayomi',
                'series': 'Jujutsu Kaisen',
                'year': None,
                'volume_number': None,
                'special_version': None,
                'issue_number': float(i),
                'annual': False,
            }
            for i in range(1, 8)
        ]

        def fake_check_match(result, *args, **kwargs):
            return {'match': True, 'match_issue': None}

        md_map = {
            1.0: [float(i) for i in range(1, 8)],
            2.0: [float(i) for i in range(8, 17)],
            3.0: [float(i) for i in range(17, 26)],
            4.0: [float(i) for i in range(26, 35)],
            5.0: [float(i) for i in range(35, 44)],
        }

        with patch('backend.features.search.Volume', return_value=mock_volume), \
             patch('backend.features.search.run', side_effect=_closed_run_result(raw_results)), \
             patch('backend.features.search.get_mangadex_volume_chapter_map',
                   return_value=md_map), \
             patch('backend.features.search.check_search_result_match',
                   side_effect=fake_check_match):
            results = manual_search(1, 10)

        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertIn('Ch. 1–7', bundled[0]['display_title'])

    def test_volume_level_manga_search_does_not_match_individual_suwayomi_chapters(self):
        from backend.features.search import manual_search

        volume_data = self._volume_data()
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = volume_data
        mock_volume.get_issues.return_value = _issues(*range(1, 16))

        def fake_check_match(result, *args, **kwargs):
            return {'match': True, 'match_issue': None}

        with patch('backend.features.search.Volume', return_value=mock_volume), \
             patch('backend.features.search.run', side_effect=_closed_run_result(self._suwayomi_chapters(1, 3))), \
             patch('backend.features.search.get_mangadex_volume_chapter_map',
                   return_value=None), \
             patch('backend.features.search.check_search_result_match',
                   side_effect=fake_check_match):
            results = manual_search(1, None)

        self.assertFalse(
            [r for r in results if r.get('link', '').startswith('suwayomi:')],
            'Volume-level manga searches must not match individual Suwayomi chapters',
        )


if __name__ == '__main__':
    unittest.main()
