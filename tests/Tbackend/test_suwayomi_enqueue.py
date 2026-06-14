"""Regression test: SuwayomiClient.enqueue_download must use the current
Suwayomi GraphQL schema:
  - argument:  input: {id: $id}   (not bare id: $id)
  - selection: downloadStatus { state }
"""
import unittest



def _make_client():
    """Create a SuwayomiClient without invoking Settings-backed __init__."""
    from backend.implementations.suwayomi import SuwayomiClient
    return SuwayomiClient.__new__(SuwayomiClient)


class EnqueueDownloadSchemaTest(unittest.TestCase):
    def setUp(self):
        self.client = _make_client()

    def _capture_gql_call(self, chapter_id=42):
        calls = []

        def fake_gql(query, variables=None):
            calls.append((query, variables or {}))
            return {}

        self.client._gql = fake_gql
        self.client.enqueue_download(chapter_id)
        self.assertEqual(len(calls), 1, "expected exactly one _gql call")
        return calls[0]

    def test_uses_input_wrapper(self):
        query, _ = self._capture_gql_call()
        self.assertIn(
            "input: {id: $id}",
            query.replace("\n", " ").replace("  ", " "),
            "mutation must pass argument as input: {id: $id}",
        )

    def test_does_not_use_bare_id_arg(self):
        query, _ = self._capture_gql_call()
        # The bare form looks like "enqueueChapterDownload(id:" — must not appear
        import re
        bare = re.search(r"enqueueChapterDownload\s*\(\s*id\s*:", query)
        self.assertIsNone(bare, "must not use bare 'id:' argument form")

    def test_selects_download_status_state(self):
        query, _ = self._capture_gql_call()
        self.assertIn("downloadStatus", query)
        self.assertIn("state", query)

    def test_passes_chapter_id_in_variables(self):
        _, variables = self._capture_gql_call(chapter_id=99)
        self.assertEqual(variables.get("id"), 99)
