# -*- coding: utf-8 -*-

"""
NZB indexer management and Newznab API search source.
"""

from dataclasses import asdict, dataclass
from re import compile as re_compile
from typing import Any, Dict, List
from xml.etree import ElementTree

from requests.exceptions import RequestException

from backend.base.custom_exceptions import (ClientNotWorking, InvalidKeyValue,
                                            NZBIndexerNotFound)
from backend.base.definitions import (BrokenClientReason, ClientTestResult,
                                      SearchResultData)
from backend.base.file_extraction import extract_filename_data
from backend.base.helpers import Session, normalise_base_url, redact_url_for_log
from backend.base.logging import LOGGER
from backend.internals.db import get_db

# Newznab comic category codes (standard + alt)
DEFAULT_CATEGORIES = '7030,7020'

# Matches bare 4-digit year numbers (1900-2099) not immediately preceded by # or a digit
_bare_year_re = re_compile(r'(?<![\d#])((?:19|20)\d{2})(?!\d)')

# Matches publisher prefixes at the start of dot-separated titles, e.g.:
# "DC.Comics-", "Yen.Press-", "Seven.Seas.Entertainment-", "Viz.Media-"
_publisher_prefix_re = re_compile(
    r'(?i)^(?:[A-Za-z0-9]+\.)+(?:Comics?|Press|Media|Entertainment|Publishing|Publications?|Books?|Manga)[\-\.]'
)


def _normalise_nzb_title(title: str) -> str:
    """Prepare an NZB title for filename extraction.

    NZB release names use dots as word separators and embed bare years without
    parentheses, e.g. ``My.Series.001.2025.Group-Name``.  Without treatment
    the year gets merged into the issue number (``1.2025``) or picked over it.
    This function:
    - Replaces dots with spaces when the title contains no spaces (dot-separated format).
    - Strips publisher prefixes like "DC.Comics-" before dot expansion.
    - Wraps bare year-like numbers (1900-2099) in parentheses so the standard
      year detector in ``extract_filename_data`` recognises them and excludes
      them from the issue-number search.
    """
    if ' ' not in title and title.count('.') >= 2:
        title = _publisher_prefix_re.sub('', title)
        title = title.replace('.', ' ')
        title = _bare_year_re.sub(r'(\1)', title)
    return title


@dataclass
class NZBIndexer:
    id: int
    name: str
    base_url: str
    api_key: str
    categories: str
    enabled: bool

    def todict(self) -> Dict[str, Any]:
        return asdict(self)


class NZBIndexers:

    @staticmethod
    def get_all() -> List[NZBIndexer]:
        rows = get_db().execute(
            "SELECT id, name, base_url, api_key, categories, enabled FROM nzb_indexers ORDER BY name, id;"
        ).fetchalldict()
        return [
            NZBIndexer(
                id=r['id'],
                name=r['name'],
                base_url=r['base_url'],
                api_key=r['api_key'],
                categories=r['categories'],
                enabled=bool(r['enabled'])
            )
            for r in rows
        ]

    @staticmethod
    def get(indexer_id: int) -> NZBIndexer:
        row = get_db().execute(
            "SELECT id, name, base_url, api_key, categories, enabled FROM nzb_indexers WHERE id = ? LIMIT 1;",
            (indexer_id,)
        ).fetchonedict()
        if not row:
            raise NZBIndexerNotFound(indexer_id)
        return NZBIndexer(
            id=row['id'],
            name=row['name'],
            base_url=row['base_url'],
            api_key=row['api_key'],
            categories=row['categories'],
            enabled=bool(row['enabled'])
        )

    @staticmethod
    def add(
        name: str,
        base_url: str,
        api_key: str,
        categories: str = DEFAULT_CATEGORIES,
        enabled: bool = True
    ) -> NZBIndexer:
        if not name:
            raise InvalidKeyValue('name', name)
        if not base_url:
            raise InvalidKeyValue('base_url', base_url)

        base_url = normalise_base_url(base_url)
        NZBIndexers._test_connection(base_url, api_key)

        new_id = get_db().execute(
            """
            INSERT INTO nzb_indexers(name, base_url, api_key, categories, enabled)
            VALUES (?, ?, ?, ?, ?);
            """,
            (name, base_url, api_key or '', categories or '', int(enabled))
        ).lastrowid
        return NZBIndexers.get(new_id)

    @staticmethod
    def update(
        indexer_id: int,
        name: str,
        base_url: str,
        api_key: str,
        categories: str,
        enabled: bool
    ) -> NZBIndexer:
        NZBIndexers.get(indexer_id)  # raises if not found
        if not name:
            raise InvalidKeyValue('name', name)
        if not base_url:
            raise InvalidKeyValue('base_url', base_url)

        base_url = normalise_base_url(base_url)
        NZBIndexers._test_connection(base_url, api_key)

        get_db().execute(
            """
            UPDATE nzb_indexers
            SET name = ?, base_url = ?, api_key = ?, categories = ?, enabled = ?
            WHERE id = ?;
            """,
            (name, base_url, api_key or '', categories or '', int(enabled), indexer_id)
        )
        return NZBIndexers.get(indexer_id)

    @staticmethod
    def delete(indexer_id: int) -> None:
        NZBIndexers.get(indexer_id)  # raises if not found
        get_db().execute("DELETE FROM nzb_indexers WHERE id = ?;", (indexer_id,))

    @staticmethod
    def _test_connection(base_url: str, api_key: str) -> None:
        ssn = Session()
        try:
            r = ssn.get(
                f'{base_url}/api',
                params={
                    't': 'caps',
                    'apikey': api_key or '',
                    'o': 'json'
                }
            )
        except RequestException:
            LOGGER.exception("Can't connect to NZB indexer: ")
            raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

        if not r.ok:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

    @staticmethod
    def test(base_url: str, api_key: str) -> ClientTestResult:
        try:
            NZBIndexers._test_connection(
                normalise_base_url(base_url), api_key
            )
            return ClientTestResult({'success': True, 'description': None})

        except ClientNotWorking as e:
            return ClientTestResult({'success': False, 'description': e.reason_text})

    @staticmethod
    def search_indexers(
        indexers: List['NZBIndexer'], query: str
    ) -> List[SearchResultData]:
        """Query a pre-fetched list of indexers — no DB access, safe for threads."""
        results: List[SearchResultData] = []
        ssn = Session()

        for indexer in indexers:
            url = f'{indexer.base_url}/api'
            LOGGER.info('Querying NZB indexer %s: %s q=%r cat=%s',
                        indexer.name, url, query, indexer.categories)
            try:
                params: Dict[str, str] = {
                    't': 'search',
                    'q': query,
                    'apikey': indexer.api_key,
                }
                if indexer.categories:
                    params['cat'] = indexer.categories
                r = ssn.get(url, params=params)
                if not r.ok:
                    LOGGER.warning(
                        'NZB indexer %s returned HTTP %s', indexer.name, r.status_code
                    )
                    continue

                parsed = _parse_newznab_xml(r.text, indexer.name, indexer.base_url, indexer.api_key)
                LOGGER.info('NZB indexer %s returned %d results for q=%r',
                            indexer.name, len(parsed), query)
                results.extend(parsed)

            except RequestException as e:
                LOGGER.warning('NZB indexer %s unreachable: %s', indexer.name, e)

        return results

    @staticmethod
    def search(query: str) -> List[SearchResultData]:
        indexers = [i for i in NZBIndexers.get_all() if i.enabled]
        return NZBIndexers.search_indexers(indexers, query)


def _parse_newznab_xml(
    xml_text: str,
    source_name: str,
    base_url: str,
    api_key: str
) -> List[SearchResultData]:
    results: List[SearchResultData] = []
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        LOGGER.warning('Failed to parse NZB indexer XML response')
        return results

    channel = root.find('channel')
    if channel is None:
        return results

    for item in channel.findall('item'):
        title_el = item.find('title')
        title = title_el.text.strip() if title_el is not None and title_el.text else ''

        enclosure = item.find('enclosure')
        link = enclosure.get('url', '') if enclosure is not None else ''

        # Some indexers omit the NZB id/apikey from the enclosure URL.
        # Reconstruct from the newznab:attr guid element in that case.
        if 'id=' not in link:
            guid = ''
            for el in item.iter():
                local = el.tag.split('}')[-1] if '}' in el.tag else el.tag
                if local == 'attr' and el.get('name') == 'guid':
                    guid = el.get('value', '')
                    break
            if guid:
                qs = f't=get&id={guid}'
                if api_key:
                    qs += f'&apikey={api_key}'
                link = f'{base_url}/api?{qs}'
                LOGGER.info(
                    'Constructed NZB download URL from GUID: %s',
                    redact_url_for_log(link),
                )
            else:
                LOGGER.warning(
                    'NZB item "%s" has no usable download URL and no GUID, skipping', title
                )
                continue

        if not link:
            continue

        result: SearchResultData = {
            **extract_filename_data(_normalise_nzb_title(title), assume_volume_number=False, fix_year=True),
            'link': link,
            'display_title': title,
            'source': source_name,
        }
        results.append(result)

    return results
