import unittest
from unittest.mock import MagicMock, patch

from backend.features.download_queue import get_download_history


class DownloadHistoryOrderingTests(unittest.TestCase):
    def test_all_history_scopes_use_rowid_as_timestamp_tie_breaker(self):
        for kwargs in ({}, {'volume_id': 3}, {'issue_id': 7}):
            db = MagicMock()
            db.execute.return_value.fetchalldict.return_value = []
            with patch('backend.features.download_queue.get_db', return_value=db):
                get_download_history(**kwargs)

            query = db.execute.call_args.args[0]
            self.assertIn('ORDER BY downloaded_at DESC, rowid DESC', query)


if __name__ == '__main__':
    unittest.main()
