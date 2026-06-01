import json
import unittest

from backend.features import tasks


class _NoopWebSocket:
    def emit(self, event):
        return None


class SearchAllResilienceTests(unittest.TestCase):
    def test_search_all_continues_after_volume_failure_and_records_details(self):
        original_get_db = tasks.get_db
        original_auto_search = tasks.auto_search
        original_websocket = tasks.WebSocket

        class FakeCursor:
            def execute(self, *args, **kwargs):
                return self

            def __iter__(self):
                return iter(((1, 'Good Volume'), (2, 'Bad Volume'), (3, 'Later Volume')))

        calls = []

        def fake_auto_search(volume_id, _stats=None, **kwargs):
            calls.append(volume_id)
            if _stats is not None:
                _stats['total_found'] = volume_id
                _stats['per_issue'].append({'volume_id': volume_id})
            if volume_id == 2:
                raise RuntimeError('boom')
            return [{
                'link': f'https://example.test/{volume_id}',
                'display_title': f'Download {volume_id}',
            }]

        try:
            tasks.get_db = lambda force_new=False: FakeCursor()
            tasks.auto_search = fake_auto_search
            tasks.WebSocket = _NoopWebSocket

            task = tasks.SearchAll()
            downloads = task.run()
        finally:
            tasks.get_db = original_get_db
            tasks.auto_search = original_auto_search
            tasks.WebSocket = original_websocket

        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(
            downloads,
            [
                ('https://example.test/1', 1, None, 'Download 1'),
                ('https://example.test/3', 3, None, 'Download 3'),
            ]
        )
        self.assertEqual(len(task.details['per_volume']), 3)
        failed = task.details['per_volume'][1]
        self.assertFalse(failed['success'])
        self.assertEqual(failed['error'], 'RuntimeError')
        self.assertEqual(failed['message'], 'boom')


class TaskHistoryFailureTests(unittest.TestCase):
    def test_task_handler_records_failed_task_history(self):
        original_get_db = tasks.get_db
        original_websocket = tasks.WebSocket
        original_sleep = tasks.sleep
        original_process_queue = tasks.TaskHandler._process_queue
        original_queue = tasks.TaskHandler.queue

        inserts = []

        class FakeCursor:
            connection = None

            def execute(self, query, params=()):
                if 'INSERT INTO task_history' in query:
                    inserts.append(params)
                return self

            def fetchone(self):
                return [1]

        class FailingTask:
            stop = False
            message = ''
            action = 'failing_task'
            display_title = 'Failing Task'
            category = ''
            details = {'per_issue': [{'issue': 1}], 'downloads': []}

            @property
            def volume_id(self):
                return 123

            @property
            def issue_id(self):
                return None

            def run(self):
                raise ValueError('bad task')

        try:
            tasks.get_db = lambda *args, **kwargs: FakeCursor()
            tasks.WebSocket = _NoopWebSocket
            tasks.sleep = lambda seconds: None
            tasks.TaskHandler._process_queue = lambda self: None
            task = FailingTask()
            tasks.TaskHandler.queue = [{
                'task': task,
                'queued_at': 10,
                'started_at': 20,
            }]

            handler = tasks.TaskHandler()
            handler._TaskHandler__run_task(task)
        finally:
            tasks.get_db = original_get_db
            tasks.WebSocket = original_websocket
            tasks.sleep = original_sleep
            tasks.TaskHandler._process_queue = original_process_queue
            tasks.TaskHandler.queue = original_queue

        self.assertEqual(len(inserts), 1)
        params = inserts[0]
        self.assertEqual(params[0], 'failing_task')
        self.assertEqual(params[1], 'Failing Task')
        self.assertEqual(params[3], 10)
        self.assertEqual(params[4], 20)
        self.assertEqual(params[5], 123)
        details = json.loads(params[7])
        self.assertFalse(details['success'])
        self.assertEqual(details['error'], 'ValueError')
        self.assertEqual(details['message'], 'bad task')
        self.assertEqual(details['per_issue'], [{'issue': 1}])


if __name__ == '__main__':
    unittest.main()
