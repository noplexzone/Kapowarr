# -*- coding: utf-8 -*-

"""
NZB indexer management and Newznab API search source.
"""

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Union
from xml.etree import ElementTree

from requests.exceptions import RequestException

from backend.base.custom_exceptions import (ClientNotWorking, InvalidKeyValue,
                                            NZBIndexerNotFound)
from backend.base.definitions import (BrokenClientReason, ClientTestResult,
                                      SearchResultData)
from backend.base.file_extraction import extract_filename_data
from backend.base.helpers import Session, normalise_base_url
from backend.base.logging import LOGGER
from backend.internals.db import get_db

# Newznab comic category codes (standard + alt)
DEFAULT_CATEGORIES = '7030,7020'


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
            (name, base_url, api_key or '', categories or DEFAULT_CATEGORIES, int(enabled))
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
        indexer = NZBIndexers.get(indexer_id)  # raises if not found
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
            (name, base_url, api_key or '', categories or DEFAULT_CATEGORIES, int(enabled), indexer_id)
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
    def search(query: str) -> List[SearchResultData]:
        """Search all enabled NZB indexers with a Newznab query.

        Args:
            query (str): The search query string.

        Returns:
            List[SearchResultData]: Matching NZB results, each with a direct
                NZB download URL as the ``link``.
        """
        indexers = [i for i in NZBIndexers.get_all() if i.enabled]
        results: List[SearchResultData] = []
        ssn = Session()

        for indexer in indexers:
            try:
                r = ssn.get(
                    f'{indexer.base_url}/api',
                    params={
                        't': 'search',
                        'q': query,
                        'apikey': indexer.api_key,
                        'cat': indexer.categories,
                    }
                )
                if not r.ok:
                    LOGGER.warning(
                        'NZB indexer %s returned HTTP %s', indexer.name, r.status_code
                    )
                    continue

                results.extend(_parse_newznab_xml(r.text, indexer.name))

            except RequestException:
                LOGGER.warning('NZB indexer %s unreachable', indexer.name)

        return results


def _parse_newznab_xml(xml_text: str, source_name: str) -> List[SearchResultData]:
    """Parse Newznab RSS/XML response and extract search results.

    Args:
        xml_text (str): Raw XML response from indexer.
        source_name (str): Human-readable indexer name.

    Returns:
        List[SearchResultData]: Parsed results.
    """
    results: List[SearchResultData] = []
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        LOGGER.warning('Failed to parse NZB indexer XML response')
        return results

    ns = {'newznab': 'http://www.newznab.com/DTD/2010/feeds/attributes/'}
    channel = root.find('channel')
    if channel is None:
        return results

    for item in channel.findall('item'):
        title_el = item.find('title')
        title = title_el.text.strip() if title_el is not None and title_el.text else ''

        enclosure = item.find('enclosure')
        if enclosure is None:
            continue
        link = enclosure.get('url', '')
        if not link:
            continue

        result: SearchResultData = {
            **extract_filename_data(title, assume_volume_number=False, fix_year=True),
            'link': link,
            'display_title': title,
            'source': source_name,
        }
        results.append(result)

    return results
