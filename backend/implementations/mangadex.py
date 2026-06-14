# -*- coding: utf-8 -*-
"""MangaDex API helpers for manga volume/chapter metadata.

Kapowarr uses MangaDex only for metadata validation.  The important endpoint is
``/manga/{id}/aggregate?translatedLanguage[]=en&includeUnavailable=1``; the
normal chapter feed hides unavailable chapters and is not suitable for mapping
print volumes to chapter numbers.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Dict, Iterable, List, Optional

from requests import Session
from requests.exceptions import RequestException

from backend.base.definitions import Constants
from backend.base.logging import LOGGER

MANGADEX_API_URL = "https://api.mangadex.org"

VolumeChapterMap = Dict[float, List[float]]


def _to_float(value) -> Optional[float]:
    """Return value as float, or None for non-numeric MangaDex sentinels."""
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_aggregate_volume_map(payload: dict) -> VolumeChapterMap:
    """Parse a MangaDex aggregate response into {volume_number: chapters}.

    The aggregate response groups chapter placeholders by volume.  Unavailable
    chapters are intentionally included by the caller via ``includeUnavailable``;
    they still carry chapter/volume numbers and are useful for mapping.
    """
    parsed: VolumeChapterMap = {}
    volumes = payload.get("volumes") or {}
    if isinstance(volumes, dict):
        volume_items = volumes.items()
    elif isinstance(volumes, list):
        volume_items = (
            (v.get("volume"), v)
            for v in volumes
            if isinstance(v, dict)
        )
    else:
        return parsed

    for volume_key, volume_data in volume_items:
        if not isinstance(volume_data, dict):
            continue

        volume_number = _to_float(volume_data.get("volume", volume_key))
        if volume_number is None:
            continue

        chapter_numbers = set()
        chapters = volume_data.get("chapters") or {}
        if not isinstance(chapters, dict):
            continue

        for chapter_key, chapter_data in chapters.items():
            chapter_number = None
            if isinstance(chapter_data, dict):
                chapter_number = _to_float(chapter_data.get("chapter"))
            if chapter_number is None:
                chapter_number = _to_float(chapter_key)
            if chapter_number is not None:
                chapter_numbers.add(chapter_number)

        if chapter_numbers:
            parsed[volume_number] = sorted(chapter_numbers)

    return parsed


class MangaDexClient:
    """Small synchronous MangaDex API client."""

    def __init__(self) -> None:
        self._base_url = MANGADEX_API_URL
        self._ssn = Session()
        self._ssn.headers.update({"User-Agent": Constants.DEFAULT_USERAGENT})

    def search_manga(self, title: str, limit: int = 10) -> List[dict]:
        """Search MangaDex for manga title candidates."""
        resp = self._ssn.get(
            f"{self._base_url}/manga",
            params={"title": title, "limit": limit},
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        payload = resp.json()
        return payload.get("data") or []

    def get_aggregate_volume_map(self, mangadex_id: str) -> VolumeChapterMap:
        """Fetch and parse the English aggregate map, including unavailable chapters."""
        resp = self._ssn.get(
            f"{self._base_url}/manga/{mangadex_id}/aggregate",
            params=(
                ("translatedLanguage[]", "en"),
                ("includeUnavailable", "1"),
            ),
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return parse_aggregate_volume_map(resp.json())


def _iter_titles(manga: dict) -> Iterable[str]:
    attrs = manga.get("attributes") or {}
    title = attrs.get("title") or {}
    for value in title.values():
        if value:
            yield str(value)
    for alt in attrs.get("altTitles") or []:
        if isinstance(alt, dict):
            for value in alt.values():
                if value:
                    yield str(value)


def _normalise_title(title: str) -> str:
    return " ".join(title.lower().replace(":", " ").split())


def _select_best_candidate(candidates: List[dict], title: str) -> Optional[dict]:
    """Pick the most likely MangaDex candidate for a Kapowarr manga title."""
    if not candidates:
        return None

    target = _normalise_title(title)

    def score(manga: dict) -> tuple:
        attrs = manga.get("attributes") or {}
        titles = [_normalise_title(t) for t in _iter_titles(manga)]
        exact = target in titles
        contains = any(target and target in t for t in titles)
        status_bonus = attrs.get("status") == "completed"
        try:
            last_chapter = float(attrs.get("lastChapter") or 0)
        except (TypeError, ValueError):
            last_chapter = 0.0
        # Sort descending by this tuple.
        return (exact, contains, status_bonus, last_chapter)

    best = max(candidates, key=score)
    best_score = score(best)
    if not (best_score[0] or best_score[1]):
        return None
    return best


@lru_cache(maxsize=256)
def get_mangadex_volume_chapter_map(title: str) -> Optional[VolumeChapterMap]:
    """Resolve a title to MangaDex and return its aggregate volume/chapter map.

    Returns None for network/API failures or when no useful mapping is found.
    The cache avoids repeatedly hitting MangaDex during multi-issue searches.
    """
    if not title:
        return None

    client = MangaDexClient()
    try:
        candidates = client.search_manga(title)
        candidate = _select_best_candidate(candidates, title)
        if candidate is None:
            return None
        mapping = client.get_aggregate_volume_map(candidate["id"])
        return mapping or None
    except (KeyError, RequestException, ValueError) as e:
        LOGGER.warning("MangaDex lookup failed for %s: %s", title, e)
        return None
