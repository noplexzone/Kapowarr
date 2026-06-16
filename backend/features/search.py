# -*- coding: utf-8 -*-

from asyncio import gather, get_running_loop, run
from re import IGNORECASE, compile as _re_compile, findall as _re_findall, sub
from typing import Dict, List, Optional, Tuple, Union

from backend.base.definitions import (QUERY_FORMATS, DownloadSource,
                                      MatchedSearchResultData, SearchResultData,
                                      SearchSource, SpecialVersion, VolumeData)
from backend.base.file_extraction import refine_special_version
from backend.base.helpers import (AsyncSession, check_overlapping_issues,
                                  extract_year_from_date, force_range,
                                  get_subclasses, normalise_query_string,
                                  redact_url_for_log)
from backend.base.logging import LOGGER
from backend.implementations.getcomics import search_getcomics
from backend.implementations.matching import check_search_result_match
from backend.implementations.mangadex import get_mangadex_volume_chapter_map
from backend.implementations.nzb_indexers import NZBIndexers
from backend.implementations.suwayomi import (SUWAYOMI_SCHEME,
                                              SUWAYOMI_SOURCE_NAME,
                                              SuwayomiClient,
                                              make_suwayomi_link,
                                              make_suwayomi_volume_link,
                                              parse_suwayomi_link)
from backend.implementations.volumes import Volume
from backend.internals.settings import Settings


_SOURCE_PRIORITY_FALLBACK = 999
_SOURCE_PRIORITY_VALUES = ('usenet', 'getcomics', 'suwayomi')


def _search_result_source_id(result: SearchResultData) -> str:
    """Map a search result to the configurable source-priority id."""
    link = result.get('link', '')
    source = str(result.get('source', '')).lower()
    if link.startswith(SUWAYOMI_SCHEME) or source == 'suwayomi':
        return 'suwayomi'
    if 'getcomics' in link.lower() or source == 'getcomics':
        return 'getcomics'
    return 'usenet'


def _source_priority_for_volume(volume_data: VolumeData) -> List[str]:
    """Return configured source priority for this volume's library type."""
    from backend.implementations.suwayomi import is_manga_publisher
    from backend.internals.settings import Settings

    publisher = getattr(volume_data, 'publisher', None)
    is_manga = is_manga_publisher(publisher)
    try:
        settings = Settings().sv
        if is_manga:
            priority = list(settings.manga_source_priority)
        else:
            priority = list(settings.comic_source_priority)
    except RuntimeError:
        # Some isolated unit tests exercise auto_search without a Flask/DB
        # context.  Use defaults rather than making source ordering force an
        # application context where the previous code did not need one.
        priority = (
            ['suwayomi', 'usenet', 'getcomics']
            if is_manga else ['usenet', 'getcomics']
        )
    return [p for p in priority if p in _SOURCE_PRIORITY_VALUES]


def _sort_by_source_priority(
    results: List[MatchedSearchResultData],
    volume_data: VolumeData,
) -> List[MatchedSearchResultData]:
    """Return matched results sorted by configured source priority."""
    priority = _source_priority_for_volume(volume_data)
    priority_index = {source: idx for idx, source in enumerate(priority)}
    return sorted(
        results,
        key=lambda r: priority_index.get(
            _search_result_source_id(r), _SOURCE_PRIORITY_FALLBACK
        ),
    )


def _rank_search_result(
    result: MatchedSearchResultData,
    title: str,
    volume_number: int,
    year: Tuple[Union[int, None], Union[int, None]] = (None, None),
    calculated_issue_number: Union[float, None] = None
) -> List[int]:
    """Give a search result a rank, based on which you can sort.

    Args:
        result (MatchedSearchResultData): A search result.

        title (str): Title of volume.

        volume_number (int): The volume number of the volume.

        year (Tuple[Union[int, None], Union[int, None]], optional): The year of
        the volume and the year of the issue if searching for an issue and
        release date is known.
            Defaults to (None, None).

        calculated_issue_number (Union[float, None], optional): The
        calculated_issue_number of the issue.
            Defaults to None.

    Returns:
        List[int]: A list of numbers which determines the ranking of the result.
    """
    rating = []

    # Prefer matches (False == 0 == higher rank)
    rating.append(not result['match'])

    # The more words in the search term that are present in
    # the search results' title, the higher ranked it gets
    split_title = title.split(' ')
    rating.append(len([
        word
        for word in result['series'].split(' ')
        if word not in split_title
    ]))

    # Prefer volume number or year matches, even better if both match
    vy_score = 3
    if (
        result['volume_number'] is not None
        and result['volume_number'] == volume_number
    ):
        vy_score -= 1

    if (
        year[1] is not None
        and result['year'] is not None
        and year[1] == result['year']
    ):
        # issue year direct match
        vy_score -= 2

    elif (
        year[0] is not None
        and year[1] is not None
        and result['year'] is not None
        and year[0] - 1 <= result['year'] <= year[1] + 1
    ):
        # fuzzy match between start year and issue year
        vy_score -= 1

    rating.append(vy_score)

    # Sort on issue number fitting
    if calculated_issue_number is not None:
        # Search was for issue
        if (
            isinstance(result['issue_number'], float)
            and calculated_issue_number == result['issue_number']
        ):
            # Issue number is direct match
            rating.append(0)

        elif isinstance(result['issue_number'], tuple):
            if (
                result['issue_number'][0]
                <= calculated_issue_number
                <= result['issue_number'][1]
            ):
                # Issue number falls between range
                rating.append(
                    1 - (1 / (
                        result['issue_number'][1] - result['issue_number'][0] + 1
                    ))
                )

            else:
                # Issue number falls outside so release is not useful
                rating.append(3)

        elif result['special_version'] is not None:
            # Issue number not found but is special version
            rating.append(2)

        else:
            # No issue number found and not special version
            rating.append(3)

    else:
        # Search was for volume
        if isinstance(result['issue_number'], tuple):
            rating.append(
                1.0
                /
                (result['issue_number'][1] - result['issue_number'][0] + 1)
            )

        elif isinstance(result['issue_number'], float):
            rating.append(1)

    return rating


class SearchGetComics(SearchSource):
    async def search(self, session: AsyncSession) -> List[SearchResultData]:
        return await search_getcomics(session, self.query)


class SearchNZBIndexers(SearchSource):
    async def search(self, _session: AsyncSession) -> List[SearchResultData]:
        # Fetch indexers here (Flask app context available in this thread)
        indexers = [i for i in NZBIndexers.get_all() if i.enabled]
        if not indexers:
            return []
        # Run HTTP requests in thread pool (no DB access, no app context needed)
        loop = get_running_loop()
        return await loop.run_in_executor(
            None, NZBIndexers.search_indexers, indexers, self.query
        )


class SearchSuwayomi(SearchSource):
    def supports_volume(self, volume_data: Optional[VolumeData]) -> bool:
        if volume_data is None or not volume_data.publisher:
            return True
        from backend.implementations.suwayomi import is_manga_publisher
        return is_manga_publisher(volume_data.publisher)

    async def search(self, _session: AsyncSession) -> List[SearchResultData]:
        loop = get_running_loop()
        return await loop.run_in_executor(None, self._search_sync)

    def _search_sync(self) -> List[SearchResultData]:
        client = SuwayomiClient()
        if not client.is_configured():
            return []

        series_title = _extract_series_title(self.query)
        if not series_title:
            return []

        try:
            library = client.get_library_manga()
        except Exception as e:
            LOGGER.warning('Suwayomi library search failed: %s', e)
            return []

        results: List[SearchResultData] = []
        title_lower = series_title.lower()
        for manga in library:
            manga_title: str = manga.get('title', '')
            if title_lower not in manga_title.lower():
                continue

            manga_id: int = manga['id']
            try:
                chapters = client.get_chapters(manga_id)
            except Exception as e:
                LOGGER.warning(
                    'Suwayomi: failed to get chapters for manga %d: %s',
                    manga_id, e,
                )
                continue

            for ch in chapters:
                ch_number = ch.get('chapterNumber')
                if ch_number is None or ch_number < 0:
                    continue

                results.append({
                    'link': make_suwayomi_link(manga_id, ch['id']),
                    'display_title': (
                        f"{manga_title} - Ch. {ch_number:.4g}"
                    ),
                    'source': SUWAYOMI_SOURCE_NAME,
                    'series': manga_title,
                    'year': None,
                    'volume_number': None,
                    'special_version': None,
                    'issue_number': float(ch_number),
                    'annual': False,
                })

        return results



def _extract_series_title(query: str) -> str:
    """Strip issue/volume/year suffixes from a search query to get the title."""
    # Remove "(year)", "#N", "Vol. N", "Volume N"
    title = sub(r'\s*\(\d{4}\)', '', query)
    title = sub(r'\s+#[\d.]+.*$', '', title, flags=IGNORECASE)
    title = sub(r'\s+Vol(?:ume)?\.?\s*\d+.*$', '', title, flags=IGNORECASE)
    return title.strip()


# Chapter-number extraction patterns.  Bracketed format
# (e.g. '[ 80 ] Title', 'Chapter [165] Title') handled
# by _BRACKET_CHAPTER_RE to cover ComicVine description
# variants that lack a plain 'Chapter N' prefix.
_CHAPTER_RANGE_RE = _re_compile(
    r'[Cc]hapters?\s+(\d+(?:\.\d+)?)'
    r'\s*(?:[-–]|to\b|through\b|\.\.\.)\s*'
    r'(?:[Cc]hapters?\s+)?(\d+(?:\.\d+)?)',
    IGNORECASE,
)
_CHAPTER_NUM_RE = _re_compile(r'[Cc]h(?:apter)?\.?\s*(\d+(?:\.\d+)?)')
_BRACKET_CHAPTER_RE = _re_compile(r'(?:[Cc]hapter\s+)?\[\s*(\d+(?:\.\d+)?)\s*\]')


def _parse_chapter_range_from_description(description: str) -> List[float]:
    """Extract chapter numbers from a manga issue/volume description.

    Handles 'Chapter 1 ... Chapter 7', 'Chapters 1-7', lists of individual
    'Chapter N' mentions, '[ N ] Title' bracket format, and 'Chapter [N]
    Title' bracket format.  Returns a sorted list of floats.
    """
    if not description:
        return []
    m = _CHAPTER_RANGE_RE.search(description)
    if m:
        start = float(m.group(1))
        end = float(m.group(2))
        if start <= end <= start + 100:
            nums: List[float] = []
            n = start
            while n <= end + 0.001:
                nums.append(round(n, 4))
                n += 1.0
            return nums
    hits = _re_findall(_CHAPTER_NUM_RE.pattern, description)
    if hits:
        return sorted(set(float(x) for x in hits))
    # Try bracket format: [ N ] or Chapter [N]
    hits = _re_findall(_BRACKET_CHAPTER_RE.pattern, description)
    if hits:
        return sorted(set(float(x) for x in hits))
    return []


_MAX_MANGADEX_CHAPTERS_PER_VOLUME = 40


def _mangadex_map_is_compatible(
    volume_chapter_map: Dict[float, List[float]],
    volume_issues: List,
) -> bool:
    """Return whether a MangaDex map appears to match this Kapowarr volume.

    MangaDex sometimes models webtoon/manhwa "volumes" as seasons/arcs while
    Kapowarr/ComicVine models English retail tankobon volumes as individual
    issues.  Solo Leveling is the canonical example: MangaDex says 3 volumes,
    Kapowarr has 15 Yen Press volumes.  Such mappings must not be used for
    Suwayomi matching.
    """
    if not volume_chapter_map or not volume_issues:
        return False

    issue_numbers = {
        i.calculated_issue_number
        for i in volume_issues
        if getattr(i, 'calculated_issue_number', None) is not None
        and i.calculated_issue_number > 0
    }
    if not issue_numbers:
        return False

    map_numbers = set(volume_chapter_map.keys())
    matching_numbers = issue_numbers.intersection(map_numbers)
    if not matching_numbers:
        return False

    # If MangaDex has far fewer volume buckets than Kapowarr issues, the two
    # sources are almost certainly describing different edition structures.
    if len(issue_numbers) >= 8 and len(map_numbers) < len(issue_numbers) * 0.5:
        return False

    # Very large per-volume chapter spans are also a webtoon/season signal, not
    # a retail tankobon mapping suitable for one Kapowarr issue.
    if any(
        len(chapters) > _MAX_MANGADEX_CHAPTERS_PER_VOLUME
        for chapters in volume_chapter_map.values()
    ):
        return False

    return True


def _mangadex_chapters_for_issue(
    volume_data: VolumeData,
    volume_issues: List,
    calculated_issue_number: float,
) -> Tuple[Optional[List[float]], bool]:
    """Return MangaDex chapter numbers for an issue and compatibility status.

    Returns (chapters, incompatible).  If MangaDex has a map but it is
    incompatible with Kapowarr's issue structure, incompatible=True tells the
    caller to block Suwayomi matches rather than falling back to weaker
    ComicVine description parsing.
    """
    found_incompatible_map = False
    for title in (volume_data.title, volume_data.alt_title):
        if not title:
            continue
        volume_chapter_map = get_mangadex_volume_chapter_map(title)
        if not volume_chapter_map:
            continue
        if not _mangadex_map_is_compatible(volume_chapter_map, volume_issues):
            found_incompatible_map = True
            LOGGER.info(
                'MangaDex aggregate rejected for %s: incompatible volume map',
                volume_data.title,
            )
            continue
        chapters = volume_chapter_map.get(calculated_issue_number)
        if chapters:
            return chapters, False
        LOGGER.info(
            'MangaDex map for %s has no entry for issue %.4g; '
            'falling back to description parsing',
            volume_data.title, calculated_issue_number,
        )
    return None, found_incompatible_map


def _is_individual_suwayomi_result(result: SearchResultData) -> bool:
    link = result.get('link', '')
    return link.startswith(SUWAYOMI_SCHEME) and ',' not in link


def _remove_individual_suwayomi_results(
    search_results: List[SearchResultData],
) -> List[SearchResultData]:
    """Remove individual chapter results so partial chapters cannot match."""
    return [r for r in search_results if not _is_individual_suwayomi_result(r)]


def _build_suwayomi_bundle_for_issue(
    search_results: List[SearchResultData],
    chapter_numbers: List[float],
    volume_data: VolumeData,
    calculated_issue_number: float,
    display_volume_number: Optional[int] = None,
) -> Optional[SearchResultData]:
    """Return a bundled suwayomi:M:c1,c2,... result for a manga issue.

    Scans single-chapter Suwayomi entries in search_results.  If one manga
    covers every number in chapter_numbers, returns a bundled result whose
    issue_number equals calculated_issue_number so it ranks as a direct match.
    Returns None if coverage is incomplete.

    display_volume_number overrides volume_data.volume_number in display_title
    only (use the tankobon/issue number for the label while keeping series
    volume metadata for matcher compatibility).
    """
    if not chapter_numbers:
        return None
    target = set(chapter_numbers)
    manga_chapters: Dict[int, Dict[float, int]] = {}
    manga_titles: Dict[int, str] = {}
    for result in search_results:
        link = result.get('link', '')
        if not link.startswith(SUWAYOMI_SCHEME):
            continue
        parts = link.split(':', 2)
        if len(parts) != 3 or ',' in parts[2]:
            continue
        try:
            manga_id = int(parts[1])
            ch_id = int(parts[2])
        except (ValueError, IndexError):
            continue
        ch_num = result.get('issue_number')
        if not isinstance(ch_num, float) or ch_num not in target:
            continue
        manga_chapters.setdefault(manga_id, {})[ch_num] = ch_id
        manga_titles.setdefault(manga_id, result.get('series', ''))
    for manga_id, num_to_id in manga_chapters.items():
        if not target.issubset(set(num_to_id.keys())):
            continue
        sorted_pairs = sorted(num_to_id.items(), key=lambda x: x[0])
        ch_ids = [cid for _, cid in sorted_pairs]
        ch_nums_sorted = [n for n, _ in sorted_pairs]
        manga_title = manga_titles.get(manga_id, '')
        display_vol = display_volume_number if display_volume_number is not None else volume_data.volume_number
        return {
            'link': make_suwayomi_volume_link(manga_id, ch_ids),
            'display_title': (
                f"{manga_title} - Vol. {display_vol} "
                f"(Ch. {ch_nums_sorted[0]:.4g}–{ch_nums_sorted[-1]:.4g})"
            ),
            'source': SUWAYOMI_SOURCE_NAME,
            'series': manga_title,
            'year': None,
            'volume_number': volume_data.volume_number,
            'special_version': None,
            'issue_number': calculated_issue_number,
            'annual': False,
        }
    return None


async def search_multiple_queries(
    *queries: str,
    volume_data: Optional[VolumeData] = None,
) -> List[SearchResultData]:
    """Do a manual search for multiple queries asynchronously.

    Returns:
        List[SearchResultData]: The search results for all queries together,
        duplicates removed.
    """
    async with AsyncSession() as session:
        searches = []
        for Source in get_subclasses(SearchSource):
            if volume_data is not None:
                probe = Source.__new__(Source)
                probe.query = ''
                if not probe.supports_volume(volume_data):
                    continue
            for query in queries:
                searches.append(Source(query).search(session))
        responses = await gather(*searches)

    search_results: List[SearchResultData] = []
    processed_links = set()
    for response in responses:
        for result in response:
            # Don't add if the link is already in the results
            # Avoids duplicates, as multiple formats can return the same result
            if result['link'] not in processed_links:
                search_results.append(result)
                processed_links.add(result['link'])

    return search_results


def manual_search(
    volume_id: int,
    issue_id: Union[int, None] = None
) -> List[MatchedSearchResultData]:
    """Do a manual search for a volume or issue.

    Args:
        volume_id (int): The id of the volume to search for.
        issue_id (Union[int, None], optional): The id of the issue to search for,
        in the case that you want to search for an issue instead of a volume.
            Defaults to None.

    Returns:
        List[MatchedSearchResultData]: List with search results.
    """
    volume = Volume(volume_id)
    volume_data = volume.get_data()
    volume_issues = volume.get_issues()
    number_to_year: Dict[float, Union[int, None]] = {
        i.calculated_issue_number: extract_year_from_date(i.date)
        for i in volume_issues
    }
    issue_number: Union[str, None] = None
    calculated_issue_number: Union[float, None] = None
    issue_data = None

    if issue_id and volume_data.special_version in (
        SpecialVersion.NORMAL,
        SpecialVersion.VOLUME_AS_ISSUE
    ):
        issue_data = volume.get_issue(issue_id).get_data()
        issue_number = issue_data.issue_number
        calculated_issue_number = issue_data.calculated_issue_number

    LOGGER.info(
        'Starting manual search: %s (%d) %s',
        volume_data.title, volume_data.year,
        f'#{issue_number}' if issue_number else ''
    )

    for title in (volume_data.title, volume_data.alt_title):
        if not title:
            continue

        if volume_data.special_version == SpecialVersion.TPB:
            formats = QUERY_FORMATS["TPB"]

        elif volume_data.special_version == SpecialVersion.VOLUME_AS_ISSUE:
            formats = QUERY_FORMATS["VAI"]

        elif issue_number is None:
            formats = QUERY_FORMATS["Volume"]

        else:
            formats = QUERY_FORMATS["Issue"]

        if volume_data.year is None:
            formats = tuple(
                f.replace('({year})', '').strip()
                for f in formats
            )

        search_title = normalise_query_string(title).replace(':', '')
        search_results = run(search_multiple_queries(
            *(
                format.format(
                    title=search_title, volume_number=volume_data.volume_number,
                    year=volume_data.year, issue_number=issue_number
                )
                for format in formats
            ),
            volume_data=volume_data,
        ))
        if not search_results:
            continue

        # Manga volume-level searches should not treat individual Suwayomi
        # chapters as complete Kapowarr issues.  Let auto_search fall through to
        # per-issue searches, where MangaDex/description ranges can build a
        # verified multi-chapter bundle or block Suwayomi entirely.
        from backend.implementations.suwayomi import is_manga_publisher
        if (
            issue_id is None
            and volume_data.special_version in (
                SpecialVersion.NORMAL,
                SpecialVersion.VOLUME_AS_ISSUE,
                SpecialVersion.TPB,
            )
            and is_manga_publisher(volume_data.publisher)
        ):
            search_results = _remove_individual_suwayomi_results(search_results)

        # For manga issue searches, inject a bundled Suwayomi result when a
        # trusted manga metadata source names the contained chapter range and
        # Suwayomi has individual chapters for all of them. MangaDex aggregate
        # metadata is primary because it exposes explicit volume/chapter maps
        # when queried with includeUnavailable=1. ComicVine description parsing
        # is only a fallback when MangaDex has no usable mapping at all.
        from backend.implementations.suwayomi import is_manga_publisher
        if (
            issue_id is not None
            and issue_data is not None
            and calculated_issue_number is not None
            and is_manga_publisher(volume_data.publisher)
        ):
            ch_nums, md_incompatible = _mangadex_chapters_for_issue(
                volume_data, volume_issues, calculated_issue_number
            )
            if ch_nums is None and not md_incompatible:
                ch_nums = _parse_chapter_range_from_description(
                    issue_data.description or ''
                )

            if md_incompatible:
                # MangaDex found the title but its volume map describes a
                # different edition structure (for example webtoon seasons vs.
                # English retail volumes).  In that case, block individual
                # Suwayomi chapters from matching the Kapowarr volume.
                search_results = _remove_individual_suwayomi_results(
                    search_results
                )
            else:
                bundle = _build_suwayomi_bundle_for_issue(
                    search_results, ch_nums or [], volume_data,
                    calculated_issue_number,
                    display_volume_number=int(calculated_issue_number),
                )
                if bundle is not None:
                    # Drop ALL individual Suwayomi chapter links (no comma in id
                    # portion) so only the verified bundle represents Suwayomi.
                    search_results = [bundle] + _remove_individual_suwayomi_results(
                        search_results
                    )
                elif ch_nums:
                    # We know the intended chapter range but cannot build the
                    # full bundle.  Do not allow a single matching chapter to be
                    # considered a successful volume match.
                    search_results = _remove_individual_suwayomi_results(
                        search_results
                    )

        results: List[MatchedSearchResultData] = [
            {
                **result,
                **check_search_result_match(
                    result, volume_data, volume_issues,
                    number_to_year, calculated_issue_number
                ),
            }
            for result in search_results
        ]

        # Sort results; put best result at top
        results.sort(key=lambda r: _rank_search_result(
            r, search_title, volume_data.volume_number,
            (
                volume_data.year,
                number_to_year.get(calculated_issue_number) # type: ignore
            ),
            calculated_issue_number
        ))

        LOGGER.debug('Manual search results: %s', [
            {**r, 'link': redact_url_for_log(r.get('link', ''))}
            for r in results
        ])
        return results

    return []


def _try_bundle_suwayomi_chapters(
    all_results: List,
    searchable_issues: List[Tuple[int, float]],
    volume_data: VolumeData,
) -> Union[MatchedSearchResultData, None]:
    """Try to bundle individual Suwayomi chapter results into one volume link.

    For each manga in the Suwayomi results, checks if its chapters cover all
    open (searchable) issues.  Returns a bundled MatchedSearchResultData on
    success, or None if no manga provides full coverage.
    """
    manga_groups: Dict[int, List[SearchResultData]] = {}
    for result in all_results:
        link = result.get('link', '')
        if not link.startswith(SUWAYOMI_SCHEME):
            continue
        try:
            manga_id, _ = parse_suwayomi_link(link)
        except Exception:
            continue
        manga_groups.setdefault(manga_id, []).append(result)

    if not manga_groups:
        return None

    searchable_numbers = {calc_num for _, calc_num in searchable_issues}

    for manga_id, results in manga_groups.items():
        chapter_numbers = {
            r['issue_number']
            for r in results
            if isinstance(r['issue_number'], float)
        }
        if not searchable_numbers.issubset(chapter_numbers):
            continue

        id_to_number: Dict[int, float] = {}
        for r in results:
            try:
                _, ch_id = parse_suwayomi_link(r['link'])
                num = r['issue_number']
                if isinstance(num, float) and num in searchable_numbers:
                    id_to_number[ch_id] = num
            except Exception:
                continue

        sorted_pairs = sorted(id_to_number.items(), key=lambda x: x[1])
        chapter_ids = [ch_id for ch_id, _ in sorted_pairs]
        numbers = [num for _, num in sorted_pairs]

        if not chapter_ids:
            continue

        manga_title = results[0]['series']
        return {
            'link': make_suwayomi_volume_link(manga_id, chapter_ids),
            'display_title': f"{manga_title} - Vol. {volume_data.volume_number}",
            'source': SUWAYOMI_SOURCE_NAME,
            'series': manga_title,
            'year': None,
            'volume_number': volume_data.volume_number,
            'special_version': SpecialVersion.TPB,
            'issue_number': (min(numbers), max(numbers)),
            'annual': False,
            'match': True,
            'match_issue': None,
        }

    return None


def auto_search(
    volume_id: int,
    issue_id: Union[int, None] = None,
    _stats: Union[dict, None] = None,
    _status_cb=None
) -> List[MatchedSearchResultData]:
    """Search for a volume or issue and automatically choose a result.

    Args:
        volume_id (int): The ID of the volume to search for.
        issue_id (Union[int, None], optional): The id of the issue to search for,
        in the case that you want to search for an issue instead of a volume.
            Defaults to None.
        _stats (Union[dict, None], optional): Dict populated with search stats
        (key 'total_found'). Used by callers to emit informative status messages.
        _status_cb (optional): Callable(idx, total) called before each per-issue
        fallback search so callers can emit progress notifications.

    Returns:
        List[MatchedSearchResultData]: List with chosen search results.
    """
    volume = Volume(volume_id)
    volume_data = volume.get_data()
    volume_issues = volume.get_issues(_skip_files=True)
    volume_issues.sort(key=lambda i: i.calculated_issue_number)
    LOGGER.info(
        'Starting auto search for volume %d %s',
        volume_id,
        f'issue {issue_id}' if issue_id else ''
    )

    searchable_issues: List[Tuple[int, float]] = []
    if not volume_data.monitored:
        # Volume is unmonitored so don't auto search
        pass

    elif issue_id is None:
        # Auto search volume
        # Get open issues (monitored and no file).
        searchable_issues = volume.get_open_issues()

    else:
        # Auto search issue
        issue = volume.get_issue(issue_id)
        issue_data = issue.get_data()
        if issue_data.monitored and not issue.get_files():
            # Issue is open
            searchable_issues = [(issue_id, issue_data.calculated_issue_number)]

    if not searchable_issues:
        # No issues to search for
        LOGGER.debug('Auto search results: []')
        return []

    all_results = manual_search(volume_id, issue_id)
    search_results = [r for r in all_results if r['match']]
    if _stats is not None:
        _stats['total_found'] = _stats.get('total_found', 0) + len(all_results)
        if issue_id is not None and 'per_issue' in _stats:
            chosen = (
                _sort_by_source_priority(search_results, volume_data)[0]
                if search_results else None
            )
            try:
                from backend.implementations.naming import generate_issue_name
                filename = generate_issue_name(
                    volume_data, issue_data.calculated_issue_number
                )
            except Exception:
                filename = ''
            _stats['per_issue'].append({
                'issue_number': issue_data.issue_number,
                'results_found': len(all_results),
                'matched': chosen is not None,
                'display_title': chosen.get('display_title', '') if chosen else '',
                'source': chosen.get('source', '') if chosen else '',
                'filename': filename,
            })

    if issue_id is not None or volume_data.special_version not in (
        SpecialVersion.NORMAL,
        SpecialVersion.VOLUME_AS_ISSUE
    ):
        # We're searching for one "item", so choose the highest-priority
        # configured source with a matching result.  If Suwayomi is allowed and
        # no matched Suwayomi result exists yet, try to build a bundle before
        # applying priority so manga can prefer Suwayomi volume PDFs.
        candidates = list(search_results)
        priority = _source_priority_for_volume(volume_data)

        if issue_id is None and 'suwayomi' in priority:
            bundle = _try_bundle_suwayomi_chapters(
                all_results, searchable_issues, volume_data
            )
            if bundle:
                LOGGER.debug(
                    'Auto search: Suwayomi chapter bundle for volume %d',
                    volume_id,
                )
                candidates = [bundle] + [
                    r for r in candidates
                    if _search_result_source_id(r) != 'suwayomi'
                ]

        result = _sort_by_source_priority(candidates, volume_data)[:1]
        LOGGER.debug('Auto search results: %s', [
            {**r, 'link': redact_url_for_log(r.get('link', ''))}
            for r in result
        ])
        return result

    # We're searching for a volume, so we might download multiple search results.
    # Find a combination of search results that download the most issues.
    chosen_downloads: List[MatchedSearchResultData] = []
    searchable_issue_numbers = {i[1] for i in searchable_issues}
    for result in _sort_by_source_priority(search_results, volume_data):
        result = refine_special_version(volume_data, result)

        # Determine what issues the result covers
        if result["special_version"]:
            result["issue_number"] = 1.0
            covered_issues = volume_issues

        elif result["issue_number"] is not None:
            if isinstance(result["issue_number"], tuple):
                n_start, n_end = result["issue_number"]
            else:
                n_start, n_end = force_range(result["issue_number"])

            covered_issues = [
                issue
                for issue in volume_issues
                if n_start <= issue.calculated_issue_number <= n_end
            ]

        else:
            continue

        if any(
            i.calculated_issue_number not in searchable_issue_numbers
            for i in covered_issues
        ):
            # Part or all of what the result covers is already downloaded
            continue

        # Check that any other selected download doesn't already cover the issue
        for part in chosen_downloads:
            if check_overlapping_issues(
                part["issue_number"], # type: ignore
                result["issue_number"]
            ):
                break
        else:
            chosen_downloads.append(result)

    # Find issues that have still not been covered. Might've been that the
    # download for the issue simply did not pop up on volume search, but will
    # when searching for the individual issue.
    missing_issues = [
        i
        for i in searchable_issues
        if not any(
            check_overlapping_issues(
                i[1], part["issue_number"] # type: ignore
            )
            for part in chosen_downloads
        )
    ]

    # Short-circuit: if the volume-level search already returned a broad/max
    # result set with zero matches, individual issue queries against the same
    # sources will very likely return equally irrelevant results.  Skip them
    # to avoid hammering sources for hundreds of issues with no gain.
    if (
        missing_issues
        and not chosen_downloads
        and len(all_results) >= Settings().sv.auto_search_broad_result_threshold
    ):
        LOGGER.info(
            'Auto search: skipping %d per-issue fallback(s) for volume %d '
            '(%d broad results, 0 matched)',
            len(missing_issues), volume_id, len(all_results),
        )
        LOGGER.debug('Auto search results: %s', chosen_downloads)
        return chosen_downloads

    for idx, missing_issue in enumerate(missing_issues):
        if _status_cb is not None:
            _status_cb(idx, len(missing_issues))
        chosen_downloads.extend(auto_search(volume_id, missing_issue[0], _stats))

    LOGGER.debug('Auto search results: %s', [
        {**r, 'link': redact_url_for_log(r.get('link', ''))}
        for r in chosen_downloads
    ])
    return chosen_downloads
