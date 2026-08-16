# -*- coding: utf-8 -*-

"""
Search for volumes/issues and fetch metadata for them on ComicVine
"""

from asyncio import gather, run, sleep
from datetime import date as _date, timedelta
from json import JSONDecodeError
from re import IGNORECASE, compile
from typing import Any, AsyncGenerator, Dict, FrozenSet, Iterable, List, Sequence, Union

from aiohttp import ContentTypeError
from aiohttp.client_exceptions import ClientError
from bs4 import BeautifulSoup, Tag

from backend.base.custom_exceptions import (CVRateLimitReached,
                                            InvalidComicVineApiKey,
                                            VolumeNotMatched)
from backend.base.definitions import (Constants, DateType, FilenameData,
                                      IssueMetadata, T, VolumeMetadata)
from backend.base.file_extraction import (extract_issue_number,
                                          extract_volume_number, volume_regex)
from backend.base.helpers import (AsyncSession, Session, batched,
                                  first_of_range, force_range, force_suffix,
                                  normalise_query_string, normalise_string,
                                  normalise_year, to_full_string_cv_id,
                                  to_string_cv_id)
from backend.base.logging import LOGGER
from backend.implementations.matching import select_best_volume_result_for_file
from backend.internals.db import get_db
from backend.internals.settings import Settings

_NON_ENGLISH_PUBLISHERS = frozenset({
    # Japanese publishers
    'shogakukan', 'akita shoten', 'akita publishing', 'square enix',
    'shodensha', 'shucream', 'shu-cream', 'two virgins',
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
    'digital manga publishing', 'digital manga guild', 'gen manga', 'aurora publishing',
    # English-language manga publishers / imprints (extended)
    'j-novel club', 'cross infinite world', 'one peace books',
    'manga planet', 'ghost ship', 'fakku books',
    'irodori comics', 'denpa', 'ablaze manga', 'cmx', 'bandai entertainment',
    'ize press', 'yen on', 'netcomics', 'kuma', 'steamship', 'airship',
    'manga classics', 'manga university', 'star fruit books',
    'glacier bay books', 'drawn and quarterly manga', 'line manga',
    # The shorter alias so substring check catches "Seven Seas" without "Entertainment"
    'seven seas',
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
    'monthly dragon age', 'dragon age', 'feel young', 'comic it',
    'weekly jump', 'young jump', 'big comic', 'shonen sunday',
    'shonen magazine', 'weekly playboy', 'young magazine',
    'sho-comi', 'hana to yume', 'sunday comics', 'morning comics',
    'afternoon comics', 'evening comics', 'young animal',
    # Additional anthology magazine titles not covered by publisher lookup
    'grand jump', 'manga time', 'big gangan', 'young gangan',
    'ultra jump', 'jump sq', 'v jump', 'monthly shonen', 'bessatsu',
    'ribon', 'nakayoshi', 'comic alive', 'monthly comic',
    'young champion', 'yuri hime', 'dengeki daioh', 'dengeki maoh',
    'goraku', 'elegance eve', 'cocohana', 'monthly flowers',
    'office you', 'champion red', 'action pizazz', 'comic zenon',
    'comic cune', 'comic ran', 'mahjong', 'be love',
    # Adult manga anthology magazines — publisher lookup can silently fail for
    # these on CV, so title keywords act as a second filter layer.
    'hotmilk', 'bavel', 'comic exe', 'comic x-eros', 'comic kairakuten',
    'megastore', 'comic megastore', 'comic unreal', 'comic anthurium',
    'comic tenma', 'comic mujin', 'comic europa', 'comic penguin',
    'comic lo', 'comic potpourri', 'girls forM', 'comic kuribayashi',
    'e★everystar', 'e*everystar', 'comic valkyrie', 'isekai',
})
_MANGA_TITLE_KEYWORDS = _NON_ENGLISH_TITLE_KEYWORDS

# Japanese publishers + English-language manga imprints (used to positively
# identify manga volumes for the Manga section).
_MANGA_PUBLISHERS = frozenset({
    'shogakukan', 'akita shoten', 'akita publishing', 'square enix',
    'shodensha', 'shucream', 'shu-cream', 'two virgins',
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
    # French/European manga imprints (not bande dessinée)
    'pika edition', 'pika', 'taifu comics', 'ki-oon', 'kana',
    'kurokawa', 'tonkam', 'delcourt tonkam', 'glenat manga',
    'soleil manga', 'kazé', 'kaze', 'panini manga', 'crunchyroll',
    'crunchyroll manga', 'noeve grafx', 'akata', 'meian',
})

# English-language manga publishers/imprints only — used to whitelist
# content in the Manga discovery section so that only licensed English
# editions (not Japanese originals or other-language editions) are shown.
_ENGLISH_MANGA_PUBLISHERS = frozenset({
    'viz media', 'viz',
    'yen press',
    'tokyopop',
    'seven seas entertainment', 'seven seas',
    'vertical', 'vertical comics',
    'udon entertainment',
    'digital manga publishing', 'digital manga guild',
    'gen manga',
    'aurora publishing',
    'dark horse comics', 'dark horse manga',
    'kodansha comics', 'kodansha comics usa', 'kodansha usa',
    'square enix manga',
    'crunchyroll', 'crunchyroll manga',
    'j-novel club',
    'cross infinite world',
    'one peace books',
    'manga planet',
    'ghost ship',
    'fakku books',
    'irodori comics',
    'denpa',
    'ablaze manga',
    'cmx',
    'bandai entertainment',
    'ize press', 'yen on',
    'netcomics', 'kuma', 'steamship', 'airship',
    'manga classics', 'manga university',
    'star fruit books', 'glacier bay books',
    'drawn and quarterly manga',
})


def _publisher_matches(pub: str, publishers: FrozenSet[str]) -> bool:
    normalized = normalise_query_string(pub or '').strip().lower()
    if not normalized:
        return False
    return any(
        normalized == publisher
        or publisher in normalized
        or normalized in publisher
        for publisher in publishers
    )


def _is_comic_discovery_excluded_publisher(pub: str) -> bool:
    return (
        _publisher_matches(pub, _NON_ENGLISH_PUBLISHERS)
        or _publisher_matches(pub, _ENGLISH_MANGA_PUBLISHERS)
    )


def _has_manga_discovery_title_keyword(title: str) -> bool:
    normalized = normalise_query_string(title or '').lower()
    return any(keyword in normalized for keyword in _MANGA_TITLE_KEYWORDS)


def _has_non_ascii(value: str) -> bool:
    return any(ord(c) > 127 for c in (value or ''))


def _is_comic_discovery_candidate_volume(volume: Dict[str, Any]) -> bool:
    pub = ((volume.get('publisher') or {}).get('name') or '')
    return (
        not _is_comic_discovery_excluded_publisher(pub)
        and not _has_non_ascii(volume.get('name') or '')
        and not _has_manga_discovery_title_keyword(volume.get('name') or '')
    )


def _is_english_manga_publisher(pub: str) -> bool:
    return _publisher_matches(pub, _ENGLISH_MANGA_PUBLISHERS)


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


RECENT_SERIES_START_WINDOW_DAYS = 365

def _parse_cv_date(value: Any):
    if not value:
        return None
    try:
        return _date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None

def issue_date(issue: Dict[str, Any], configured_date_type: Any = None):
    configured = str(configured_date_type or DateType.COVER_DATE)
    preferred = 'store_date' if configured.endswith('store_date') else 'cover_date'
    fallback = 'cover_date' if preferred == 'store_date' else 'store_date'
    return _parse_cv_date(issue.get(preferred)) or _parse_cv_date(issue.get(fallback))


def _issue_date(issue: Dict[str, Any], configured_date_type: Any = None):
    return issue_date(issue, configured_date_type)

def _issue_number_value(issue: Dict[str, Any]) -> float:
    value = first_of_range(force_range(extract_issue_number(str(issue.get('issue_number') or ''))))
    return float(value) if value is not None else 0.0

def _first_known_issue(volume: Dict[str, Any], configured_date_type: Any = None) -> Union[Dict[str, Any], None]:
    dated = [issue for issue in (volume.get('issues') or []) if _issue_date(issue, configured_date_type)]
    if not dated:
        return None
    return sorted(dated, key=lambda issue: (_issue_date(issue, configured_date_type), _issue_number_value(issue), str(issue.get('id') or '')))[0]

def _is_recently_started_volume(volume: Dict[str, Any], today: Union[_date, None] = None, configured_date_type: Any = None) -> bool:
    today = today or _date.today()
    first = _first_known_issue(volume, configured_date_type)
    if not first:
        return False
    first_date = _issue_date(first, configured_date_type)
    return bool(first_date and first_date <= today and today - first_date <= timedelta(days=RECENT_SERIES_START_WINDOW_DAYS))

def _is_launch_issue_for_volume(issue: Dict[str, Any], volume: Dict[str, Any], configured_date_type: Any = None) -> bool:
    first = _first_known_issue(volume, configured_date_type)
    if not first:
        return False
    return str(first.get('id') or '') == str(issue.get('id') or '')

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

    async def fetch_issue_cover_candidate(
        self,
        issue_id: int
    ) -> Union[Dict[str, Any], None]:
        """Fetch a ComicVine issue cover candidate for cover-page insertion.

        The issue belongs to the library's monitored ComicVine volume, so this
        is the preferred source when MangaDex only exposes original-language
        tankobon covers.
        """
        async with AsyncSession() as session:
            result = await self.__call_api(
                session,
                '/issues',
                {
                    'field_list': (
                        'id,issue_number,name,image,site_detail_url,volume'
                    ),
                    'filter': f'id:{issue_id}'
                },
                {'results': []}
            )

        issues = result.get('results') or []
        if not issues:
            return None

        issue = issues[0]
        image = issue.get('image') or {}
        image_url = (
            image.get('original_url')
            or image.get('super_url')
            or image.get('medium_url')
            or image.get('small_url')
        )
        thumbnail_url = (
            image.get('small_url')
            or image.get('medium_url')
            or image_url
        )
        if not image_url or not thumbnail_url:
            return None

        volume = issue.get('volume') or {}
        return {
            'source': 'ComicVine',
            'manga_id': str(volume.get('id') or ''),
            'manga_title': volume.get('name') or '',
            'volume': str(issue.get('issue_number') or ''),
            'cover_id': f"cv-{issue.get('id')}",
            'file_name': image_url.rsplit('/', 1)[-1],
            'image_url': image_url,
            'thumbnail_url': thumbnail_url,
            'locale': 'en',
            'description': issue.get('name') or issue.get('site_detail_url'),
        }

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
        days: int = 60,
        limit: int = 200
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

        date_field = 'store_date' if str(Settings().sv.date_type).endswith('store_date') else 'cover_date'
        issue_params = {
            'field_list': 'id,name,issue_number,cover_date,store_date,image,site_detail_url,volume',
            'filter': f'{date_field}:{today}|{end}',
            'sort': f'{date_field}:asc',
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

            # Pre-filter using data already present in the issue stubs —
            # no extra API call needed for these checks.
            results = [
                r for r in results
                if not _has_non_ascii((r.get('volume') or {}).get('name') or '')
                and not _has_non_ascii(r.get('name') or '')
                and not _has_manga_discovery_title_keyword((r.get('volume') or {}).get('name') or '')
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
            volume_details: Dict[int, Dict[str, Any]] = {}
            if unique_vol_ids:
                vol_tasks = [
                    self.__call_api(
                        session, '/volumes',
                        {
                            'field_list': 'id,publisher,issues',
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
                        vid = int(v['id'])
                        volume_details[vid] = v
                        if _is_comic_discovery_excluded_publisher(pub):
                            non_english_vol_ids.add(vid)

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
            details = volume_details.get(vol_cv_id or 0)
            if not details or not _is_launch_issue_for_volume(item, details, Settings().sv.date_type):
                continue
            upcoming.append({
                'issue_id':     int(item['id']),
                'issue_number': item.get('issue_number') or '',
                'title':        item.get('name') or '',
                'cover_date':   item.get('cover_date') or '',
                'store_date':   item.get('store_date') or '',
                'cover_link':   (item.get('image') or {}).get('small_url', ''),
                'site_url':     item.get('site_detail_url') or '',
                'volume_id':    vol_cv_id,
                'volume_title': vol.get('name') or '',
                'already_added': already_added.get(vol_cv_id) if vol_cv_id else None,
            })
        return upcoming[:limit]

    async def get_new_volumes(
        self,
        limit: int = 200
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
        # Fetch a wider candidate pool so the Discover hide-library option still
        # has enough non-library comics left to show after local filtering.
        today = _date.today()
        params = {
            'field_list': self.volume_field_list,
            'sort': 'date_added:desc',
            'limit': 100,
        }
        async with AsyncSession() as session:
            pages = await gather(*(
                self.__call_api(
                    session, '/volumes', {**params, 'offset': offset},
                    {'results': []}
                )
                for offset in range(0, 1000, 100)
            ))
        all_results = [
            result
            for page in pages
            for result in (page.get('results') or [])
        ]

        pre_filtered = [
            v for v in all_results
            if _is_recently_started_volume(v, today, Settings().sv.date_type)
            and _is_comic_discovery_candidate_volume(v)
        ]
        pre_filtered.sort(key=lambda v: (-(_issue_date(_first_known_issue(v, Settings().sv.date_type), Settings().sv.date_type) or _date.min).toordinal(), str(v.get('name') or '').lower(), str(v.get('id') or '')))
        formatted = [self.__format_volume_output(v) for v in pre_filtered]
        for output, source in zip(formatted, pre_filtered):
            first = _first_known_issue(source, Settings().sv.date_type)
            output['series_started_at'] = (_issue_date(first, Settings().sv.date_type).isoformat() if first and _issue_date(first, Settings().sv.date_type) else None)
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
        section: str = 'comic',
        allow_rate_limit_reached: bool = False
    ) -> List[VolumeMetadata]:
        """Search for volumes.

        Args:
            query (str): The query to use when searching.
            section (str, optional): 'comic' or 'manga'. Filters results to
                match the section. Defaults to 'comic'.
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

        formatted = self.__format_search_output(results)

        if section == 'manga':
            def _is_manga(v: VolumeMetadata) -> bool:
                pub = (v.get('publisher') or '').lower()
                is_manga_pub = (
                    pub in _MANGA_PUBLISHERS
                    or any(p in pub for p in _MANGA_PUBLISHERS)
                )
                return v.get('translated') or is_manga_pub

            return [v for v in formatted if _is_manga(v)]

        if section == 'comic':
            def _is_non_english(v: VolumeMetadata) -> bool:
                pub = (v.get('publisher') or '').lower()
                return (
                    pub in _NON_ENGLISH_PUBLISHERS
                    or any(p in pub for p in _NON_ENGLISH_PUBLISHERS)
                )

            return [v for v in formatted if not _is_non_english(v) and not v.get('translated')]

        return formatted


    async def browse_catalog_volumes(
        self,
        *,
        query: str = '',
        publisher: str = '',
        decade: str = '',
        year: str = '',
        offset: int = 0,
        limit: int = 30,
        sort: str = 'recently_updated'
    ) -> Dict[str, Any]:
        """Browse ComicVine comic volumes with provider-backed filters.

        Fetches limit+1 so has_more is based on an actual extra provider row,
        and deduplicates by ComicVine volume ID rather than title.
        """
        filters = []
        if query:
            filters.append(f'name:{query}')
        if publisher:
            filters.append(f'publisher:{publisher}')
        selected_year = None
        if year:
            try:
                selected_year = int(year)
            except (TypeError, ValueError):
                selected_year = None
        elif decade:
            try:
                selected_year = int(decade)
            except (TypeError, ValueError):
                selected_year = None
        if selected_year:
            if year:
                filters.append(f'start_year:{selected_year}')
            else:
                filters.append(f'start_year:{selected_year}|{selected_year + 9}')
        order = {
            'title': 'name:asc',
            'year': 'start_year:desc',
            'recently_started': 'start_year:desc',
            'recently_updated': 'date_last_updated:desc',
            'trending': 'date_last_updated:desc',
        }.get(sort, 'date_last_updated:desc')
        params = {
            'field_list': 'id,name,deck,description,publisher,start_year,image,site_detail_url,count_of_issues,date_added,date_last_updated',
            'sort': order,
            'offset': offset,
            'limit': limit + 1,
        }
        if filters:
            params['filter'] = ','.join(filters)
        async with AsyncSession() as session:
            page = await self.__call_api(session, '/volumes', params, {'results': [], 'number_of_total_results': 0})
        seen = set()
        raw_items = []
        for item in page.get('results') or []:
            key = str(item.get('id') or '')
            if not key or key in seen:
                continue
            seen.add(key)
            if not _is_comic_discovery_candidate_volume(item):
                continue
            raw_items.append(item)
        has_more = len(raw_items) > limit
        formatted = self.__format_search_output(raw_items[:limit])
        for item in formatted:
            item['metadata_source_label'] = 'ComicVine'
            if sort == 'trending':
                item['status'] = 'Recently active'
        return {
            'items': formatted,
            'total': int(page.get('number_of_total_results') or offset + len(formatted) + (1 if has_more else 0)),
            'offset': offset,
            'page_size': limit,
            'has_more': has_more,
            'source_note': 'Recently Active uses ComicVine date_last_updated; it is not a global popularity score.',
        }

    async def get_upcoming_releases_manga(
        self,
        days: int = 60,
        limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Get manga issues releasing in the next N days.

        Mirrors get_upcoming_releases but keeps only manga/Japanese
        publishers instead of filtering them out.
        """
        from datetime import date, timedelta
        today = date.today()
        end = today + timedelta(days=days)

        date_field = 'store_date' if str(Settings().sv.date_type).endswith('store_date') else 'cover_date'
        issue_params = {
            'field_list': 'id,name,issue_number,cover_date,store_date,image,site_detail_url,volume',
            'filter': f'{date_field}:{today}|{end}',
            'sort': f'{date_field}:asc',
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
            results = [r for r in results if (r.get('volume') or {}).get('id')]

            unique_vol_ids = list({
                str(r['volume']['id']) for r in results
            })
            english_manga_vol_ids: set = set()
            if unique_vol_ids:
                vol_tasks = [
                    self.__call_api(
                        session, '/volumes',
                        {
                            'field_list': 'id,publisher,issues',
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
                        pub = ((v.get('publisher') or {}).get('name') or '')
                        if _is_english_manga_publisher(pub):
                            english_manga_vol_ids.add(int(v['id']))

        filtered = [
            r for r in results
            if int(r['volume']['id']) in english_manga_vol_ids
            and not _has_manga_discovery_title_keyword((r.get('volume') or {}).get('name') or '')
        ]

        vol_ids_int = tuple(int(r['volume']['id']) for r in filtered)
        already_added: Dict[int, int] = {}
        if vol_ids_int:
            placeholders = ','.join('?' * len(vol_ids_int))
            already_added = dict(get_db().execute(
                f'SELECT comicvine_id, id FROM volumes '
                f'WHERE comicvine_id IN ({placeholders})',
                vol_ids_int
            ).fetchall())

        upcoming = []
        for item in filtered:
            vol = item.get('volume') or {}
            vol_cv_id = int(vol['id']) if vol.get('id') else None
            upcoming.append({
                'issue_id':     int(item['id']),
                'issue_number': item.get('issue_number') or '',
                'title':        item.get('name') or '',
                'cover_date':   item.get('cover_date') or '',
                'store_date':   item.get('store_date') or '',
                'cover_link':   (item.get('image') or {}).get('small_url', ''),
                'site_url':     item.get('site_detail_url') or '',
                'volume_id':    vol_cv_id,
                'volume_title': vol.get('name') or '',
                'already_added': already_added.get(vol_cv_id) if vol_cv_id else None,
            })
        return upcoming[:limit]

    async def get_new_volumes_manga(
        self,
        limit: int = 100
    ) -> List[VolumeMetadata]:
        """Get manga volumes sorted by publish date (start year), newest first."""
        from datetime import date as _date
        cutoff = _date.today().year - 3
        vol_params = {
            'field_list': (
                'id,name,deck,description,publisher,start_year,'
                'image,site_detail_url,count_of_issues,date_added'
            ),
            'sort': 'date_added:desc',
            'limit': 100,
        }
        async with AsyncSession() as session:
            pages = await gather(*(
                self.__call_api(
                    session, '/volumes',
                    {**vol_params, 'offset': i * 100},
                    {'results': []}
                )
                for i in range(5)
            ))

        all_results = (
            (pages[0].get('results') or [])
            + (pages[1].get('results') or [])
            + (pages[2].get('results') or [])
            + (pages[3].get('results') or [])
            + (pages[4].get('results') or [])
        )

        def _year(v: Dict[str, Any]) -> int:
            try:
                return int(v.get('start_year') or 0)
            except (TypeError, ValueError):
                return 0

        def _is_english_manga(v: Dict[str, Any]) -> bool:
            pub = ((v.get('publisher') or {}).get('name') or '')
            return _is_english_manga_publisher(pub)

        pre_filtered = [
            v for v in all_results
            if _year(v) >= cutoff
            and _is_english_manga(v)
            and not _has_non_ascii(v.get('name') or '')
            and not _has_manga_discovery_title_keyword(v.get('name') or '')
        ]
        formatted = [self.__format_volume_output(v) for v in pre_filtered]
        # Keep only volumes flagged as translated — the positive publisher
        # check above already ensures English manga houses. The translated
        # flag catches the remaining signal from the description text.
        filtered = [v for v in formatted if v['translated']][:limit]
        self._mark_already_added(filtered)
        return filtered

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
