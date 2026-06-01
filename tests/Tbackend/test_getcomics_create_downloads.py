"""Regression test: GetComicsPage.create_downloads crashes with
NameError: name 'gather' is not defined because asyncio.gather was not
included in the getcomics.py import.

RED  (before fix): asyncio.gather is absent from the import; _test_paths
     raises NameError at the `await gather(...)` call.
GREEN (after fix): gather is imported; create_downloads returns a list.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.base.definitions import GCDownloadSource, DownloadGroup
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


if __name__ == '__main__':
    unittest.main()
