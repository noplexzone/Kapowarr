"""Cancellation checkpoints for Update All metadata phases."""

import unittest
from unittest.mock import patch

from backend.implementations import volumes


class UpdateAllCancellationTests(unittest.TestCase):
    def test_pre_cancelled_refresh_does_not_touch_database(self):
        with patch.object(
            volumes,
            'get_db',
            side_effect=AssertionError('database should not be opened'),
        ):
            volumes.refresh_and_scan(stop_fn=lambda: True)

    def test_mangadex_loop_stops_between_rows(self):
        stopped = {'value': False}
        refreshed = []

        class FakeCursor:
            def execute(self, *args, **kwargs):
                return self

            def fetchalldict(self):
                return [
                    {'id': 1, 'metadata_id': 'one'},
                    {'id': 2, 'metadata_id': 'two'},
                ]

        def fake_refresh(row, *args, **kwargs):
            refreshed.append(row['id'])
            stopped['value'] = True

        with patch.object(volumes, 'get_db', return_value=FakeCursor()), \
                patch.object(
                    volumes,
                    '_refresh_mangadex_metadata_row',
                    fake_refresh,
                ):
            volumes.refresh_and_scan(
                stop_fn=lambda: stopped['value'],
                allow_skipping=False,
            )

        self.assertEqual(refreshed, [1])


if __name__ == '__main__':
    unittest.main()
