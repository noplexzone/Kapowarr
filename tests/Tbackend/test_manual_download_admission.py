"""SQLite contention handling for manual-download admission."""

import asyncio
import unittest
from sqlite3 import OperationalError, SQLITE_BUSY
from threading import Event, RLock, Thread
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.features import tasks
from backend.base.definitions import EnqueuingDownloadFailureReason
from backend.features.download_queue import DownloadHandler


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
    def __init__(
        self, failures, error_message='database is locked', error_code=None
    ):
        self.failures = failures
        self.error_message = error_message
        self.error_code = error_code
        self.insert_attempts = 0
        self.connection = _Connection()

    def execute(self, sql, params=()):
        if 'SELECT title FROM volumes' in sql:
            return _Cursor({'title': 'Series'})
        if 'INSERT INTO task_history' in sql:
            self.insert_attempts += 1
            if self.insert_attempts <= self.failures:
                error = OperationalError(self.error_message)
                if self.error_code is not None:
                    error.sqlite_errorcode = self.error_code
                raise error
            return _Cursor(lastrowid=42, connection=self.connection)
        if 'last_insert_rowid' in sql:
            return _Cursor((999,))
        raise AssertionError(sql)


class _CommitContendedDB:
    """Model an INSERT that succeeds before its first commit returns BUSY."""
    def __init__(self):
        self.insert_attempts = 0
        self.pending = []
        self.committed = []
        self.connection = _CommitConnection(self)

    def execute(self, sql, params=()):
        if 'SELECT title FROM volumes' in sql:
            return _Cursor({'title': 'Series'})
        if 'INSERT INTO task_history' in sql:
            self.insert_attempts += 1
            row_id = 40 + self.insert_attempts
            self.pending.append(row_id)
            self.connection.in_transaction = True
            return _Cursor(lastrowid=row_id, connection=self.connection)
        raise AssertionError(sql)


class _CommitConnection(_Connection):
    def __init__(self, db):
        super().__init__()
        self.db = db

    def commit(self):
        self.commits += 1
        if self.commits == 1:
            error = OperationalError('resource unavailable')
            error.sqlite_errorcode = SQLITE_BUSY
            raise error
        self.db.committed.extend(self.db.pending)
        self.db.pending.clear()
        self.in_transaction = False

    def rollback(self):
        super().rollback()
        self.db.pending.clear()
        self.in_transaction = False


class ManualDownloadAdmissionTest(unittest.TestCase):
    def _run(self, db):
        handler = SimpleNamespace()

        async def add(*args, **kwargs):
            handler.call = (args, kwargs)
            return [object()], None

        handler._add_reserved = add
        handler.reserve_link = lambda link: True
        handler.release_link = lambda link: None
        batch = MagicMock()
        with patch.object(tasks, 'get_db', return_value=db),                 patch.object(tasks, 'DownloadHandler', return_value=handler),                 patch.object(tasks, 'DownloadBatch', batch),                 patch.object(tasks, 'sleep') as sleep_mock, \
                patch.object(tasks, 'uniform', return_value=0.025):
            result = tasks.record_and_track_download(
                'https://example.invalid/download', 1, 2, False, 'Title',
            )
        return result, handler, batch, sleep_mock

    def test_locked_insert_retries_then_queues_with_insert_cursor_id(self):
        db = _ContendedDB(failures=2)
        result, handler, batch, sleep_mock = self._run(db)

        self.assertEqual(db.insert_attempts, 3)
        self.assertEqual(db.connection.commits, 1)
        self.assertEqual(sleep_mock.call_args_list[0].args[0], 0.125)
        self.assertEqual(sleep_mock.call_args_list[1].args[0], 0.225)
        self.assertEqual(handler.call[1]['task_history_id'], 42)
        batch.register.assert_called_once_with(
            42, 1, 1, 'Series', update_existing=True,
        )
        self.assertEqual(len(result[0]), 1)

    def test_lock_retries_are_bounded_and_do_not_queue(self):
        db = _ContendedDB(failures=99)
        with patch.object(tasks, 'get_db', return_value=db),                 patch.object(tasks, 'DownloadHandler') as handler_factory,                 patch.object(tasks, 'sleep') as sleep_mock:
            handler_factory.return_value.reserve_link.return_value = True
            with self.assertRaises(OperationalError):
                tasks.record_and_track_download('x', 1, None, False)
        self.assertEqual(db.insert_attempts, 4)
        self.assertEqual(sleep_mock.call_count, 3)
        handler = handler_factory.return_value
        handler._add_reserved.assert_not_called()
        handler.release_link.assert_called_once_with('x')

    def test_sqlite_busy_error_code_retries_without_message_match(self):
        db = _ContendedDB(
            failures=1, error_message='resource unavailable', error_code=5,
        )
        result, _, _, sleep_mock = self._run(db)
        self.assertEqual(db.insert_attempts, 2)
        self.assertEqual(sleep_mock.call_count, 1)
        self.assertEqual(len(result[0]), 1)

    def test_queue_exception_records_meaningful_admission_failure(self):
        db = _ContendedDB(failures=0)
        handler = SimpleNamespace()

        async def add(*args, **kwargs):
            raise RuntimeError('upstream secret detail')

        handler._add_reserved = add
        handler.reserve_link = lambda link: True
        handler.release_link = lambda link: None
        batch = MagicMock()
        with patch.object(tasks, 'get_db', return_value=db), \
                patch.object(tasks, 'DownloadHandler', return_value=handler), \
                patch.object(tasks, 'DownloadBatch', batch):
            with self.assertRaises(RuntimeError):
                tasks.record_and_track_download('x', 1, 2, False)
        batch.register.assert_called_once_with(
            42, 1, 1, 'Series', update_existing=True,
        )
        batch.record.assert_called_once_with(
            42, 'x', False, 'Admission failed: RuntimeError',
        )

    def test_commit_busy_rolls_back_before_retrying_insert(self):
        db = _CommitContendedDB()
        result, handler, _, sleep_mock = self._run(db)

        self.assertEqual(db.insert_attempts, 2)
        self.assertEqual(db.connection.rollbacks, 1)
        self.assertEqual(db.committed, [42])
        self.assertEqual(handler.call[1]['task_history_id'], 42)
        self.assertEqual(sleep_mock.call_count, 1)
        self.assertEqual(len(result[0]), 1)

    def test_duplicate_reservation_creates_no_history_row(self):
        handler = MagicMock()
        handler.reserve_link.return_value = False
        with patch.object(tasks, 'DownloadHandler', return_value=handler), \
                patch.object(tasks, 'get_db') as get_db_mock:
            result = tasks.record_and_track_download('same-link', 1, 2, False)

        self.assertEqual(result, ([], EnqueuingDownloadFailureReason.ALREADY_QUEUED))
        get_db_mock.assert_not_called()
        handler.release_link.assert_not_called()

    def test_concurrent_same_link_admission_runs_inner_path_once(self):
        handler = DownloadHandler.__new__(DownloadHandler)
        handler.queue = []
        handler._admission_lock = RLock()
        handler._admitting_links = set()
        entered = Event()
        release = Event()
        calls = []
        results = []

        async def inner(*args, **kwargs):
            calls.append(args[0])
            entered.set()
            release.wait(timeout=2)
            return [{'id': 1}], None

        handler._add_reserved = inner

        def run_add():
            results.append(asyncio.run(handler.add('same-link', 1)))

        worker = Thread(target=run_add)
        worker.start()
        self.assertTrue(entered.wait(timeout=2))
        duplicate = asyncio.run(handler.add('same-link', 1))
        release.set()
        worker.join(timeout=2)

        self.assertEqual(calls, ['same-link'])
        self.assertEqual(len(results), 1)
        self.assertEqual(duplicate, ([], EnqueuingDownloadFailureReason.ALREADY_QUEUED))
        self.assertNotIn('same-link', handler._admitting_links)

    def test_non_lock_operational_error_is_not_retried(self):
        db = _ContendedDB(failures=99, error_message='disk I/O error')
        with patch.object(tasks, 'get_db', return_value=db),                 patch.object(tasks, 'DownloadHandler') as handler_factory,                 patch.object(tasks, 'sleep') as sleep_mock:
            handler_factory.return_value.reserve_link.return_value = True
            with self.assertRaises(OperationalError):
                tasks.record_and_track_download('x', 1, None, False)
        self.assertEqual(db.insert_attempts, 1)
        sleep_mock.assert_not_called()
        handler_factory.return_value._add_reserved.assert_not_called()
        handler_factory.return_value.release_link.assert_called_once_with('x')


if __name__ == '__main__':
    unittest.main()
