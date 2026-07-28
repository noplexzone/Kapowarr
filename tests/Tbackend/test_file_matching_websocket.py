"""Regression tests for best-effort file-scan websocket notifications."""

import inspect
import unittest
from unittest.mock import patch

from backend.implementations import file_matching


class FileMatchingWebSocketTests(unittest.TestCase):
    def test_downloaded_status_emit_errors_do_not_escape(self):
        calls = []

        class FailingWebSocket:
            def emit(self, event):
                calls.append(event)
                raise RuntimeError('simulated websocket failure')

        event = file_matching.DownloadedStatusEvent(
            1214, downloaded_issues=[33218]
        )
        with patch.object(file_matching, 'WebSocket', FailingWebSocket):
            file_matching._emit_downloaded_status_event(event)

        self.assertEqual(calls, [event])

    def test_scan_files_uses_best_effort_downloaded_status_helper(self):
        source = inspect.getsource(file_matching.scan_files)

        self.assertIn(
            '_emit_downloaded_status_event(DownloadedStatusEvent(',
            source,
        )
        self.assertNotIn(
            'WebSocket().emit(DownloadedStatusEvent(',
            source,
        )


if __name__ == '__main__':
    unittest.main()
