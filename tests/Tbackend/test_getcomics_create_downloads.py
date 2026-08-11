"""Regression test: GetComicsPage.create_downloads crashes with
NameError: name 'gather' is not defined because asyncio.gather was not
included in the getcomics.py import.

RED  (before fix): asyncio.gather is absent from the import; _test_paths
     raises NameError at the `await gather(...)` call.
GREEN (after fix): gather is imported; create_downloads returns a list.
"""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from backend.base.custom_exceptions import ExternalClientNotFound
from backend.base.definitions import (DownloadType, GCDownloadSource,
                                      DownloadGroup)
from backend.implementations import getcomics
from backend.implementations.getcomics import GetComicsPage

# Minimal DownloadGroup that satisfies the TypedDict shape.
_GROUP: DownloadGroup = {
    'web_sub_title': 'Captain America Vol 5 (2005)',
    'info': {
        'series': 'Captain America',
        'year': 2005,
        'volume_number': 5,
        'special_version': None,
        'issue_number': None,
        'annual': False,
    },
    'links': {GCDownloadSource.MEGA: ['https://mega.nz/fake']},
}

# Fake Download object returned by the patched __purify_download_group.
_FAKE_DOWNLOAD = MagicMock(name='FakeDownload')


class CreateDownloadsGatherImportTest(unittest.IsolatedAsyncioTestCase):
    """Regression: missing asyncio.gather import breaks every bulk download."""

    async def test_create_downloads_does_not_raise_name_error(self):
        page = GetComicsPage('http://getcomics.org/fake-cap-vol5')
        page.title = 'Captain America Vol 5 (2005)'
        page.download_groups = [_GROUP]

        purify_mock = AsyncMock(return_value=(_FAKE_DOWNLOAD, False))

        with patch(
            'backend.implementations.getcomics.__purify_download_group',
            purify_mock,
        ), patch(
            'backend.implementations.getcomics._create_link_paths',
            return_value=[[_GROUP]],
        ):
            result = await page.create_downloads(volume_id=1159)

        self.assertIsInstance(result, list)
        self.assertEqual(result, [_FAKE_DOWNLOAD])


class GetComicsTorrentClientGateTest(unittest.TestCase):
    """Regression: a Usenet client must not make torrent links eligible."""

    def test_get_download_groups_requires_actual_torrent_client(self):
        soup = MagicMock()
        soup.find.return_value = MagicMock()
        settings = SimpleNamespace(
            sv=SimpleNamespace(
                service_preference=[source.value for source in GCDownloadSource]
            )
        )

        with patch.object(
            getcomics.ExternalClients,
            'get_clients',
            return_value=[{'download_type': DownloadType.USENET.value}],
        ), patch.object(
            getcomics, 'Settings', return_value=settings,
        ), patch.object(
            getcomics, '__extract_button_links', return_value=[]
        ) as buttons, patch.object(
            getcomics, '__extract_list_links', return_value=[]
        ) as lists:
            getcomics._get_download_groups(soup)

        buttons.assert_called_once_with(soup.find.return_value, False)
        lists.assert_called_once_with(soup.find.return_value, False)

    def test_get_download_groups_allows_torrent_when_torrent_client_exists(self):
        soup = MagicMock()
        soup.find.return_value = MagicMock()
        settings = SimpleNamespace(
            sv=SimpleNamespace(
                service_preference=[source.value for source in GCDownloadSource]
            )
        )

        with patch.object(
            getcomics.ExternalClients,
            'get_clients',
            return_value=[{'download_type': DownloadType.TORRENT.value}],
        ), patch.object(
            getcomics, 'Settings', return_value=settings,
        ), patch.object(
            getcomics, '__extract_button_links', return_value=[]
        ) as buttons, patch.object(
            getcomics, '__extract_list_links', return_value=[]
        ) as lists:
            getcomics._get_download_groups(soup)

        buttons.assert_called_once_with(soup.find.return_value, True)
        lists.assert_called_once_with(soup.find.return_value, True)


class _MissingTorrentClientDownload:
    def __init__(self, *args, **kwargs):
        raise ExternalClientNotFound(-1)


class _WorkingDownload:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class PurifyDownloadGroupFallbackTest(unittest.IsolatedAsyncioTestCase):
    """Regression: one unsupported/broken candidate must not abort the group."""

    async def test_external_client_failure_falls_back_to_next_link(self):
        group: DownloadGroup = {
            'web_sub_title': 'Action Comics #0 - 904',
            'info': {
                'series': 'Action Comics',
                'year': 1938,
                'volume_number': 1,
                'special_version': None,
                'issue_number': (0.0, 904.0),
                'annual': False,
            },
            'links': {
                GCDownloadSource.GETCOMICS_TORRENT: ['magnet:?xt=bad'],
                GCDownloadSource.PIXELDRAIN: ['https://pixeldrain.com/u/good'],
            },
        }
        purify = AsyncMock(side_effect=[
            ('magnet:?xt=bad', _MissingTorrentClientDownload),
            ('https://pixeldrain.com/u/good', _WorkingDownload),
        ])

        with patch.object(getcomics, '__purify_link', purify), \
                patch.object(getcomics, 'iter_commit', side_effect=lambda rows: rows):
            download, limit_reached = await getattr(getcomics, '__purify_download_group')(
                group,
                volume_id=1072,
                issue_id=None,
                web_link='https://getcomics.org/dc/action-comics-0-904-1000000-complete/',
                web_title='Action Comics #0 – 904 + 1,000,000 + Annuals',
            )

        self.assertIsInstance(download, _WorkingDownload)
        self.assertFalse(limit_reached)
        self.assertEqual(purify.await_count, 2)


if __name__ == '__main__':
    unittest.main()
