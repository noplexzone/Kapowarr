import unittest

from backend.features import tasks


class _NoopWebSocket:
    def emit(self, event):
        return None


class _FakeCursorRows:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, *a, **kw):
        return self

    def __iter__(self):
        return iter(self._rows)

    def fetchone(self):
        return None


class SearchAllBatchingTests(unittest.TestCase):
    def _run_with_volumes(self, volumes, **kwargs):
        """Run SearchAll against a fixed volume list; return (task, calls)."""
        original_get_db = tasks.get_db
        original_auto_search = tasks.auto_search
        original_websocket = tasks.WebSocket

        calls = []

        def fake_auto_search(volume_id, _stats=None, **kw):
            calls.append(volume_id)
            if _stats is not None:
                _stats['total_found'] = 0
            return []

        try:
            tasks.get_db = lambda force_new=False: _FakeCursorRows(volumes)
            tasks.auto_search = fake_auto_search
            tasks.WebSocket = _NoopWebSocket
            task = tasks.SearchAll(**kwargs)
            task.run()
        finally:
            tasks.get_db = original_get_db
            tasks.auto_search = original_auto_search
            tasks.WebSocket = original_websocket

        return task, calls

    def test_search_all_no_limit_processes_all_volumes(self):
        volumes = [(1, 'V1'), (2, 'V2'), (3, 'V3')]
        _, calls = self._run_with_volumes(volumes)
        self.assertEqual(calls, [1, 2, 3])

    def test_search_all_limit_restricts_volumes_processed(self):
        """SearchAll(limit=N) should process at most N volumes."""
        volumes = [(i, f'Vol {i}') for i in range(1, 6)]
        _, calls = self._run_with_volumes(volumes, limit=3)
        self.assertEqual(calls, [1, 2, 3])

    def test_search_all_limit_zero_processes_nothing(self):
        volumes = [(1, 'V1'), (2, 'V2')]
        _, calls = self._run_with_volumes(volumes, limit=0)
        self.assertEqual(calls, [])

    def test_search_all_limit_larger_than_library_processes_all(self):
        volumes = [(1, 'V1'), (2, 'V2')]
        _, calls = self._run_with_volumes(volumes, limit=100)
        self.assertEqual(calls, [1, 2])

    def test_search_all_offset_skips_first_n_volumes(self):
        volumes = [(1, 'V1'), (2, 'V2'), (3, 'V3'), (4, 'V4')]
        _, calls = self._run_with_volumes(volumes, offset=2)
        self.assertEqual(calls, [3, 4])

    def test_search_all_offset_and_limit_combined(self):
        volumes = [(i, f'Vol {i}') for i in range(1, 8)]
        _, calls = self._run_with_volumes(volumes, offset=2, limit=3)
        self.assertEqual(calls, [3, 4, 5])


class SearchAllProgressStateTests(unittest.TestCase):
    def test_search_all_exposes_total_count_after_run(self):
        """total_count should equal the number of volumes queried."""
        original_get_db = tasks.get_db
        original_auto_search = tasks.auto_search
        original_websocket = tasks.WebSocket

        def fake_auto_search(volume_id, _stats=None, **kw):
            if _stats is not None:
                _stats['total_found'] = 0
            return []

        try:
            tasks.get_db = lambda force_new=False: _FakeCursorRows(
                [(1, 'V1'), (2, 'V2'), (3, 'V3')]
            )
            tasks.auto_search = fake_auto_search
            tasks.WebSocket = _NoopWebSocket
            task = tasks.SearchAll()
            task.run()
        finally:
            tasks.get_db = original_get_db
            tasks.auto_search = original_auto_search
            tasks.WebSocket = original_websocket

        self.assertEqual(task.total_count, 3)
        self.assertEqual(task.processed_count, 3)

    def test_search_all_processed_count_with_limit(self):
        original_get_db = tasks.get_db
        original_auto_search = tasks.auto_search
        original_websocket = tasks.WebSocket

        def fake_auto_search(volume_id, _stats=None, **kw):
            if _stats is not None:
                _stats['total_found'] = 0
            return []

        try:
            tasks.get_db = lambda force_new=False: _FakeCursorRows(
                [(i, f'Vol {i}') for i in range(1, 6)]
            )
            tasks.auto_search = fake_auto_search
            tasks.WebSocket = _NoopWebSocket
            task = tasks.SearchAll(limit=2)
            task.run()
        finally:
            tasks.get_db = original_get_db
            tasks.auto_search = original_auto_search
            tasks.WebSocket = original_websocket

        self.assertEqual(task.total_count, 2)
        self.assertEqual(task.processed_count, 2)

    def test_search_all_processed_count_increments_past_failures(self):
        """processed_count should increment even when a volume raises."""
        original_get_db = tasks.get_db
        original_auto_search = tasks.auto_search
        original_websocket = tasks.WebSocket

        def fake_auto_search(volume_id, _stats=None, **kw):
            if _stats is not None:
                _stats['total_found'] = 0
            if volume_id == 2:
                raise RuntimeError('boom')
            return []

        try:
            tasks.get_db = lambda force_new=False: _FakeCursorRows(
                [(1, 'V1'), (2, 'V2'), (3, 'V3')]
            )
            tasks.auto_search = fake_auto_search
            tasks.WebSocket = _NoopWebSocket
            task = tasks.SearchAll()
            task.run()
        finally:
            tasks.get_db = original_get_db
            tasks.auto_search = original_auto_search
            tasks.WebSocket = original_websocket

        self.assertEqual(task.total_count, 3)
        self.assertEqual(task.processed_count, 3)


class SearchAllFormatProgressTests(unittest.TestCase):
    def test_format_entry_includes_progress_for_search_all_task(self):
        """TaskHandler.__format_entry should include a progress dict for SearchAll."""
        original_get_db = tasks.get_db

        class _FakeCursor:
            def execute(self, *a, **kw):
                return self
            def fetchone(self):
                return None

        try:
            tasks.get_db = lambda *a, **kw: _FakeCursor()
            task = tasks.SearchAll()
            task.processed_count = 7
            task.total_count = 20

            entry = {
                'task': task,
                'id': 42,
                'status': 'running',
                'queued_at': 1000,
                'started_at': 1005,
            }
            handler = tasks.TaskHandler()
            formatted = handler._TaskHandler__format_entry(entry)
        finally:
            tasks.get_db = original_get_db

        self.assertIn('progress', formatted)
        prog = formatted['progress']
        self.assertEqual(prog['processed_count'], 7)
        self.assertEqual(prog['total_count'], 20)

    def test_format_entry_exposes_update_all_progress(self):
        """UpdateAll exposes phase, counts, and heartbeat fields."""
        original_get_db = tasks.get_db

        class _FakeCursor:
            def execute(self, *a, **kw):
                return self
            def fetchone(self):
                return None

        try:
            tasks.get_db = lambda *a, **kw: _FakeCursor()
            task = tasks.UpdateAll()
            entry = {
                'task': task,
                'id': 1,
                'status': 'queued',
                'queued_at': 100,
                'started_at': None,
            }
            handler = tasks.TaskHandler()
            formatted = handler._TaskHandler__format_entry(entry)
        finally:
            tasks.get_db = original_get_db

        self.assertIn('progress', formatted)
        self.assertEqual(formatted['progress']['processed_count'], 0)
        self.assertIsNone(formatted['progress']['phase'])
        self.assertIn('last_progress_at', formatted['progress'])
        self.assertIn('seconds_since_progress', formatted['progress'])


if __name__ == '__main__':
    unittest.main()
