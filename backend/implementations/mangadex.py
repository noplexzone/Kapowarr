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
import re
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
            params=[("includes[]", "cover_art"), ("includes[]", "manga")],
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

    def get_cover_image(self, cover_url: str) -> bytes:
        """Fetch a MangaDex cover image for storing as the monitored cover."""
        resp = self._ssn.get(cover_url, timeout=Constants.REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.content

    def get_tags(self) -> List[dict]:
        resp = self._ssn.get(f"{self._base_url}/manga/tag", timeout=Constants.REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json().get("data") or []

    def search_author(self, name: str, limit: int = 10) -> List[dict]:
        resp = self._ssn.get(
            f"{self._base_url}/author",
            params=[("name", name), ("limit", str(limit))],
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


def _cover_links(
    manga: dict,
    covers: Union[List[dict], None] = None,
    preferred_locale: str = "en",
) -> tuple[str, str]:
    manga_id = manga.get("id") or ""
    cover_records = covers or []
    preferred_locale = (preferred_locale or "en").lower()

    def attrs(record: dict) -> dict:
        return record.get("attributes") or {}

    def file_name(record: dict) -> str:
        return str(attrs(record).get("fileName") or "")

    def locale(record: dict) -> str:
        return str(attrs(record).get("locale") or "").lower()

    if cover_records:
        # The manga relationship can point at a later or promotional cover.  For
        # add/search cards, prefer covers in the selected translation language
        # when MangaDex has them, then use the earliest numbered print-volume
        # cover as the fallback.
        sorted_covers = sorted(
            (c for c in cover_records if file_name(c)),
            key=lambda c: (
                locale(c) != preferred_locale,
                _volume_sort_key(attrs(c).get("volume")),
            ),
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


def _last_volume_number(attrs: dict) -> int:
    try:
        return int(float(str(attrs.get("lastVolume") or "0")))
    except (TypeError, ValueError):
        return 0


def _normalise_volume_zero_title(title: str) -> str:
    return " ".join(
        str(title or "")
        .lower()
        .replace(":", " ")
        .replace("-", " ")
        .split()
    )


def _volume_zero_related_matches_parent(manga: dict, rel_attrs: dict) -> bool:
    """Return whether a volume-0 relation belongs to this exact title family.

    MangaDex can attach older franchise entries as ``prequel`` relations.  That
    is useful for the original Jujutsu Kaisen title, where "Jujutsu Kaisen 0"
    should be monitored as volume 0.  It is wrong for sequel/spinoff titles such
    as "Jujutsu Kaisen Modulo": their prequel list can also contain JJK 0, but
    Modulo itself only has volumes 1-3.
    """
    parent_titles = {
        _normalise_volume_zero_title(t)
        for t in _iter_titles(manga)
        if t
    }
    related_titles = {
        _normalise_volume_zero_title(t)
        for t in _iter_titles({"attributes": rel_attrs})
        if t
    }
    for parent in parent_titles:
        if not parent:
            continue
        for related in related_titles:
            if related == f"{parent} 0" or related.startswith(f"{parent} 0 "):
                return True
    return False


def _has_volume_zero_related(manga: Optional[dict]) -> bool:
    """Return whether MangaDex links a matching volume-0 side volume.

    MangaDex stores Jujutsu Kaisen 0 as a related title rather than as volume 0
    in the main title aggregate, but Kapowarr monitors physical manga volumes as
    one series.  Only absorb a related lastVolume=0 entry when its title clearly
    matches the current title plus ``0``; do not inherit volume 0 from broad
    franchise prequels on sequel/spinoff series.
    """
    manga = manga or {}
    for rel in manga.get("relationships") or []:
        if rel.get("type") != "manga":
            continue
        if rel.get("related") not in {"prequel", "preserialization"}:
            continue
        attrs = rel.get("attributes") or {}
        if (
            _last_volume_number(attrs) == 0
            and attrs.get("lastVolume") is not None
            and _volume_zero_related_matches_parent(manga, attrs)
        ):
            return True
    return False


def mangadex_should_include_volume_zero(manga: Optional[dict]) -> bool:
    """Return whether Kapowarr should synthesize a MangaDex volume-0 row."""
    return _has_volume_zero_related(manga)


def _numbered_volume_keys(
    mapping: VolumeChapterMap,
    attrs: Optional[dict] = None,
    include_volume_zero: bool = False,
) -> List[float]:
    """Return distinct MangaDex print volume numbers, including volume 0.

    MangaDex translated aggregates can omit untranslated/unavailable volumes
    even with includeUnavailable=1.  When MangaDex reports lastVolume, fill the
    physical range so a series with volume 0 through 30 monitors 31 volumes.
    """
    numbered = sorted(k for k in mapping if k >= 0)
    last_volume = _last_volume_number(attrs or {})
    if last_volume > 0:
        start = 0 if include_volume_zero or 0.0 in numbered else 1
        return [float(n) for n in range(start, last_volume + 1)]
    if numbered:
        return numbered
    return sorted(mapping)


def _reported_volume_count(
    attrs: dict,
    mapping: Union[VolumeChapterMap, None],
    include_volume_zero: bool = False,
) -> int:
    """Return MangaDex's physical volume count for search cards."""
    return len(_numbered_volume_keys(mapping or {}, attrs, include_volume_zero))


def format_mangadex_issue_rows(
    mangadex_id: str,
    mapping: VolumeChapterMap,
    attrs: Optional[dict] = None,
    include_volume_zero: bool = False,
) -> List[dict]:
    """Convert a MangaDex aggregate volume map into Kapowarr issue rows."""
    rows: List[dict] = []
    for volume_number in _numbered_volume_keys(mapping, attrs, include_volume_zero):
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


def format_mangadex_volume_folder_name(title: str, year: Optional[int]) -> str:
    """Return Kapowarr's default folder name for MangaDex-backed manga."""
    clean_title = str(title or '').strip()
    return f"{clean_title} ({year})" if year else clean_title

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
    thumb, cover = _cover_links(manga, covers, language)
    include_volume_zero = _has_volume_zero_related(manga)
    issue_count = _reported_volume_count(attrs, mapping, include_volume_zero)
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
            try:
                manga = client.get_manga(mangadex_id) or manga
            except RequestException:
                pass
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


_MANGADEX_DEMOGRAPHICS = {'shounen', 'shoujo', 'josei', 'seinen', 'none'}
_MANGADEX_STATUSES = {'ongoing', 'completed', 'hiatus', 'cancelled'}
_MANGADEX_CONTENT_RATINGS = {'safe', 'suggestive', 'erotica', 'pornographic'}

def _mangadex_year_from_attributes(attrs: dict) -> Optional[int]:
    year = attrs.get('year')
    try:
        return int(year) if year is not None else None
    except (TypeError, ValueError):
        return None


def _mangadex_cover_from_relationships(manga: dict) -> tuple[str, str]:
    manga_id = str(manga.get('id') or '')
    for rel in manga.get('relationships') or []:
        if rel.get('type') == 'cover_art':
            file_name = (rel.get('attributes') or {}).get('fileName')
            if file_name:
                return _cover_url(manga_id, str(file_name))
    return ('', '')


def format_mangadex_catalog_result(manga: dict) -> VolumeMetadata:
    attrs = manga.get('attributes') or {}
    manga_id = str(manga.get('id') or '')
    cover_link, cover_url = _mangadex_cover_from_relationships(manga)
    language = _default_language(manga)
    return {
        'comicvine_id': mangadex_surrogate_id(manga_id),
        'metadata_source': 'mangadex',
        'metadata_source_label': 'MangaDex',
        'metadata_id': manga_id,
        'metadata_language': language,
        'available_languages': sorted({language, attrs.get('originalLanguage') or ''} - {''}),
        'title': _first_title(manga, manga_id),
        'year': _mangadex_year_from_attributes(attrs),
        'publisher': None,
        'volume_number': None,
        'cover_link': cover_link,
        'cover_url': cover_url,
        'description': attrs.get('description', {}).get('en') if isinstance(attrs.get('description'), dict) else '',
        'site_url': f'https://mangadex.org/title/{manga_id}',
        'issue_count': None,
        'issues': None,
        'date_added': attrs.get('createdAt'),
        'status': attrs.get('status'),
        'original_language': attrs.get('originalLanguage'),
        'demographic': attrs.get('publicationDemographic'),
        'content_rating': attrs.get('contentRating'),
    }


def browse_mangadex_catalog(
    *,
    query: str = '',
    offset: int = 0,
    limit: int = 30,
    sort: str = 'recently_updated',
    status: str = '',
    original_language: str = '',
    demographic: str = '',
    content_rating: str = '',
    year: str = '',
    decade: str = '',
    author: str = '',
    artist: str = '',
    tags: str = '',
    translated_language: str = '',
) -> dict:
    """Browse MangaDex directly. Never falls back to ComicVine."""
    client = MangaDexClient()
    params = [
        ('limit', str(limit + 1)),
        ('offset', str(offset)),
        ('includes[]', 'cover_art'),
    ]
    if translated_language:
        params.append(('availableTranslatedLanguage[]', translated_language))
    if query:
        params.append(('title', query))
    order_key = {
        'title': 'title',
        'year': 'year',
        'recently_started': 'year',
        'recently_updated': 'updatedAt',
        'trending': 'followedCount',
    }.get(sort, 'updatedAt')
    params.append((f'order[{order_key}]', 'desc' if order_key != 'title' else 'asc'))
    if status:
        if status not in _MANGADEX_STATUSES:
            raise ValueError(f'Unsupported MangaDex status: {status}')
        params.append(('status[]', status))
    if original_language:
        params.append(('originalLanguage[]', original_language))
    if demographic:
        if demographic not in _MANGADEX_DEMOGRAPHICS:
            raise ValueError(f'Unsupported MangaDex demographic: {demographic}')
        params.append(('publicationDemographic[]', demographic))
    if content_rating:
        ratings = [r for r in content_rating.split(',') if r]
        if any(r not in _MANGADEX_CONTENT_RATINGS for r in ratings):
            raise ValueError(f'Unsupported MangaDex content rating: {content_rating}')
        for rating in ratings:
            params.append(('contentRating[]', rating))
    if tags:
        for tag in [t.strip() for t in tags.split(',') if t.strip()]:
            params.append(('includedTags[]', _resolve_tag_id(client, tag)))
    if author:
        params.append(('authors[]', _resolve_author_id(client, author)))
    if artist:
        params.append(('artists[]', _resolve_author_id(client, artist)))
    selected_year = None
    if year:
        try:
            selected_year = int(year)
        except ValueError:
            raise ValueError(f'Unsupported MangaDex year: {year}')
    years_to_fetch = []
    if selected_year:
        years_to_fetch = [selected_year]
    elif decade:
        try:
            decade_start = int(decade)
        except ValueError:
            raise ValueError(f'Unsupported MangaDex decade: {decade}')
        if decade_start % 10 != 0:
            raise ValueError(f'Unsupported MangaDex decade: {decade}')
        years_to_fetch = list(range(decade_start, decade_start + 10))
    payload_total = 0
    raw_items = []
    seen_ids = set()
    year_values = years_to_fetch or [None]
    decade_mode = bool(decade and not year)
    for selected in year_values:
        request_params = [p for p in params if p[0] not in ('limit', 'offset')]
        request_params.append(('limit', '100' if decade_mode else str(limit + 1)))
        request_params.append(('offset', '0' if decade_mode else str(offset)))
        if selected:
            request_params.append(('year', str(selected)))
        resp = client._ssn.get(f'{client._base_url}/manga', params=request_params, timeout=Constants.REQUEST_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
        payload_total += int(payload.get('total') or 0)
        for item in payload.get('data') or []:
            item_id = str(item.get('id') or '')
            if item_id and item_id in seen_ids:
                continue
            if item_id:
                seen_ids.add(item_id)
            raw_items.append(item)
            if not decade_mode and len(raw_items) > limit:
                break
        if not decade_mode and len(raw_items) > limit:
            break
    if decade_mode:
        raw_items.sort(key=lambda item: (
            -int(((item.get('attributes') or {}).get('year') or 0)),
            _first_title(item, str(item.get('id') or '')).casefold(),
            str(item.get('id') or ''),
        ))
        page_raw_items = raw_items[offset:offset + limit]
    else:
        page_raw_items = raw_items[:limit]
    items = [format_mangadex_catalog_result(manga) for manga in page_raw_items]
    if decade_mode:
        return {
            'items': items,
            'total': None,
            'offset': offset,
            'page_size': limit,
            'has_more': False,
            'is_bounded': True,
            'maximum_per_year': 100,
            'years_included': years_to_fetch,
            'source_note': 'Showing a bounded MangaDex sample of up to 100 titles per year. Exhaustive decade pagination requires a future local catalog index.',
        }
    total = int(payload_total or offset + len(items))
    return {
        'items': items,
        'total': total,
        'offset': offset,
        'page_size': limit,
        'has_more': offset + len(items) < total,
        'source_note': 'Manga catalog results come from MangaDex.',
    }


_UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')

def _is_uuid(value: str) -> bool:
    return bool(_UUID_RE.match(value.strip()))

def _localized_name(item: dict) -> str:
    attrs = item.get('attributes') or {}
    name = attrs.get('name') or {}
    if isinstance(name, dict):
        return str(name.get('en') or next((v for v in name.values() if v), '')).strip()
    return str(name or '').strip()

def _resolve_tag_id(client: MangaDexClient, value: str) -> str:
    value = value.strip()
    if _is_uuid(value):
        return value
    needle = value.casefold()
    for tag in client.get_tags():
        if _localized_name(tag).casefold() == needle:
            return str(tag.get('id') or '')
    raise ValueError(f'Unsupported MangaDex tag: {value}')

def _resolve_author_id(client: MangaDexClient, value: str) -> str:
    value = value.strip()
    if _is_uuid(value):
        return value
    needle = value.casefold()
    for item in client.search_author(value):
        attrs = item.get('attributes') or {}
        if str(attrs.get('name') or '').strip().casefold() == needle:
            return str(item.get('id') or '')
    raise ValueError(f'Unsupported MangaDex creator: {value}')

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
