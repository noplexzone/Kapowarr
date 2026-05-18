# -*- coding: utf-8 -*-

"""
Search for volumes/issues and fetch metadata for them on ComicVine
"""

from asyncio import gather, run, sleep
from json import JSONDecodeError
from re import IGNORECASE, compile
from typing import Any, AsyncGenerator, Dict, Iterable, List, Sequence, Union

from aiohttp import ContentTypeError
from aiohttp.client_exceptions import ClientError
from bs4 import BeautifulSoup, Tag

from backend.base.custom_exceptions import (CVRateLimitReached,
                                            InvalidComicVineApiKey,
                                            VolumeNotMatched)
from backend.base.definitions import (Constants, FilenameData,
                                      IssueMetadata, T, VolumeMetadata)
from backend.base.file_extraction import (extract_issue_number,
                                          extract_volume_number, volume_regex)
from backend.base.helpers import (AsyncSession, Session, batched,
                                  first_of_range, force_range, force_suffix,
                                  normalise_string, normalise_year,
                                  to_full_string_cv_id, to_string_cv_id)
from backend.base.logging import LOGGER
from backend.implementations.matching import select_best_volume_result_for_file
from backend.internals.db import get_db
from backend.internals.settings import Settings

_NON_ENGLISH_PUBLISHERS = frozenset({
    # Japanese publishers
    'shogakukan', 'akita shoten', 'akita publishing', 'square enix',
    'media factory', 'kodansha', 'kodansha comics', 'kodansha usa',
    'kodansha comics usa', 'shueisha', 'hakusensha', 'kadokawa',
    'kadokawa shoten', 'mag garden', 'futabasha', 'futabasha comics',
    'coamix', 'ascii media works', 'core magazine', 'coremagazine',
    'nihon bungeisha', 'takeshobo', 'wani books', 'wani magazine',
    'flex comix', 'ichijinsha', 'libre publishing',
    'ohzora publishing', 'shinshkan', 'tokuma shoten', 'houbunsha',
    'earth star entertainment', 'enterbrain', 'micro magazine',
    'leed publishing', 'east press', 'shonengahosha', 'shonen gahosha',
    'bamboo comics', 'square enix manga', 'jump comics', 'shueisha jump',
    'champion red', 'sunday comics', 'big comics', 'evening', 'morning',
    'afternoon', 'young animal', 'weekly shonen', 'shonen sunday',
    'shonen magazine',
    # English-language manga publishers / imprints
    'viz media', 'viz', 'tokyopop', 'yen press', 'seven seas entertainment',
    'vertical', 'vertical comics', 'udon entertainment',
    'digital manga publishing', 'gen manga', 'aurora publishing',
    # French/European manga publishers
    'pika edition', 'pika', 'taifu comics', 'ki-oon', 'kana',
    'kurokawa', 'tonkam', 'delcourt tonkam', 'glenat manga',
    'soleil manga', 'kazé', 'kaze', 'panini manga', 'crunchyroll',
    'crunchyroll manga', 'noeve grafx', 'akata', 'meian',
    # French / Belgian publishers (bande dessinée)
    'dupuis', 'le lombard', 'lombard', 'dargaud', 'glenat',
    'editions glenat', 'casterman', 'humanoides associes',
    'les humanoides associes', 'fluide glacial', 'soleil', 'delcourt',
    'ankama', 'bamboo edition', 'glénat', 'editions du lombard',
    'kaka', 'kaka editions',
    # Dutch publishers
    'uitgeverij l', 'don lawrence collection',
    # German / Scandinavian publishers
    'carlsen comics', 'carlsen', 'egmont', 'ehapa',
    # Spanish / Latin American publishers
    'planeta comics', 'norma editorial', 'ivrea',
    # Italian publishers
    'star comics', 'sergio bonelli editore', 'bonelli editore',
    'panini italia', 'panini comics italy',
})

_NON_ENGLISH_TITLE_KEYWORDS = frozenset({
    'manga action', 'young king', 'weekly shonen', 'shonen jump',
    'weekly jump', 'young jump', 'big comic', 'shonen sunday',
    'shonen magazine', 'weekly playboy', 'young magazine',
    'sho-comi', 'hana to yume', 'sunday comics', 'morning comics',
    'afternoon comics', 'evening comics', 'young animal',
    # Adult manga anthology magazines — publisher lookup can silently fail for
    # these on CV, so title keywords act as a second filter layer.
    'hotmilk', 'bavel', 'comic exe', 'comic x-eros', 'comic kairakuten',
    'megastore', 'comic megastore', 'comic unreal', 'comic anthurium',
    'comic tenma', 'comic mujin', 'comic europa', 'comic penguin',
    'comic lo', 'comic potpourri', 'girls forM', 'comic kuribayashi',
    'e★everystar', 'e*everystar', 'comic valkyrie',
})
_MANGA_TITLE_KEYWORDS = _NON_ENGLISH_TITLE_KEYWORDS

translation_regex = compile(
    r'^<p>\s*\w+(?<!English) publication(\.?</p>$|,\s| \(in the \w+(?<!English) language\)|, translates )|' +
    r'^<p>\s*published by the \w+(?<!English) wing of|' +
    r'^<p>\s*\w+(?<!English) translations? of|' +
    r'.*from \w+(?<!English)\.?</p>$|' +
    r'^<p>\s*publishes in \w+(?<!English)|' +
    r'^<p>\s*\w+(?<!English) language|' +
    r'^<p>\s*\w+(?<!English) edition of|' +
    r'^<p>\s*\w+(?<!English) reprint of|' +
    r'^<p>\s*\w+(?<!English) trade collection of|' +
    r'^<p>\s*Series of \w+(?<!English) collections\.?</p>$|' +
    r'.*reprints\.?</p>$',
    IGNORECASE)
headers = {'h2', 'h3', 'h4', 'h5', 'h6'}
lists = {'ul', 'ol'}


def _clean_description(description: str, short: bool = False) -> str:
    """Reduce the size of the volume/issue description (written in html) to only
    essential information. Removes images, lists (e.g. of authors), and fixes
    links that have a relative URL.

    Args:
        description (str): The description to clean.
        short (bool, optional): Only remove images and fix links.
            Defaults to False.

    Returns:
        str: The cleaned description.
    """
    if not description:
        return description

    soup = BeautifulSoup(description, 'html.parser')

    # Remove images
    for el in soup.find_all(["figure", "img"]):
        el.decompose()

    # Remove practically empty paragraphs
    for el in soup.find_all(["p"]):
        if not el.text.lstrip('.').strip():
            el.decompose()

    if not short:
        # Remove everything after the first title with list
        removed_elements = []
        for el in soup:
            if not isinstance(el, Tag):
                continue

            elif el.name is None:
                continue

            elif (
                removed_elements
                or el.name in headers
            ):
                removed_elements.append(el)

            elif el.name in lists:
                removed_elements.append(el)
                prev_sib = el.previous_sibling
                if (
                    prev_sib is not None
                    and prev_sib.text.endswith(':')
                ):
                    removed_elements.append(prev_sib)

            elif el.name == 'p':
                children = list(getattr(el, 'children', []))
                if (
                    1 <= len(children) <= 2
                    and children[0].name in ('b', 'i', 'strong')
                ):
                    removed_elements.append(el)

        for el in removed_elements:
            if isinstance(el, Tag):
                el.decompose()

    # Fix links
    for link in soup.find_all('a'):
        link: Tag
        link.attrs = {
            k: v
            for k, v in link.attrs.items()
            if not k.startswith('data-')
        }
        link['target'] = '_blank'
        href: str = first_of_range(link.attrs.get('href', ''))
        href = href.lstrip('.').lstrip('/')
        link['href'] = href
        if href and not href.startswith('http'):
            link['href'] = (
                Constants.CV_SITE_URL + '/' + href
            )

    result = str(soup)
    return result


class ComicVine:
    volume_field_list = ','.join((
        'aliases',
        'count_of_issues',
        'date_added',
        'deck',
        'description',
        'id',
        'image',
        'issues',
        'name',
        'publisher',
        'site_detail_url',
        'start_year'
    ))
    story_arc_field_list = ','.join((
        'count_of_issues',
        'deck',
        'description',
        'id',
        'image',
        'name',
        'publisher',
        'site_detail_url',
    ))
    issue_field_list = ','.join((
        'id',
        'issue_number',
        'name',
        'cover_date',
        'store_date',
        'description',
        'volume'
    ))
    search_field_list = ','.join((
        'aliases',
        'count_of_issues',
        'deck',
        'description',
        'id',
        'image',
        'name',
        'publisher',
        'site_detail_url',
        'start_year'
    ))

    def __init__(self, comicvine_api_key: Union[str, None] = None) -> None:
        """Start interacting with ComicVine.

        Args:
            comicvine_api_key (Union[str, None], optional): Instead of using the
                CV API key set in the settings, use the supplied one.
                Defaults to None.

        Raises:
            InvalidComicVineApiKey: No ComicVine API key is set in the settings
                and no key is given.
        """
        settings = Settings().get_settings()

        self.date_type = settings.date_type.value
        api_key = comicvine_api_key or settings.comicvine_api_key
        if not api_key:
            raise InvalidComicVineApiKey

        self.ssn = Session()
        self._params = {'format': 'json', 'api_key': api_key}
        self.ssn.params.update(self._params) # type: ignore
        return

    async def __call_api(
        self,
        session: AsyncSession,
        url_path: str,
        params: Dict[str, Any] = {},
        default: Union[T, None] = None
    ) -> Union[Dict[str, Any], T]:
        """Make an API call asynchronously (with error handling).

        Args:
            session (AsyncSession): The session to make the request with.

            url_path (str): The API endpoint to make the call to.
                For example: '/volumes'.

            params (Dict[str, Any], optional): The URL parameters that should go
                with the request. The standard parameters (api_key and format)
                are already included.
                Defaults to {}.

            default (Union[T, None], optional): Return given value in case of
                exception, instead of raising exception.
                Defaults to None.

        Raises:
            CVRateLimitReached: The rate limit for this endpoint has been
                reached, and no `default` was supplied.
            InvalidComicVineApiKey: The API key is not valid.
            VolumeNotMatched: The ID doesn't map to any volume.

        Returns:
            Union[Dict[str, Any], T]: The raw API response or the value of
                `default` on error.
        """
        url_path = force_suffix('/' + url_path.lstrip('/'), '/')

        try:
            response = await session.get(
                Constants.CV_API_URL + url_path,
                params={**self._params, **params}
            )
            result: Dict[str, Any] = await response.json()

            if result['status_code'] == 107:
                raise CVRateLimitReached
            elif result['status_code'] == 101:
                raise VolumeNotMatched
            elif result['status_code'] == 100:
                raise InvalidComicVineApiKey

            return result

        except CVRateLimitReached:
            raise
        except (ClientError, ContentTypeError, JSONDecodeError):
            if default is not None:
                return default
            raise CVRateLimitReached

    def __format_volume_output(
        self,
        volume_data: Dict[str, Any]
    ) -> VolumeMetadata:
        """Format the API output containing the metadata of a volume.

        Args:
            volume_data (Dict[str, Any]): The API output.

        Returns:
            VolumeMetadata: The formatted data.
        """
        # Determine volume number
        volume_result = volume_regex.search(volume_data['deck'] or '')
        if volume_result:
            volume_number = force_range(extract_volume_number(
                volume_result.group(1)
            ))[0]
            if volume_number is None:
                volume_number = 1
        else:
            volume_number = 1

        # Determine description
        description = _clean_description(volume_data['description'])

        # Determine translation value
        translated = translation_regex.match(
            description or ''
        ) is not None

        result: VolumeMetadata = {
            'comicvine_id': int(volume_data['id']),
            'title': normalise_string(volume_data['name'] or ''),
            'year': normalise_year(volume_data.get('start_year', '')),
            'volume_number': volume_number,
            'cover_link': volume_data['image']['small_url'],
            'cover': None,
            'description': description,
            'site_url': volume_data['site_detail_url'],

            'aliases': [
                a.strip()
                for a in (volume_data.get('aliases') or '').split('\r\n')
                if a
            ],

            'publisher': (
                volume_data.get('publisher') or {}
            ).get('name'),

            'issue_count': int(volume_data['count_of_issues']),

            'translated': translated,
            'already_added': None,
            'issues': None,
            'date_added': (volume_data.get('date_added') or '')[:10] or None
        }

        return result

    def __format_issue_output(
        self,
        issue_data: Dict[str, Any]
    ) -> IssueMetadata:
        """Format the API output containing the metadata of the issue.

        Args:
            issue_data (Dict[str, Any]): The API output.

        Returns:
            IssueMetadata: The formatted data.
        """
        calculated_issue_number = force_range(extract_issue_number(
            issue_data['issue_number']
        ))[0]
        if calculated_issue_number is None:
            calculated_issue_number = 0.0

        result: IssueMetadata = {
            'comicvine_id': int(issue_data['id']),
            'volume_id': int(issue_data['volume']['id']),
            'issue_number': issue_data['issue_number'].replace('/', '-').strip(),
            'calculated_issue_number': calculated_issue_number,
            'title': normalise_string(issue_data['name'] or '') or None,
            'date': issue_data[self.date_type] or None,
            'description': _clean_description(
                issue_data['description'],
                short=True
            )
        }

        return result

    def __format_search_output(
        self,
        search_results: List[Dict[str, Any]]
    ) -> List[VolumeMetadata]:
        """Format the API output containing volume search results.

        Args:
            search_results (List[Dict[str, Any]]): The API output.

        Returns:
            List[VolumeMetadata]: The formatted data.
        """
        cursor = get_db()

        formatted_results = [
            self.__format_volume_output(r)
            for r in search_results
        ]

        # Mark entries that are already added
        volume_ids: Dict[int, int] = dict(cursor.execute(f"""
            SELECT comicvine_id, id
            FROM volumes
            WHERE comicvine_id IN ({','.join('?' for _ in formatted_results)})
            LIMIT 50;
            """,
            tuple(r["comicvine_id"] for r in formatted_results)
        ))

        for r in formatted_results:
            r['already_added'] = volume_ids.get(r["comicvine_id"])

        LOGGER.debug(
            'Searching for volumes with query result: %s',
            formatted_results
        )
        return formatted_results

    async def __sleep_iter(
        self,
        iterable: Iterable[T],
        batch_size: int
    ) -> AsyncGenerator[T, None]:
        """Iterate over the given iterable, but sleep in between. The duration
        is based on how large the batch is that each iteration is yielded. Acts
        as a cooldown between batches of requests to the API.

        Args:
            iterable (Iterable[T]): The batches to iterate over and yield.
            batch_size (int): The size of each batch.

        Yields:
            AsyncGenerator[T, None]: The batch, with a sleep done before if
                required.
        """
        batch_brake_time = Constants.CV_BRAKE_TIME * batch_size
        for index, batch in enumerate(iterable):
            if index:
                LOGGER.debug(
                    "Waiting %ss to keep the CV rate limit happy",
                    batch_brake_time
                )
                await sleep(batch_brake_time)

            yield batch
        return

    def test_key(self) -> bool:
        """Test if the API key works.

        Returns:
            bool: Whether the key works.
        """
        async def _test_key():
            try:
                async with AsyncSession() as session:
                    # Simply make a call to any endpoint to check. This endpoint
                    # isn't used by Kapowarr so by using it now we don't
                    # unnecessarily get closer to the rate limit of
                    # important endpoints.
                    await self.__call_api(
                        session,
                        '/publisher/4010-31',
                        {'field_list': 'id'}
                    )

            except (CVRateLimitReached, InvalidComicVineApiKey):
                return False

            return True

        return run(_test_key())

    async def fetch_volume(self, cv_id: Union[str, int]) -> VolumeMetadata:
        """Get the metadata of a volume, including its issues.

        Args:
            cv_id (Union[str, int]): The CV ID of the volume.

        Raises:
            VolumeNotMatched: The ID doesn't map to any volume.
            CVRateLimitReached: The ComicVine rate limit is reached.
            InvalidComicVineApiKey: The API key is not valid.

        Returns:
            VolumeMetadata: The metadata of the volume, including issues.
        """
        try:
            cv_id = to_full_string_cv_id((cv_id,))[0]
        except ValueError:
            raise VolumeNotMatched

        LOGGER.debug(f'Fetching volume data for {cv_id}')

        async with AsyncSession() as session:
            result = await self.__call_api(
                session,
                f'/volume/{cv_id}',
                {'field_list': self.volume_field_list}
            )

            volume_info = self.__format_volume_output(result['results'])
            volume_info['issues'] = await self.fetch_issues((cv_id,))

            LOGGER.debug('Fetching volume data result: %s', volume_info)

            volume_info['cover'] = await session.get_content(
                volume_info['cover_link'],
                quiet_fail=True
            ) or None

            return volume_info

    async def fetch_volumes(
        self,
        cv_ids: Sequence[Union[str, int]]
    ) -> List[VolumeMetadata]:
        """Get the metadata of the volumes, without their issues.

        Args:
            cv_ids (Sequence[Union[str, int]]): The CV IDs of the volumes.

        Raises:
            VolumeNotMatched: An ID doesn't map to any volume.
            InvalidComicVineApiKey: The API key is not valid.

        Returns:
            List[VolumeMetadata]: The metadata of the volumes, without issues.
                The list of volumes could be incomplete if the rate limit was
                reached.
        """
        try:
            formatted_cv_ids = to_string_cv_id(cv_ids)
        except ValueError:
            raise VolumeNotMatched

        LOGGER.debug(f'Fetching volume data for {formatted_cv_ids}')

        # Each request to CV can return 100 volumes. Make 10 requests at the
        # same time (one batch). Wait/cooldown in between batches. Spending time
        # fetching covers immediately after each batch increases cooldown.
        volume_infos = []
        async with AsyncSession() as session:
            async for request_batch in self.__sleep_iter(
                batched(formatted_cv_ids, 1000), 10
            ):
                tasks = (
                    self.__call_api(
                        session,
                        '/volumes',
                        {
                            'field_list': self.volume_field_list,
                            'filter': f'id:{"|".join(id_batch)}'
                        },
                        {'results': []}
                    )
                    for id_batch in batched(request_batch, 100)
                )
                responses = await gather(*tasks)

                # Format volume responses and prep cover requests
                batch_volumes: List[VolumeMetadata] = [
                    self.__format_volume_output(result)
                    for batch in responses
                    for result in batch['results']
                ]
                cover_map: Dict[int, Any] = {
                    volume['comicvine_id']: session.get_content(
                        volume['cover_link'],
                        quiet_fail=True
                    )
                    for volume in batch_volumes
                }

                # Fetch covers and add them to the volume info
                cover_responses = dict(zip(
                    cover_map.keys(),
                    await gather(*cover_map.values())
                ))
                for volume in batch_volumes:
                    volume['cover'] = cover_responses.get(
                        volume['comicvine_id']
                    ) or None

                volume_infos.extend(batch_volumes)

            return volume_infos

    async def fetch_issues(
        self,
        cv_ids: Sequence[Union[str, int]]
    ) -> List[IssueMetadata]:
        """Get the metadata of the issues of volumes.

        Args:
            cv_ids (Sequence[Union[str, int]]): The CV IDs of the volumes.

        Raises:
            VolumeNotMatched: An ID doesn't map to any volume.
            InvalidComicVineApiKey: The API key is not valid.

        Returns:
            List[IssueMetadata]: The metadata of all the issues inside the
                volumes. The list of issues could be incomplete if the rate
                limit was reached.
        """
        try:
            formatted_cv_ids = to_string_cv_id(cv_ids)
        except ValueError:
            raise VolumeNotMatched

        LOGGER.debug(f'Fetching issue data for volumes {formatted_cv_ids}')

        issue_infos = []
        async with AsyncSession() as session:
            for id_batch in batched(formatted_cv_ids, 50):
                batch_filter = "|".join(id_batch)
                try:
                    results = await self.__call_api(
                        session,
                        '/issues',
                        {
                            'field_list': self.issue_field_list,
                            'filter': f'volume:{batch_filter}'
                        }
                    )

                except CVRateLimitReached:
                    break

                issue_infos.extend((
                    self.__format_issue_output(r)
                    for r in results['results']
                ))

                if results['number_of_total_results'] > 100:

                    async for offset_batch in self.__sleep_iter(batched(
                        range(100, results['number_of_total_results'], 100), 10
                    ), 10):

                        tasks = (
                            self.__call_api(
                                session,
                                '/issues',
                                {
                                    'field_list': self.issue_field_list,
                                    'filter': f'volume:{batch_filter}',
                                    'offset': offset
                                },
                                {'results': []}
                            )
                            for offset in offset_batch
                        )
                        responses = await gather(*tasks)

                        for batch in responses:
                            issue_infos.extend((
                                self.__format_issue_output(r)
                                for r in batch['results']
                            ))

            return issue_infos

    async def fetch_volume_ids_for_issues(
        self,
        issue_ids: Sequence[int]
    ) -> Dict[int, int]:
        """Resolve issue IDs to their parent volume IDs via the CV API.

        Args:
            issue_ids: List of ComicVine issue IDs (the 4000-XXXXX kind).

        Returns:
            Dict[int, int]: Mapping of {issue_id: volume_id}.
                Entries where the CV API returned no data are omitted.
        """
        result: Dict[int, int] = {}
        async with AsyncSession() as session:
            for id_batch in batched(issue_ids, 100):
                filter_str = '|'.join(str(i) for i in id_batch)
                try:
                    data = await self.__call_api(
                        session,
                        '/issues',
                        {'field_list': 'id,volume', 'filter': f'id:{filter_str}'},
                        {'results': []}
                    )
                    for item in data['results']:
                        result[int(item['id'])] = int(item['volume']['id'])
                except CVRateLimitReached:
                    LOGGER.warning(
                        'Rate limit hit while resolving issue IDs to volumes'
                    )
                    break
        return result

    async def get_upcoming_releases(
        self,
        days: int = 60
    ) -> List[Dict[str, Any]]:
        """Get comic issues releasing in the next N days.

        Args:
            days: How many days ahead to look. Defaults to 60.

        Returns:
            List of dicts with keys: issue_id, issue_number, title,
            cover_date, cover_link, site_url, volume_id, volume_title,
            already_added (library volume id or None).
        """
        from datetime import date, timedelta
        today = date.today()
        end = today + timedelta(days=days)

        issue_params = {
            'field_list': 'id,name,issue_number,cover_date,image,site_detail_url,volume',
            'filter': f'cover_date:{today}|{end}',
            'sort': 'cover_date:asc',
            'limit': 100,
        }
        async with AsyncSession() as session:
            issue_pages = await gather(
                self.__call_api(session, '/issues', {**issue_params, 'offset': 0},   {'results': []}),
                self.__call_api(session, '/issues', {**issue_params, 'offset': 100}, {'results': []}),
                self.__call_api(session, '/issues', {**issue_params, 'offset': 200}, {'results': []}),
                self.__call_api(session, '/issues', {**issue_params, 'offset': 300}, {'results': []}),
                self.__call_api(session, '/issues', {**issue_params, 'offset': 400}, {'results': []}),
            )
            results = [r for page in issue_pages for r in (page.get('results') or [])]

            def _has_non_ascii(s: str) -> bool:
                return any(ord(c) > 127 for c in s)

            # Pre-filter using data already present in the issue stubs —
            # no extra API call needed for these checks.
            results = [
                r for r in results
                if not _has_non_ascii((r.get('volume') or {}).get('name') or '')
                and not _has_non_ascii(r.get('name') or '')
                and not any(
                    k in ((r.get('volume') or {}).get('name') or '').lower()
                    for k in _MANGA_TITLE_KEYWORDS
                )
            ]

            # Batch-fetch publisher for every unique volume (all batches run
            # concurrently). The original code only checked the first 100
            # volume IDs, leaving the rest unfiltered.
            unique_vol_ids = list({
                str(r['volume']['id'])
                for r in results
                if (r.get('volume') or {}).get('id')
            })
            non_english_vol_ids: set = set()
            if unique_vol_ids:
                vol_tasks = [
                    self.__call_api(
                        session, '/volumes',
                        {
                            'field_list': 'id,publisher',
                            'filter': f'id:{"|".join(unique_vol_ids[i:i + 100])}',
                            'limit': 100,
                        },
                        {'results': []}
                    )
                    for i in range(0, len(unique_vol_ids), 100)
                ]
                vol_pages = await gather(*vol_tasks)
                for vol_page in vol_pages:
                    for v in (vol_page.get('results') or []):
                        pub = ((v.get('publisher') or {}).get('name') or '').lower()
                        if (pub in _NON_ENGLISH_PUBLISHERS
                                or any(p in pub for p in _NON_ENGLISH_PUBLISHERS)):
                            non_english_vol_ids.add(int(v['id']))

        vol_ids_int = tuple(
            int(r['volume']['id'])
            for r in results
            if (r.get('volume') or {}).get('id')
        )
        already_added: Dict[int, int] = {}
        if vol_ids_int:
            placeholders = ','.join('?' * len(vol_ids_int))
            already_added = dict(get_db().execute(
                f'SELECT comicvine_id, id FROM volumes '
                f'WHERE comicvine_id IN ({placeholders})',
                vol_ids_int
            ).fetchall())

        upcoming = []
        for item in results:
            vol = item.get('volume') or {}
            vol_cv_id = int(vol['id']) if vol.get('id') else None
            if vol_cv_id and vol_cv_id in non_english_vol_ids:
                continue
            upcoming.append({
                'issue_id':     int(item['id']),
                'issue_number': item.get('issue_number') or '',
                'title':        item.get('name') or '',
                'cover_date':   item.get('cover_date') or '',
                'cover_link':   (item.get('image') or {}).get('small_url', ''),
                'site_url':     item.get('site_detail_url') or '',
                'volume_id':    vol_cv_id,
                'volume_title': vol.get('name') or '',
                'already_added': already_added.get(vol_cv_id) if vol_cv_id else None,
            })
        return upcoming

    async def get_new_volumes(
        self,
        limit: int = 100
    ) -> List[VolumeMetadata]:
        """Get volumes sorted by publish date (start year), newest first.

        CV's API silently sorts NULL start_year entries first on a desc sort,
        and its integer filter syntax does not support range queries. We fetch
        100 results and discard entries outside the recent window in Python.

        Args:
            limit: Maximum results to return. Defaults to 20.

        Returns:
            List of VolumeMetadata dicts with already_added populated.
        """
        # date_added:desc avoids the NULL-first ordering that start_year:desc has.
        # We fetch 400 candidates (4 pages) so that after filtering out the heavy
        # manga/non-English content we still have at least `limit` results.
        from datetime import date as _date
        cutoff = _date.today().year - 3          # 2023+ = "new"
        params = {
            'field_list': self.volume_field_list,
            'sort': 'date_added:desc',
            'limit': 100,
        }
        async with AsyncSession() as session:
            page1, page2, page3, page4, page5 = await gather(
                self.__call_api(session, '/volumes', {**params, 'offset': 0},   {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 100}, {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 200}, {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 300}, {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 400}, {'results': []}),
            )
        all_results = (
            (page1.get('results') or [])
            + (page2.get('results') or [])
            + (page3.get('results') or [])
            + (page4.get('results') or [])
            + (page5.get('results') or [])
        )

        def _year(v: Dict[str, Any]) -> int:
            try:
                return int(v.get('start_year') or 0)
            except (TypeError, ValueError):
                return 0

        def _is_non_english(v: Dict[str, Any]) -> bool:
            pub = ((v.get('publisher') or {}).get('name') or '').lower()
            return pub in _NON_ENGLISH_PUBLISHERS or any(p in pub for p in _NON_ENGLISH_PUBLISHERS)

        def _has_non_ascii_title(v: Dict[str, Any]) -> bool:
            return any(ord(c) > 127 for c in (v.get('name') or ''))

        pre_filtered = [
            v for v in all_results
            if _year(v) >= cutoff
            and not _is_non_english(v)
            and not _has_non_ascii_title(v)
        ]
        formatted = [self.__format_volume_output(v) for v in pre_filtered]
        filtered = [v for v in formatted if not v['translated']][:limit]
        self._mark_already_added(filtered)
        return filtered

    async def get_popular_volumes(
        self,
        limit: int = 100
    ) -> List[VolumeMetadata]:
        """Get popular volumes approximated by recently-updated English series.

        CV's actual popularity metric (page views / user tracking) is not
        exposed by the API. date_last_updated:desc surfaces volumes that fans
        are actively editing — which correlates strongly with ongoing/popular
        series. Anthology-style titles (Four Color, etc.) are excluded since
        their inflated issue counts skew results.
        """
        _ANTHOLOGY_KEYWORDS = frozenset({
            'four color', 'giant-size', 'treasury edition',
            'annual', 'special edition',
        })
        params = {
            'field_list': self.volume_field_list,
            'limit': 100,
        }
        async with AsyncSession() as session:
            page1, page2, page3, page4, page5 = await gather(
                self.__call_api(session, '/volumes', {**params, 'offset': 0},   {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 100}, {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 200}, {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 300}, {'results': []}),
                self.__call_api(session, '/volumes', {**params, 'offset': 400}, {'results': []}),
            )
        all_results = (
            (page1.get('results') or [])
            + (page2.get('results') or [])
            + (page3.get('results') or [])
            + (page4.get('results') or [])
            + (page5.get('results') or [])
        )

        def _is_non_english(v: Dict[str, Any]) -> bool:
            pub = ((v.get('publisher') or {}).get('name') or '').lower()
            return pub in _NON_ENGLISH_PUBLISHERS or any(p in pub for p in _NON_ENGLISH_PUBLISHERS)

        def _has_non_ascii_title(v: Dict[str, Any]) -> bool:
            return any(ord(c) > 127 for c in (v.get('name') or ''))

        def _is_anthology(v: Dict[str, Any]) -> bool:
            name = (v.get('name') or '').lower()
            return any(k in name for k in _ANTHOLOGY_KEYWORDS)

        pre_filtered = [
            v for v in all_results
            if not _is_non_english(v)
            and not _has_non_ascii_title(v)
            and not _is_anthology(v)
        ]
        formatted = [self.__format_volume_output(v) for v in pre_filtered]
        filtered = [v for v in formatted if not v['translated'] and v['issue_count'] >= 3]
        self._mark_already_added(filtered[:limit])
        return filtered[:limit]

    async def get_story_arcs(
        self,
        query: str = '',
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Browse or search story arcs on ComicVine.

        With no query, returns recently-updated arcs. With a query, filters by
        name. Non-English arcs are excluded.
        """
        params: Dict[str, Any] = {
            'field_list': self.story_arc_field_list,
            'sort': 'date_last_updated:desc',
            'limit': 100,
        }
        if query.strip():
            params['filter'] = f'name:{query.strip()}'

        async with AsyncSession() as session:
            page1, page2, page3 = await gather(
                self.__call_api(session, '/story_arcs', {**params, 'offset': 0},   {'results': []}),
                self.__call_api(session, '/story_arcs', {**params, 'offset': 100}, {'results': []}),
                self.__call_api(session, '/story_arcs', {**params, 'offset': 200}, {'results': []}),
            )

        all_results = (
            (page1.get('results') or [])
            + (page2.get('results') or [])
            + (page3.get('results') or [])
        )

        filtered = []
        for arc in all_results:
            pub = ((arc.get('publisher') or {}).get('name') or '').lower()
            if pub and pub in _NON_ENGLISH_PUBLISHERS:
                continue
            name = (arc.get('name') or '').lower()
            if any(k in name for k in _MANGA_TITLE_KEYWORDS):
                continue
            filtered.append({
                'id': int(arc['id']),
                'name': arc.get('name') or '',
                'deck': arc.get('deck') or '',
                'cover_link': (
                    (arc.get('image') or {}).get('medium_url')
                    or (arc.get('image') or {}).get('small_url')
                    or ''
                ),
                'site_url': arc.get('site_detail_url') or '',
                'issue_count': int(arc.get('count_of_issues') or 0),
                'publisher': ((arc.get('publisher') or {}).get('name') or ''),
            })

        filtered.sort(key=lambda a: a['issue_count'], reverse=True)
        return filtered[:limit]

    async def get_story_arc_volumes(
        self,
        arc_id: int
    ) -> Dict[str, Any]:
        """Get arc metadata + deduplicated list of English volumes in the arc."""
        async with AsyncSession() as session:
            data = await self.__call_api(
                session,
                f'/story_arc/{arc_id}',
                {'field_list': f'{self.story_arc_field_list},issues'},
            )

        arc = data.get('results') or {}
        # Issue stubs returned by the story-arc endpoint only carry id/name/
        # api_detail_url — no volume field. Batch-fetch via /issues to resolve
        # each stub's parent volume.
        issue_stubs = arc.get('issues') or []
        issue_ids = [int(s['id']) for s in issue_stubs if s.get('id')]

        seen: set = set()
        vol_ids: List[int] = []
        if issue_ids:
            async with AsyncSession() as session:
                for i in range(0, min(len(issue_ids), 500), 100):
                    batch = issue_ids[i:i + 100]
                    resp = await self.__call_api(
                        session,
                        '/issues',
                        {
                            'field_list': 'id,volume',
                            'filter': f'id:{"|".join(str(v) for v in batch)}',
                            'limit': 100,
                        },
                        {'results': []}
                    )
                    for issue in (resp.get('results') or []):
                        vid_raw = (issue.get('volume') or {}).get('id')
                        if vid_raw is None:
                            continue
                        vid = int(vid_raw)
                        if vid not in seen:
                            seen.add(vid)
                            vol_ids.append(vid)

        arc_meta: Dict[str, Any] = {
            'id': arc_id,
            'name': arc.get('name') or '',
            'deck': arc.get('deck') or '',
            'description': _clean_description(arc.get('description') or ''),
            'cover_link': (
                (arc.get('image') or {}).get('medium_url')
                or (arc.get('image') or {}).get('small_url')
                or ''
            ),
            'site_url': arc.get('site_detail_url') or '',
            'issue_count': int(arc.get('count_of_issues') or 0),
            'publisher': ((arc.get('publisher') or {}).get('name') or ''),
        }

        if not vol_ids:
            return {'arc': arc_meta, 'volumes': []}

        # Batch-fetch volume details (cap at 200 volumes per arc)
        batch_size = 50
        raw_volumes: List[Any] = []
        async with AsyncSession() as session:
            for i in range(0, min(len(vol_ids), 200), batch_size):
                batch = vol_ids[i:i + batch_size]
                resp = await self.__call_api(
                    session,
                    '/volumes',
                    {
                        'field_list': self.volume_field_list,
                        'filter': f'id:{"|".join(str(v) for v in batch)}',
                        'limit': batch_size,
                    },
                    {'results': []}
                )
                for r in (resp.get('results') or []):
                    raw_volumes.append(self.__format_volume_output(r))

        def _is_non_english(v: Any) -> bool:
            pub = (v.get('publisher') or '').lower()
            return pub in _NON_ENGLISH_PUBLISHERS or any(p in pub for p in _NON_ENGLISH_PUBLISHERS)

        filtered_vols = [
            v for v in raw_volumes
            if not _is_non_english(v) and not v.get('translated')
        ]

        # Restore original arc order
        order = {vid: idx for idx, vid in enumerate(vol_ids)}
        filtered_vols.sort(key=lambda v: order.get(v['comicvine_id'], 9999))
        self._mark_already_added(filtered_vols)

        return {
            'arc': arc_meta,
            'volumes': [{k: val for k, val in vol.items() if k != 'cover'} for vol in filtered_vols],
        }

    def _mark_already_added(self, volumes: List[VolumeMetadata]) -> None:
        """Populate the already_added field for a list of formatted volumes."""
        if not volumes:
            return
        placeholders = ','.join('?' * len(volumes))
        already_added: Dict[int, int] = dict(get_db().execute(
            f'SELECT comicvine_id, id FROM volumes '
            f'WHERE comicvine_id IN ({placeholders})',
            tuple(v['comicvine_id'] for v in volumes)
        ).fetchall())
        for v in volumes:
            v['already_added'] = already_added.get(v['comicvine_id'])

    async def __search_volume(
        self, query: str
    ) -> List[Dict[str, Any]]:
        try:
            query = to_full_string_cv_id((query,))[0]

        except ValueError:
            return []

        async with AsyncSession() as session:
            result = await self.__call_api(
                session,
                f'/volume/{query}',
                {'field_list': self.search_field_list}
            )
            return [result['results']]

    async def __search_query(
        self, query: str
    ) -> List[Dict[str, Any]]:
        async with AsyncSession() as session:
            results = await self.__call_api(
                session,
                '/search',
                {
                    'query': query,
                    'resources': 'volume',
                    'limit': 50,
                    'field_list': self.search_field_list
                },
                {'results': []}
            )
            return results['results']

    async def search_volumes(
        self,
        query: str,
        allow_rate_limit_reached: bool = False
    ) -> List[VolumeMetadata]:
        """Search for volumes.

        Args:
            query (str): The query to use when searching.
            allow_rate_limit_reached (bool, optional): Instead of a
                CVRateLimitReached exception being thrown, return an empty list.
                Defaults to False.

        Raises:
            CVRateLimitReached: The rate limit for this endpoint has been reached.
            InvalidComicVineApiKey: The API key is not valid.

        Returns:
            List[VolumeMetadata]: The search results.
        """
        LOGGER.debug(f'Searching for volumes with the query {query}')

        try:
            if query.startswith(('4050-', 'cv:')):
                results = await self.__search_volume(query)
            else:
                results = await self.__search_query(query)

        except VolumeNotMatched:
            return []

        except CVRateLimitReached:
            if allow_rate_limit_reached:
                return []
            raise

        if not results:
            return []

        return self.__format_search_output(results)

    async def filenames_to_cvs(
        self,
        file_groups: Dict[int, Dict[str, FilenameData]],
        only_english: bool
    ) -> Dict[int, Dict[str, Any]]:
        """Match groups of filenames to CV volumes.

        Args:
            file_groups (Dict[int, Dict[str, FilenameData]]): The file groups.
                Is a mapping from group number to a mapping of filename to
                filename data for all files in that group.
            only_english (bool): Only match to english volumes.

        Returns:
            Dict[int, Dict[str, Any]]: A mapping from the group number to its CV
                match.
        """
        # All files in a group share a series title. Searching is done by series
        # title, so search for every title/group instead of for every file.
        titles_to_groups: Dict[str, List[int]] = {}
        for group_numbers, file_group in file_groups.items():
            series_name = next(iter(file_group.values()))['series'].lower()
            titles_to_groups.setdefault(series_name, []).append(group_numbers)

        # Search for each title in batches
        titles_to_results: Dict[str, List[VolumeMetadata]] = {}
        async for title_batch in self.__sleep_iter(
            batched(list(titles_to_groups), 10), 10
        ):
            titles_to_results.update(dict(zip(
                title_batch,
                await gather(*(
                    self.search_volumes(title, allow_rate_limit_reached=True)
                    for title in title_batch
                ))
            )))

        matches: Dict[int, Dict[str, Any]] = {}
        for title, group_numbers in titles_to_groups.items():
            for group_number in group_numbers:
                result = select_best_volume_result_for_file(
                    file_groups[group_number],
                    titles_to_results[title],
                    only_english=only_english
                )

                if result is None:
                    matches[group_number] = {
                        'id': None,
                        'title': None,
                        'issue_count': None,
                        'link': None
                    }

                else:
                    matches[group_number] = {
                        'id': result['comicvine_id'],
                        'title': f"{result['title']} ({result['year']})",
                        'issue_count': result['issue_count'],
                        'link': result['site_url']
                    }

        return matches
