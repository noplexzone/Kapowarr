# -*- coding: utf-8 -*-
"""MangaDex API helpers for manga volume/chapter metadata.

Kapowarr uses MangaDex only for metadata validation.  The important endpoint is
``/manga/{id}/aggregate?translatedLanguage[]=en&includeUnavailable=1``; the
normal chapter feed hides unavailable chapters and is not suitable for mapping
print volumes to chapter numbers.
"""

from __future__ import annotations

from functools import lru_cache
from hashlib import blake2b
from typing import Dict, Iterable, List, Optional, Union

from requests import Session
from requests.exceptions import RequestException

from backend.base.definitions import Constants, VolumeMetadata
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
            params=[("title", title), ("limit", limit), ("includes[]", "cover_art")],
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        payload = resp.json()
        return payload.get("data") or []

    def get_manga(self, mangadex_id: str) -> dict:
        """Fetch one MangaDex manga by UUID."""
        resp = self._ssn.get(
            f"{self._base_url}/manga/{mangadex_id}",
            params=[("includes[]", "cover_art")],
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("data") or {}

    def get_aggregate_volume_map(
        self,
        mangadex_id: str,
        translated_language: str = "en"
    ) -> VolumeChapterMap:
        """Fetch and parse an aggregate map, including unavailable chapters."""
        resp = self._ssn.get(
            f"{self._base_url}/manga/{mangadex_id}/aggregate",
            params=(
                ("translatedLanguage[]", translated_language),
                ("includeUnavailable", "1"),
            ),
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return parse_aggregate_volume_map(resp.json())

    def get_covers(self, manga_id: str) -> List[dict]:
        """Fetch up to 100 cover art records for a manga."""
        resp = self._ssn.get(
            f"{self._base_url}/cover",
            params=[
                ("manga[]", manga_id),
                ("limit", "100"),
                ("order[volume]", "asc"),
            ],
            timeout=Constants.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("data") or []


def mangadex_surrogate_id(*parts: str) -> int:
    """Return a deterministic negative integer ID for MangaDex compatibility.

    Kapowarr still has integer ComicVine-ID columns in several places.  MangaDex
    UUIDs are stored separately as metadata_id; this surrogate only keeps legacy
    integer fields unique and safely outside ComicVine's positive ID range.
    """
    raw = "|".join(str(p) for p in parts)
    digest = blake2b(raw.encode("utf-8"), digest_size=4).digest()
    return -int.from_bytes(digest, "big") - 1


def _first_title(manga: dict, fallback: str = "") -> str:
    attrs = manga.get("attributes") or {}
    title = attrs.get("title") or {}
    if isinstance(title, dict):
        if title.get("en"):
            return str(title["en"])
        for value in title.values():
            if value:
                return str(value)
    return fallback


def _volume_sort_key(value: Union[str, None]) -> tuple[int, float, str]:
    if value in (None, ""):
        return (1, 0.0, "")
    try:
        return (0, float(value), str(value))
    except (TypeError, ValueError):
        return (2, 0.0, str(value))


def _cover_url(manga_id: str, file_name: str) -> tuple[str, str]:
    return (
        f"https://uploads.mangadex.org/covers/{manga_id}/{file_name}.256.jpg",
        f"https://uploads.mangadex.org/covers/{manga_id}/{file_name}",
    )


def _cover_links(manga: dict, covers: Union[List[dict], None] = None) -> tuple[str, str]:
    manga_id = manga.get("id") or ""
    cover_records = covers or []

    def file_name(record: dict) -> str:
        return str((record.get("attributes") or {}).get("fileName") or "")

    if cover_records:
        # The manga relationship can point at a later or promotional cover.  For
        # add/search cards, prefer the first numbered print-volume cover.
        sorted_covers = sorted(
            (c for c in cover_records if file_name(c)),
            key=lambda c: _volume_sort_key((c.get("attributes") or {}).get("volume")),
        )
        if sorted_covers:
            return _cover_url(manga_id, file_name(sorted_covers[0]))

    for rel in manga.get("relationships") or []:
        if rel.get("type") != "cover_art":
            continue
        name = (rel.get("attributes") or {}).get("fileName")
        if name:
            return _cover_url(manga_id, str(name))
    return "", ""


def _available_languages(manga: dict) -> List[str]:
    attrs = manga.get("attributes") or {}
    languages = attrs.get("availableTranslatedLanguages") or []
    return sorted({str(lang) for lang in languages if lang})


def _default_language(manga: dict) -> str:
    languages = _available_languages(manga)
    if "en" in languages:
        return "en"
    return languages[0] if languages else "en"


def _numbered_volume_keys(mapping: VolumeChapterMap) -> List[float]:
    numbered = sorted(k for k in mapping if k > 0)
    if numbered:
        return numbered
    return sorted(mapping)


def format_mangadex_issue_rows(mangadex_id: str, mapping: VolumeChapterMap) -> List[dict]:
    """Convert a MangaDex aggregate volume map into Kapowarr issue rows."""
    rows: List[dict] = []
    for volume_number in _numbered_volume_keys(mapping):
        chapters = sorted(mapping.get(volume_number) or [])
        if volume_number == int(volume_number):
            issue_number = str(int(volume_number))
        else:
            issue_number = str(volume_number)
        if chapters:
            chapter_text = ", ".join(
                str(int(c)) if c == int(c) else str(c)
                for c in chapters
            )
            description = f"MangaDex volume {issue_number}; chapters: {chapter_text}"
        else:
            description = f"MangaDex volume {issue_number}"
        rows.append({
            "comicvine_id": mangadex_surrogate_id(mangadex_id, issue_number),
            "issue_number": issue_number,
            "calculated_issue_number": float(volume_number),
            "title": f"Volume {issue_number}",
            "date": None,
            "description": description,
        })
    if not rows:
        rows.append({
            "comicvine_id": mangadex_surrogate_id(mangadex_id, "volume"),
            "issue_number": "1",
            "calculated_issue_number": 1.0,
            "title": "Volume 1",
            "date": None,
            "description": "MangaDex volume",
        })
    return rows


def format_mangadex_volume_result(
    manga: dict,
    mapping: Union[VolumeChapterMap, None] = None,
    translated_language: Union[str, None] = None,
    covers: Union[List[dict], None] = None,
) -> VolumeMetadata:
    attrs = manga.get("attributes") or {}
    mangadex_id = str(manga.get("id") or "")
    title = _first_title(manga, mangadex_id)
    language = translated_language or _default_language(manga)
    thumb, cover = _cover_links(manga, covers)
    issue_count = len(_numbered_volume_keys(mapping or {})) if mapping else 0
    if not issue_count:
        try:
            issue_count = int(attrs.get("lastVolume") or 0)
        except (TypeError, ValueError):
            issue_count = 0
    return {
        "comicvine_id": mangadex_surrogate_id(mangadex_id),
        "metadata_source": "mangadex",
        "metadata_id": mangadex_id,
        "metadata_language": language,
        "available_languages": _available_languages(manga),
        "title": title,
        "year": attrs.get("year"),
        "volume_number": 1,
        "cover_link": thumb or cover,
        "cover": None,
        "description": attrs.get("description", {}).get("en") if isinstance(attrs.get("description"), dict) else "",
        "site_url": f"https://mangadex.org/title/{mangadex_id}",
        "aliases": [t for t in _iter_titles(manga) if t != title],
        "publisher": "MangaDex",
        "issue_count": issue_count,
        "translated": True,
        "already_added": None,
        "issues": None,
        "date_added": None,
    }


def search_mangadex_volumes(title: str, limit: int = 10) -> List[VolumeMetadata]:
    """Search MangaDex and return Kapowarr add-volume compatible results."""
    if not title:
        return []
    client = MangaDexClient()
    try:
        results: List[VolumeMetadata] = []
        for manga in client.search_manga(title, limit=limit):
            mangadex_id = str(manga.get("id") or "")
            if not mangadex_id:
                continue
            language = _default_language(manga)
            try:
                mapping = client.get_aggregate_volume_map(mangadex_id, language)
            except RequestException:
                mapping = {}
            try:
                covers = client.get_covers(mangadex_id)
            except RequestException:
                covers = []
            results.append(format_mangadex_volume_result(manga, mapping, language, covers))
        return results
    except (KeyError, RequestException, ValueError) as e:
        LOGGER.warning("MangaDex volume search failed for %s: %s", title, e)
        return []


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


def find_volume_cover_candidates(title: str, volume_number: float) -> List[dict]:
    """Find MangaDex cover art records matching a title and print volume number.

    Returns a list of candidate dicts with keys: source, manga_id, manga_title,
    volume, cover_id, file_name, image_url, thumbnail_url, locale, description.
    Returns an empty list on any error or when no match is found.
    """
    if not title:
        return []

    vol_str = (
        str(int(volume_number))
        if volume_number == int(volume_number)
        else str(volume_number)
    )

    client = MangaDexClient()
    try:
        candidates = client.search_manga(title)
        manga = _select_best_candidate(candidates, title)
        if manga is None:
            return []

        manga_id = manga["id"]
        attrs = manga.get("attributes") or {}
        manga_title = next(iter((attrs.get("title") or {}).values()), title)

        covers = client.get_covers(manga_id)
        matched = [
            c for c in covers
            if (c.get("attributes") or {}).get("volume") == vol_str
        ]
        english_matched = [
            c for c in matched
            if str((c.get("attributes") or {}).get("locale") or "").lower() == "en"
        ]
        if english_matched:
            matched = english_matched
        else:
            matched.sort(
                key=lambda c: str(
                    (c.get("attributes") or {}).get("locale") or ""
                ).lower() != "en"
            )

        results = []
        for cover in matched:
            cover_attrs = cover.get("attributes") or {}
            file_name = cover_attrs.get("fileName", "")
            cover_id = cover.get("id", "")
            image_url = (
                f"https://uploads.mangadex.org/covers/{manga_id}/{file_name}"
            )
            thumbnail_url = (
                f"https://uploads.mangadex.org/covers/{manga_id}/{file_name}.256.jpg"
            )
            results.append({
                "source": "MangaDex",
                "manga_id": manga_id,
                "manga_title": manga_title,
                "volume": vol_str,
                "cover_id": cover_id,
                "file_name": file_name,
                "image_url": image_url,
                "thumbnail_url": thumbnail_url,
                "locale": cover_attrs.get("locale"),
                "description": cover_attrs.get("description"),
            })
        return results

    except (KeyError, RequestException, ValueError) as e:
        LOGGER.warning(
            "MangaDex cover search failed for %s vol %s: %s", title, vol_str, e
        )
        return []


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
