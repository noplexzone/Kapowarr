# -*- coding: utf-8 -*-

from asyncio import gather, get_running_loop, run
from re import IGNORECASE, sub
from typing import Dict, List, Tuple, Union

from backend.base.definitions import (QUERY_FORMATS, DownloadSource,
                                      MatchedSearchResultData, SearchResultData,
                                      SearchSource, SpecialVersion)
from backend.base.file_extraction import refine_special_version
from backend.base.helpers import (AsyncSession, check_overlapping_issues,
                                  extract_year_from_date, force_range,
                                  get_subclasses, normalise_query_string,
                                  redact_url_for_log)
from backend.base.logging import LOGGER
from backend.implementations.getcomics import search_getcomics
from backend.implementations.matching import check_search_result_match
from backend.implementations.nzb_indexers import NZBIndexers
from backend.implementations.suwayomi import (SUWAYOMI_SOURCE_NAME,
                                              SuwayomiClient,
                                              make_suwayomi_link)
from backend.implementations.volumes import Volume


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


# If a volume-level search returns at least this many results with zero matches,
# skip per-issue fallbacks: the source is returning max/broad results for this
# series title and per-issue queries will produce equally irrelevant hits.
_BROAD_RESULT_SKIP_THRESHOLD = 50


def _extract_series_title(query: str) -> str:
    """Strip issue/volume/year suffixes from a search query to get the title."""
    # Remove "(year)", "#N", "Vol. N", "Volume N"
    title = sub(r'\s*\(\d{4}\)', '', query)
    title = sub(r'\s+#[\d.]+.*$', '', title, flags=IGNORECASE)
    title = sub(r'\s+Vol(?:ume)?\.?\s*\d+.*$', '', title, flags=IGNORECASE)
    return title.strip()


async def search_multiple_queries(*queries: str) -> List[SearchResultData]:
    """Do a manual search for multiple queries asynchronously.

    Returns:
        List[SearchResultData]: The search results for all queries together,
        duplicates removed.
    """
    async with AsyncSession() as session:
        searches = [
            Source(query).search(session)
            for Source in get_subclasses(SearchSource)
            for query in queries
        ]
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
        search_results = run(search_multiple_queries(*(
            format.format(
                title=search_title, volume_number=volume_data.volume_number,
                year=volume_data.year, issue_number=issue_number
            )
            for format in formats
        )))
        if not search_results:
            continue

        results: List[MatchedSearchResultData] = [
            {
                **result,
                **check_search_result_match(
                    result, volume_data, volume_issues,
                    number_to_year, calculated_issue_number
                )
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
            chosen = search_results[0] if search_results else None
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
        # We're searching for one "item", so just grab first search result.
        result = search_results[:1] if search_results else []
        LOGGER.debug('Auto search results: %s', [
            {**r, 'link': redact_url_for_log(r.get('link', ''))}
            for r in result
        ])
        return result

    # We're searching for a volume, so we might download multiple search results.
    # Find a combination of search results that download the most issues.
    chosen_downloads: List[MatchedSearchResultData] = []
    searchable_issue_numbers = {i[1] for i in searchable_issues}
    for result in search_results:
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
        and len(all_results) >= _BROAD_RESULT_SKIP_THRESHOLD
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
