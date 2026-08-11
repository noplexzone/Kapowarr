"""Regression tests for ComicVine Discovery comic/manga separation."""

import ast
import unittest
from pathlib import Path
from typing import FrozenSet


def _load_discovery_filter_symbols():
    source_path = Path(__file__).parents[2] / 'backend' / 'implementations' / 'comicvine.py'
    module = ast.parse(source_path.read_text())
    names = {
        '_NON_ENGLISH_PUBLISHERS',
        '_ENGLISH_MANGA_PUBLISHERS',
        '_publisher_matches',
        '_is_comic_discovery_excluded_publisher',
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
    namespace = {'frozenset': frozenset, 'FrozenSet': FrozenSet, 'str': str, 'bool': bool, 'any': any}
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

    def test_western_publishers_are_not_excluded_from_comic_discovery(self):
        excluded = _SYMBOLS['_is_comic_discovery_excluded_publisher']

        self.assertFalse(excluded('Marvel'))
        self.assertFalse(excluded('DC Comics'))


if __name__ == '__main__':
    unittest.main()
