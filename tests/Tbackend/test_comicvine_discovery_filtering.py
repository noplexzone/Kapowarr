"""Regression tests for ComicVine Discovery comic/manga separation."""

import ast
import unittest
from pathlib import Path
from typing import Any, Dict, FrozenSet, Union
from datetime import date as _date
from backend.base.definitions import DateType
from backend.base.file_extraction import extract_issue_number
from backend.base.helpers import first_of_range, force_range
from unicodedata import normalize


def _normalise_query_string(value):
    return ''.join(
        c for c in normalize('NFKD', value)
        if not ('\u0300' <= c <= '\u036f')
    )


def _load_discovery_filter_symbols():
    source_path = Path(__file__).parents[2] / 'backend' / 'implementations' / 'comicvine.py'
    module = ast.parse(source_path.read_text())
    names = {
        '_NON_ENGLISH_PUBLISHERS',
        '_NON_ENGLISH_TITLE_KEYWORDS',
        '_MANGA_TITLE_KEYWORDS',
        '_ENGLISH_MANGA_PUBLISHERS',
        '_publisher_matches',
        '_is_comic_discovery_excluded_publisher',
        '_has_manga_discovery_title_keyword',
        '_has_usable_discovery_identity',
        '_is_manga_discovery_candidate_volume',
        '_is_comic_discovery_candidate_volume',
        '_parse_cv_date',
        'issue_date',
        '_issue_date',
        '_issue_number_value',
        '_first_known_issue',
        '_is_launch_issue_for_volume',
    }
    selected = [
        node
        for node in module.body
        if (
            isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)
        ) or (
            isinstance(node, ast.FunctionDef)
            and node.name in names
        )
    ]
    namespace = {'frozenset': frozenset, 'FrozenSet': FrozenSet, 'Any': Any, 'Dict': Dict, 'Union': Union, '_date': _date, 'DateType': DateType, 'first_of_range': first_of_range, 'force_range': force_range, 'extract_issue_number': extract_issue_number, 'str': str, 'bool': bool, 'any': any, 'normalise_query_string': _normalise_query_string}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source_path), 'exec'), namespace)
    return namespace


_SYMBOLS = _load_discovery_filter_symbols()


class ComicVineDiscoveryFilteringTests(unittest.TestCase):
    def test_short_aliases_and_imprints_match_publishers(self):
        publisher_matches = _SYMBOLS['_publisher_matches']
        excluded = _SYMBOLS['_is_comic_discovery_excluded_publisher']

        self.assertTrue(publisher_matches('Seven Seas', frozenset({'seven seas entertainment'})))
        self.assertTrue(excluded('Ize Press'))
        self.assertTrue(excluded('Manga Classics Inc.'))
        self.assertTrue(excluded('Yen On'))
        self.assertTrue(excluded('GOT'))
        self.assertFalse(excluded('Forgotten Realms Publishing'))
        self.assertTrue(excluded('Shōnen Gahōsha'))
        self.assertTrue(excluded('Line Manga'))
        self.assertTrue(excluded('Shodensha'))
        self.assertTrue(excluded('Shinchosha'))
        self.assertTrue(excluded('ShuCream'))
        self.assertTrue(excluded('Two Virgins'))
        self.assertTrue(excluded('Fujimi Shobo'))

    def test_title_keywords_are_normalized_before_comic_exclusion(self):
        has_keyword = _SYMBOLS['_has_manga_discovery_title_keyword']

        self.assertTrue(has_keyword('Monthly Dragon Age'))
        self.assertTrue(has_keyword('Feel Young'))
        self.assertTrue(has_keyword('COMIC it'))
        self.assertFalse(has_keyword('Amazing Spider-Man'))


    def test_reported_shinchosha_manga_titles_are_excluded_from_comic_shelves(self):
        excluded = _SYMBOLS['_is_comic_discovery_excluded_publisher']
        for title in [
            'Koba-kun wa Koi ga Wakaranai',
            'Kaji no Kaigo',
            'Kagetora-kun wa Modorenai',
            'Tsukikage Gohan',
            'My Pace to Aruku',
        ]:
            with self.subTest(title=title):
                self.assertTrue(excluded('Shinchosha'))

    def test_dark_horse_comic_vs_dark_horse_manga_classification(self):
        excluded = _SYMBOLS['_is_comic_discovery_excluded_publisher']
        self.assertFalse(excluded('Dark Horse Comics'))
        self.assertTrue(excluded('Dark Horse Manga'))

    def test_western_publishers_are_not_excluded_from_comic_discovery(self):
        excluded = _SYMBOLS['_is_comic_discovery_excluded_publisher']

        self.assertFalse(excluded('Marvel'))
        self.assertFalse(excluded('DC Comics'))

    def test_shared_candidate_classification_keeps_western_unicode_and_rejects_noise(self):
        is_comic = _SYMBOLS['_is_comic_discovery_candidate_volume']
        is_manga = _SYMBOLS['_is_manga_discovery_candidate_volume']
        western = {'name': 'The Incal: L’Intégrale', 'publisher': {'name': 'Humanoids'}, 'count_of_issues': 6}
        manga = {'name': 'Delicious in Dungeon', 'publisher': {'name': 'Yen Press'}, 'count_of_issues': 14}
        issue_less = {'name': 'Unused ComicVine Placeholder', 'publisher': {'name': 'Image'}, 'count_of_issues': 0}
        self.assertTrue(is_comic(western))
        self.assertFalse(is_manga(western))
        self.assertTrue(is_manga(manga))
        self.assertFalse(is_comic(manga))
        self.assertFalse(is_comic(issue_less))

    def test_reported_recently_active_manga_publishers_are_excluded_from_comics(self):
        is_comic = _SYMBOLS['_is_comic_discovery_candidate_volume']
        is_manga = _SYMBOLS['_is_manga_discovery_candidate_volume']
        for publisher in ('GOT', 'Bunkasha', 'Kobunsha', 'Seoul Munhwasa', 'Project-H'):
            volume = {'name': 'Reported title', 'publisher': {'name': publisher}, 'count_of_issues': 1}
            self.assertFalse(is_comic(volume), publisher)
            self.assertTrue(is_manga(volume), publisher)


class ComicVineShelfSemanticsTests(unittest.TestCase):
    def test_recently_started_requires_earliest_known_issue_inside_window(self):
        from datetime import date, timedelta
        from backend.implementations.comicvine import _is_recently_started_volume
        today = date(2026, 8, 15)
        self.assertTrue(_is_recently_started_volume({'issues': [{'id': 1, 'issue_number': '1', 'cover_date': (today - timedelta(days=330)).isoformat()}]}, today))
        self.assertFalse(_is_recently_started_volume({'issues': [{'id': 1, 'issue_number': '1', 'cover_date': (today - timedelta(days=400)).isoformat()}]}, today))
        self.assertFalse(_is_recently_started_volume({'issues': [{'id': 1, 'issue_number': '1', 'cover_date': (today + timedelta(days=1)).isoformat()}]}, today))

    def test_upcoming_launch_requires_issue_one_as_earliest_known_issue(self):
        from backend.implementations.comicvine import _is_launch_issue_for_volume
        issue_one = {'id': 10, 'issue_number': '1', 'cover_date': '2026-09-01'}
        self.assertTrue(_is_launch_issue_for_volume(issue_one, {'issues': [issue_one]}))
        self.assertFalse(_is_launch_issue_for_volume({'id': 11, 'issue_number': '15', 'cover_date': '2026-09-01'}, {'issues': [{'id': 1, 'issue_number': '1', 'cover_date': '2020-01-01'}, {'id': 11, 'issue_number': '15', 'cover_date': '2026-09-01'}]}))
        self.assertFalse(_is_launch_issue_for_volume(issue_one, {'issues': [{'id': 9, 'issue_number': '0', 'cover_date': '2026-08-01'}, issue_one]}))


    def test_upcoming_launch_allows_issue_zero_special_or_annual_as_first_issue(self):
        is_launch = _SYMBOLS['_is_launch_issue_for_volume']
        volume = {
            'issues': [
                {'id': 1, 'issue_number': '0', 'cover_date': '2026-09-01'},
                {'id': 2, 'issue_number': '1', 'cover_date': '2026-10-01'},
            ]
        }
        self.assertTrue(is_launch(volume['issues'][0], volume))
        self.assertFalse(is_launch(volume['issues'][1], volume))

    def test_upcoming_launch_uses_configured_store_date_when_preferred(self):
        is_launch = _SYMBOLS['_is_launch_issue_for_volume']
        volume = {
            'issues': [
                {'id': 1, 'issue_number': '1', 'cover_date': '2026-12-01', 'store_date': '2026-09-01'},
                {'id': 2, 'issue_number': '0', 'cover_date': '2026-09-01', 'store_date': '2026-10-01'},
            ]
        }
        self.assertTrue(is_launch(volume['issues'][0], volume, 'store_date'))
        self.assertFalse(is_launch(volume['issues'][1], volume, 'store_date'))

    def test_first_publication_fact_uses_persistent_volume_identity_and_date_basis(self):
        from backend.implementations.comicvine import _first_publication_fact_from_volume
        volume = {'id': 4050, 'name': 'Fact Series', 'image': {'small_url': 'cover.jpg'}, 'site_detail_url': 'site', 'start_year': '2026', 'publisher': {'name': 'DC'}, 'issues': [
            {'id': 2, 'issue_number': '2', 'cover_date': '2026-10-01', 'store_date': '2026-08-01'},
            {'id': 1, 'issue_number': '1', 'cover_date': '2026-09-01', 'store_date': '2026-09-15'},
        ]}
        fact = _first_publication_fact_from_volume(volume, 'store_date', upcoming_issue=volume['issues'][0])
        self.assertEqual(fact['comicvine_volume_id'], 4050)
        self.assertEqual(fact['first_known_issue_id'], 2)
        self.assertEqual(fact['first_known_issue_date'], '2026-08-01')
        self.assertEqual(fact['date_source'], 'store_date')
        self.assertTrue(fact['is_upcoming_launch'])
        self.assertEqual(fact['volume_title'], 'Fact Series')
        self.assertEqual(fact['cover_link'], 'cover.jpg')
        self.assertEqual(fact['publisher'], 'DC')

if __name__ == '__main__':
    unittest.main()
