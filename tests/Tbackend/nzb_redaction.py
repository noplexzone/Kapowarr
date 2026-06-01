"""Tests proving that apikey values are not leaked in logs.

Covers NZB indexer GUID-URL construction and the NZBIndexers.search_indexers
integration path where _parse_newznab_xml logs a constructed URL.
"""

import unittest

from backend.implementations import nzb_indexers as nzb_module
from backend.implementations.nzb_indexers import _parse_newznab_xml


_SECRET_KEY = 'SUPERSECRET_APIKEY_12345'

# Enclosure URL deliberately has no 'id=' so _parse_newznab_xml takes the GUID path
_XML_GUID_ITEM = '''\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="urn:toolsfor:newznab">
  <channel>
    <item>
      <title>My.Comic.001.2024.GROUP</title>
      <enclosure url="https://indexer.example.com/nzb/my-comic.nzb"
                 length="1234" type="application/x-nzb"/>
      <newznab:attr name="guid" value="guid-abc-999"/>
    </item>
  </channel>
</rss>'''

# Enclosure URL already has 'id=' — no GUID path needed, no apikey appended by us
_XML_DIRECT_ID_ITEM = '''\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="urn:toolsfor:newznab">
  <channel>
    <item>
      <title>My.Comic.001.2024.GROUP</title>
      <enclosure url="https://indexer.example.com/api?t=get&amp;id=guid-abc-999"
                 length="1234" type="application/x-nzb"/>
    </item>
  </channel>
</rss>'''


class NZBGuidUrlRedactionTests(unittest.TestCase):
    """_parse_newznab_xml must not log raw apikey when building a GUID URL."""

    def _capture_info_logs(self, xml, api_key=_SECRET_KEY):
        logged = []
        original_info = nzb_module.LOGGER.info

        def capture(fmt, *args, **kwargs):
            logged.append(fmt % args if args else fmt)

        nzb_module.LOGGER.info = capture
        try:
            _parse_newznab_xml(xml, 'TestIndexer', 'https://indexer.example.com', api_key)
        finally:
            nzb_module.LOGGER.info = original_info

        return logged

    def test_guid_url_does_not_log_apikey_value(self):
        """Constructed GUID URL must have apikey redacted before being logged."""
        logged = self._capture_info_logs(_XML_GUID_ITEM)
        guid_messages = [m for m in logged if 'GUID' in m or 'guid' in m.lower()]
        self.assertTrue(
            guid_messages,
            'Expected at least one log message about the constructed GUID URL',
        )
        for msg in guid_messages:
            self.assertNotIn(
                _SECRET_KEY, msg,
                f'apikey was exposed in GUID log: {msg!r}',
            )

    def test_guid_url_log_contains_redacted_marker(self):
        """Redacted apikey should appear as <redacted> in the log."""
        logged = self._capture_info_logs(_XML_GUID_ITEM)
        guid_messages = [m for m in logged if 'GUID' in m or 'guid' in m.lower()]
        any_redacted = any('<redacted>' in m for m in guid_messages)
        self.assertTrue(
            any_redacted,
            f'Expected "<redacted>" in GUID log messages, got: {guid_messages!r}',
        )

    def test_no_apikey_guid_url_logs_safely(self):
        """When api_key is empty, the URL has no apikey param — log is safe."""
        logged = self._capture_info_logs(_XML_GUID_ITEM, api_key='')
        guid_messages = [m for m in logged if 'GUID' in m or 'guid' in m.lower()]
        for msg in guid_messages:
            self.assertNotIn(_SECRET_KEY, msg)

    def test_direct_id_url_not_logged_with_apikey(self):
        """Items that already have 'id=' in the enclosure URL skip the GUID path."""
        logged = self._capture_info_logs(_XML_DIRECT_ID_ITEM)
        # The GUID path should NOT be taken, so no GUID log message expected
        guid_messages = [m for m in logged if 'GUID' in m]
        self.assertEqual(
            guid_messages, [],
            f'Unexpected GUID log for direct-id item: {guid_messages!r}',
        )


class NZBSearchIndexersRedactionTests(unittest.TestCase):
    """search_indexers integration: no apikey in INFO logs even via _parse_newznab_xml."""

    def test_search_indexers_info_logs_do_not_expose_apikey(self):
        """All LOGGER.info messages from search_indexers must not contain the raw apikey.

        The fake session returns GUID-type XML so that _parse_newznab_xml takes
        the GUID path and constructs a URL with the apikey.  The resulting log
        message must have the apikey redacted.
        """
        from backend.implementations.nzb_indexers import NZBIndexer, NZBIndexers

        fake_indexer = NZBIndexer(
            id=1, name='FakeNZB',
            base_url='https://nzb.example.com',
            api_key=_SECRET_KEY,
            categories='7030',
            enabled=True,
        )

        logged_info = []
        original_info = nzb_module.LOGGER.info

        def capture_info(fmt, *args, **kwargs):
            logged_info.append(fmt % args if args else fmt)

        class FakeResponse:
            ok = True
            text = _XML_GUID_ITEM
            status_code = 200

        class FakeSession:
            def get(self, url, params=None, **kwargs):
                return FakeResponse()

        original_session = nzb_module.Session
        nzb_module.LOGGER.info = capture_info
        nzb_module.Session = FakeSession
        try:
            NZBIndexers.search_indexers([fake_indexer], 'my comic')
        finally:
            nzb_module.LOGGER.info = original_info
            nzb_module.Session = original_session

        for msg in logged_info:
            self.assertNotIn(
                _SECRET_KEY, msg,
                f'apikey was exposed in INFO log: {msg!r}',
            )


if __name__ == '__main__':
    unittest.main()
