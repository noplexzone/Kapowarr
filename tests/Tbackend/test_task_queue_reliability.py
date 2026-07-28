"""Regression tests for task queue admission, cancellation, and heartbeats."""

from concurrent.futures import ThreadPoolExecutor

from backend.features import tasks


def _isolated_handler(monkeypatch):
    handler = tasks.TaskHandler()
    monkeypatch.setattr(handler, 'queue', [])
    monkeypatch.setattr(tasks, '_emit_task_event', lambda event: None)
    monkeypatch.setattr(tasks.TaskHandler, '_process_queue', lambda self: None)
    return handler


def test_singleton_task_admission_is_atomic(monkeypatch):
    handler = _isolated_handler(monkeypatch)

    with ThreadPoolExecutor(max_workers=8) as executor:
        ids = list(executor.map(lambda _: handler.add(tasks.UpdateAll()), range(20)))

    assert set(ids) == {1}
    assert len(handler.queue) == 1
    assert handler.queue[0]['task'].action == 'update_all'


def test_search_all_and_update_all_are_independent_singletons(monkeypatch):
    handler = _isolated_handler(monkeypatch)

    assert handler.add(tasks.UpdateAll()) == 1
    assert handler.add(tasks.SearchAll()) == 2
    assert handler.add(tasks.UpdateAll()) == 1
    assert handler.add(tasks.SearchAll()) == 2
    assert [entry['task'].action for entry in handler.queue] == [
        'update_all', 'search_all'
    ]


def test_queued_task_removal_does_not_join_unstarted_thread(monkeypatch):
    handler = _isolated_handler(monkeypatch)
    task_id = handler.add(tasks.UpdateAll())
    thread = handler.queue[0]['thread']

    handler.remove(task_id)

    assert not thread.is_alive()
    assert handler.queue == []


def test_running_cancellable_task_gets_bounded_stop_request(monkeypatch):
    handler = _isolated_handler(monkeypatch)
    task = tasks.UpdateAll()
    joins = []

    class FakeThread:
        def is_alive(self):
            return False

        def join(self, timeout=None):
            joins.append(timeout)

    handler.queue.append({
        'task': task,
        'id': 7,
        'status': 'running',
        'queued_at': 1,
        'started_at': 2,
        'thread': FakeThread(),
    })

    handler.remove(7)

    assert task.stop is True
    assert joins == [5]


def test_update_all_passes_cancellation_and_updates_heartbeat(monkeypatch):
    captured = {}

    def fake_refresh_and_scan(**kwargs):
        captured.update(kwargs)
        kwargs['on_progress'](3, 10, 'scanning_files')

    monkeypatch.setattr(tasks, 'refresh_and_scan', fake_refresh_and_scan)
    monkeypatch.setattr(tasks, '_emit_task_event', lambda event: None)
    task = tasks.UpdateAll()
    task.run()

    assert callable(captured['stop_fn'])
    assert captured['stop_fn']() is False
    assert task.processed_count == 3
    assert task.total_count == 10
    assert task.phase == 'scanning_files'
    assert task.last_progress_at is not None


def test_bulk_scan_disables_per_volume_unmatched_cleanup():
    import inspect
    from backend.implementations import volumes

    source = inspect.getsource(volumes.refresh_and_scan)
    assert '(v[0], [], False, update_websocket)' in source
    assert source.count('FilesDB.delete_unmatched_files()') == 1
