"""Regression tests for ComicVine Discovery comic/manga separation."""

import ast
import unittest
from pathlib import Path
from typing import FrozenSet
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
    namespace = {'frozenset': frozenset, 'FrozenSet': FrozenSet, 'str': str, 'bool': bool, 'any': any, 'normalise_query_string': _normalise_query_string}
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
        self.assertTrue(excluded('Shōnen Gahōsha'))
        self.assertTrue(excluded('Line Manga'))
        self.assertTrue(excluded('Shodensha'))
        self.assertTrue(excluded('ShuCream'))
        self.assertTrue(excluded('Two Virgins'))

    def test_title_keywords_are_normalized_before_comic_exclusion(self):
        has_keyword = _SYMBOLS['_has_manga_discovery_title_keyword']

        self.assertTrue(has_keyword('Monthly Dragon Age'))
        self.assertTrue(has_keyword('Feel Young'))
        self.assertTrue(has_keyword('COMIC it'))
        self.assertFalse(has_keyword('Amazing Spider-Man'))

    def test_western_publishers_are_not_excluded_from_comic_discovery(self):
        excluded = _SYMBOLS['_is_comic_discovery_excluded_publisher']

        self.assertFalse(excluded('Marvel'))
        self.assertFalse(excluded('DC Comics'))


if __name__ == '__main__':
    unittest.main()
