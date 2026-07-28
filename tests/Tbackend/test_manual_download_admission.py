"""SQLite contention handling for manual-download admission."""

import unittest
from sqlite3 import OperationalError
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.features import tasks


class _Cursor:
    def __init__(self, row=None, lastrowid=None, connection=None):
        self._row = row
        self.lastrowid = lastrowid
        self.connection = connection

    def fetchone(self):
        return self._row


class _Connection:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0
        self.in_transaction = False

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class _ContendedDB:
    def __init__(self, failures, error_message='database is locked'):
        self.failures = failures
        self.error_message = error_message
        self.insert_attempts = 0
        self.connection = _Connection()

    def execute(self, sql, params=()):
        if 'SELECT title FROM volumes' in sql:
            return _Cursor({'title': 'Series'})
        if 'INSERT INTO task_history' in sql:
            self.insert_attempts += 1
            if self.insert_attempts <= self.failures:
                raise OperationalError(self.error_message)
            return _Cursor(lastrowid=42, connection=self.connection)
        if 'last_insert_rowid' in sql:
            return _Cursor((999,))
        raise AssertionError(sql)


class ManualDownloadAdmissionTest(unittest.TestCase):
    def _run(self, db):
        handler = SimpleNamespace()

        async def add(*args, **kwargs):
            handler.call = (args, kwargs)
            return [object()], None

        handler.add = add
        batch = MagicMock()
        with patch.object(tasks, 'get_db', return_value=db),                 patch.object(tasks, 'DownloadHandler', return_value=handler),                 patch.object(tasks, 'DownloadBatch', batch),                 patch.object(tasks, 'sleep') as sleep_mock:
            result = tasks.record_and_track_download(
                'https://example.invalid/download', 1, 2, False, 'Title',
            )
        return result, handler, batch, sleep_mock

    def test_locked_insert_retries_then_queues_with_insert_cursor_id(self):
        db = _ContendedDB(failures=2)
        result, handler, batch, sleep_mock = self._run(db)

        self.assertEqual(db.insert_attempts, 3)
        self.assertEqual(db.connection.commits, 1)
        self.assertEqual(sleep_mock.call_count, 2)
        self.assertEqual(handler.call[1]['task_history_id'], 42)
        batch.register.assert_called_once_with(
            42, 1, 1, 'Series', update_existing=True,
        )
        self.assertEqual(len(result[0]), 1)

    def test_lock_retries_are_bounded_and_do_not_queue(self):
        db = _ContendedDB(failures=99)
        with patch.object(tasks, 'get_db', return_value=db),                 patch.object(tasks, 'DownloadHandler') as handler,                 patch.object(tasks, 'sleep') as sleep_mock:
            with self.assertRaises(OperationalError):
                tasks.record_and_track_download('x', 1, None, False)
        self.assertEqual(db.insert_attempts, 4)
        self.assertEqual(sleep_mock.call_count, 3)
        handler.assert_not_called()

    def test_non_lock_operational_error_is_not_retried(self):
        db = _ContendedDB(failures=99, error_message='disk I/O error')
        with patch.object(tasks, 'get_db', return_value=db),                 patch.object(tasks, 'sleep') as sleep_mock:
            with self.assertRaises(OperationalError):
                tasks.record_and_track_download('x', 1, None, False)
        self.assertEqual(db.insert_attempts, 1)
        sleep_mock.assert_not_called()


if __name__ == '__main__':
    unittest.main()
