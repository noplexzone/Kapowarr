"""Regression tests for task queue admission, cancellation, and heartbeats."""

import inspect
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.features import tasks


class TaskQueueReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.handler = tasks.TaskHandler()
        self.old_class_queue = tasks.TaskHandler.queue
        self.had_instance_queue = 'queue' in self.handler.__dict__
        self.old_instance_queue = self.handler.__dict__.get('queue')
        self.handler.__dict__.pop('queue', None)
        tasks.TaskHandler.queue = []
        self.original_process_queue = tasks.TaskHandler._process_queue
        self.emit_patch = patch.object(tasks, '_emit_task_event', lambda event: None)
        self.process_patch = patch.object(
            tasks.TaskHandler, '_process_queue', lambda handler: None
        )
        self.emit_patch.start()
        self.process_patch.start()

    def tearDown(self):
        self.process_patch.stop()
        self.emit_patch.stop()
        tasks.TaskHandler.queue = self.old_class_queue
        self.handler.__dict__.pop('queue', None)
        if self.had_instance_queue:
            self.handler.__dict__['queue'] = self.old_instance_queue

    def test_singleton_task_admission_is_atomic(self):
        with ThreadPoolExecutor(max_workers=8) as executor:
            ids = list(executor.map(
                lambda _: self.handler.add(tasks.UpdateAll()),
                range(20),
            ))

        self.assertEqual(set(ids), {1})
        self.assertEqual(len(self.handler.queue), 1)
        self.assertEqual(self.handler.queue[0]['task'].action, 'update_all')

    def test_search_all_and_update_all_are_independent_singletons(self):
        self.assertEqual(self.handler.add(tasks.UpdateAll()), 1)
        self.assertEqual(self.handler.add(tasks.SearchAll()), 2)
        self.assertEqual(self.handler.add(tasks.UpdateAll()), 1)
        self.assertEqual(self.handler.add(tasks.SearchAll()), 2)
        self.assertEqual(
            [entry['task'].action for entry in self.handler.queue],
            ['update_all', 'search_all'],
        )

    def test_queued_task_removal_does_not_join_unstarted_thread(self):
        task_id = self.handler.add(tasks.UpdateAll())
        thread = self.handler.queue[0]['thread']

        self.handler.remove(task_id)

        self.assertFalse(thread.is_alive())
        self.assertEqual(self.handler.queue, [])

    def test_running_cancellable_task_gets_bounded_stop_request(self):
        task = tasks.UpdateAll()
        joins = []

        class FakeThread:
            def is_alive(self):
                return False

            def join(self, timeout=None):
                joins.append(timeout)

        entry = {
            'task': task,
            'id': 7,
            'status': 'running',
            'queued_at': 1,
            'started_at': 2,
            'thread': FakeThread(),
        }
        self.handler.queue.append(entry)

        self.handler.remove(7)
        self.handler.remove(7)

        self.assertTrue(task.stop)
        self.assertEqual(entry['status'], 'cancelling')
        self.assertIn(entry, self.handler.queue)
        self.assertEqual(joins, [5, 5])

    def test_cancelling_head_is_not_started_again(self):
        starts = []

        class FakeThread:
            def start(self):
                starts.append(True)

        self.handler.queue.append({
            'task': tasks.UpdateAll(),
            'id': 8,
            'status': 'cancelling',
            'queued_at': 1,
            'started_at': 2,
            'thread': FakeThread(),
        })

        self.original_process_queue(self.handler)

        self.assertEqual(starts, [])
        self.assertEqual(self.handler.queue[0]['status'], 'cancelling')

    def test_update_all_passes_cancellation_and_updates_heartbeat(self):
        captured = {}

        def fake_refresh_and_scan(**kwargs):
            captured.update(kwargs)
            kwargs['on_progress'](3, 10, 'scanning_files')

        with patch.object(tasks, 'refresh_and_scan', fake_refresh_and_scan):
            task = tasks.UpdateAll()
            task.run()

        self.assertTrue(callable(captured['stop_fn']))
        self.assertFalse(captured['stop_fn']())
        self.assertEqual(task.processed_count, 3)
        self.assertEqual(task.total_count, 10)
        self.assertEqual(task.phase, 'scanning_files')
        self.assertIsNotNone(task.last_progress_at)

    def test_search_all_stops_after_inflight_search_returns(self):
        calls = []

        class FakeCursor:
            def execute(self, *args, **kwargs):
                return self

            def __iter__(self):
                return iter(((1, 'First'), (2, 'Second')))

        task = tasks.SearchAll()

        def fake_auto_search(volume_id, **kwargs):
            calls.append(volume_id)
            task.stop = True
            return []

        with patch.object(tasks, 'get_db', lambda **kwargs: FakeCursor()), \
                patch.object(tasks, 'auto_search', fake_auto_search):
            task.run()

        self.assertEqual(calls, [1])


    def test_refresh_and_scan_volume_exposes_file_scan_progress(self):
        captured = {}

        def fake_refresh_and_scan(volume_id, **kwargs):
            captured['volume_id'] = volume_id
            captured.update(kwargs)
            kwargs['on_file_progress'](4, 168, '/content/Strange Tales (1951)/Strange Tales 004.cbz')

        class FakeVolumeData:
            title = 'Strange Tales'

        class FakeVolume:
            def __init__(self, volume_id):
                self.vd = FakeVolumeData()

        with patch.object(tasks, 'refresh_and_scan', fake_refresh_and_scan), \
                patch.object(tasks, 'Volume', FakeVolume):
            task = tasks.RefreshAndScanVolume(1141)
            task.run()

        self.assertEqual(captured['volume_id'], 1141)
        self.assertTrue(captured['update_websocket'])
        self.assertEqual(task.processed_count, 4)
        self.assertEqual(task.total_count, 168)
        self.assertEqual(task.phase, 'scanning_files')
        self.assertEqual(task.current_file, 'Strange Tales 004.cbz')
        self.assertEqual(task.message, 'Scanning 4/168 Strange Tales')

    def test_format_entry_exposes_refresh_and_scan_progress(self):
        class FakeThread:
            def is_alive(self):
                return True

        task = tasks.RefreshAndScanVolume(1141, new_title='Strange Tales')
        task.processed_count = 7
        task.total_count = 168
        task.phase = 'scanning_files'
        task.current_file = 'Strange Tales 007.cbz'
        task.last_progress_at = 1000
        entry = {
            'task': task,
            'id': 9,
            'status': 'running',
            'queued_at': 900,
            'started_at': 950,
            'thread': FakeThread(),
        }

        class FakeCursor:
            def execute(self, *args, **kwargs):
                return self

            def fetchone(self):
                return {'title': 'Strange Tales'}

        with patch.object(tasks, 'get_db', lambda **kwargs: FakeCursor()), \
                patch.object(tasks, 'time', lambda: 1012):
            formatted = self.handler._TaskHandler__format_entry(entry)

        self.assertEqual(formatted['message'], '')
        self.assertEqual(formatted['volume_title'], 'Strange Tales')
        self.assertEqual(formatted['progress']['processed_count'], 7)
        self.assertEqual(formatted['progress']['total_count'], 168)
        self.assertEqual(formatted['progress']['phase'], 'scanning_files')
        self.assertEqual(formatted['progress']['current_file'], 'Strange Tales 007.cbz')
        self.assertEqual(formatted['progress']['seconds_since_progress'], 12)

    def test_bulk_scan_disables_per_volume_unmatched_cleanup(self):
        from backend.implementations import volumes

        source = inspect.getsource(volumes.refresh_and_scan)
        self.assertIn('(v[0], [], False, update_websocket)', source)
        self.assertEqual(source.count('FilesDB.delete_unmatched_files()'), 1)


if __name__ == '__main__':
    unittest.main()
