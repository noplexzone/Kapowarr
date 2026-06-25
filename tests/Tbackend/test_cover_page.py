# -*- coding: utf-8 -*-
"""Tests for the MangaDex cover-art candidate lookup."""

import unittest
from unittest.mock import MagicMock, patch


def _make_cover(cover_id: str, volume: str, locale: str = "en") -> dict:
    return {
        "id": cover_id,
        "attributes": {
            "volume": volume,
            "fileName": f"cover-{cover_id}.jpg",
            "locale": locale,
            "description": None,
        },
    }


def _make_manga(manga_id: str, title: str) -> dict:
    return {
        "id": manga_id,
        "attributes": {
            "title": {"en": title},
            "altTitles": [],
            "status": "completed",
            "lastChapter": "200",
        },
    }


class VolumeNumberNormalisationTest(unittest.TestCase):
    """Verify that integer-valued floats are formatted as plain integers."""

    def _vol_str(self, num: float) -> str:
        return str(int(num)) if num == int(num) else str(num)

    def test_integer_volume(self):
        self.assertEqual(self._vol_str(30.0), "30")

    def test_fractional_volume(self):
        self.assertEqual(self._vol_str(1.5), "1.5")

    def test_single_digit(self):
        self.assertEqual(self._vol_str(1.0), "1")


class FindVolumeCoverCandidatesTest(unittest.TestCase):
    """Tests for find_volume_cover_candidates."""

    def _make_client(self, manga_id, manga_title, covers):
        client = MagicMock()
        client.search_manga.return_value = [_make_manga(manga_id, manga_title)]
        client.get_covers.return_value = covers
        return client

    def test_returns_matched_cover(self):
        from backend.implementations.mangadex import find_volume_cover_candidates

        covers = [
            _make_cover("cov-1", "30"),
            _make_cover("cov-2", "29"),
        ]
        client = self._make_client("manga-abc", "Jujutsu Kaisen", covers)

        with patch(
            "backend.implementations.mangadex.MangaDexClient",
            return_value=client,
        ):
            results = find_volume_cover_candidates("Jujutsu Kaisen", 30.0)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["volume"], "30")
        self.assertEqual(results[0]["cover_id"], "cov-1")
        self.assertEqual(results[0]["source"], "MangaDex")
        self.assertIn("manga-abc", results[0]["image_url"])
        self.assertIn(".256.jpg", results[0]["thumbnail_url"])

    def test_no_matching_volume_returns_empty(self):
        from backend.implementations.mangadex import find_volume_cover_candidates

        covers = [_make_cover("cov-99", "5")]
        client = self._make_client("manga-xyz", "Some Manga", covers)

        with patch(
            "backend.implementations.mangadex.MangaDexClient",
            return_value=client,
        ):
            results = find_volume_cover_candidates("Some Manga", 30.0)

        self.assertEqual(results, [])

    def test_no_manga_candidate_returns_empty(self):
        from backend.implementations.mangadex import find_volume_cover_candidates

        client = MagicMock()
        client.search_manga.return_value = []

        with patch(
            "backend.implementations.mangadex.MangaDexClient",
            return_value=client,
        ):
            results = find_volume_cover_candidates("Obscure Title", 1.0)

        self.assertEqual(results, [])

    def test_network_error_returns_empty(self):
        from requests.exceptions import RequestException
        from backend.implementations.mangadex import find_volume_cover_candidates

        client = MagicMock()
        client.search_manga.side_effect = RequestException("timeout")

        with patch(
            "backend.implementations.mangadex.MangaDexClient",
            return_value=client,
        ):
            results = find_volume_cover_candidates("Any Title", 1.0)

        self.assertEqual(results, [])

    def test_empty_title_returns_empty(self):
        from backend.implementations.mangadex import find_volume_cover_candidates

        results = find_volume_cover_candidates("", 1.0)
        self.assertEqual(results, [])

    def test_english_cover_preferred_when_available(self):
        from backend.implementations.mangadex import find_volume_cover_candidates

        covers = [
            _make_cover("cov-ja", "1", locale="ja"),
            _make_cover("cov-en", "1", locale="en"),
            _make_cover("cov-c", "2", locale="en"),
        ]
        client = self._make_client("manga-111", "Demo Manga", covers)

        with patch(
            "backend.implementations.mangadex.MangaDexClient",
            return_value=client,
        ):
            results = find_volume_cover_candidates("Demo Manga", 1.0)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["cover_id"], "cov-en")
        self.assertEqual(results[0]["locale"], "en")

    def test_non_english_covers_returned_when_no_english_exists(self):
        from backend.implementations.mangadex import find_volume_cover_candidates

        covers = [
            _make_cover("cov-ja", "1", locale="ja"),
            _make_cover("cov-ko", "1", locale="ko"),
            _make_cover("cov-c", "2", locale="en"),
        ]
        client = self._make_client("manga-111", "Demo Manga", covers)

        with patch(
            "backend.implementations.mangadex.MangaDexClient",
            return_value=client,
        ):
            results = find_volume_cover_candidates("Demo Manga", 1.0)

        self.assertEqual(len(results), 2)
        self.assertCountEqual(
            [r["cover_id"] for r in results], ["cov-ja", "cov-ko"]
        )


if __name__ == "__main__":
    unittest.main()
