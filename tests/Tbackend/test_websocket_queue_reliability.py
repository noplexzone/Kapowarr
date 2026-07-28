"""Regression tests for bounded multiprocessing WebSocket delivery."""

from queue import Full

from backend.internals.server import MPWebSocketQueue


class _FullQueue:
    def put_nowait(self, data):
        raise Full

    def get(self):
        raise AssertionError('listener is not used in this test')


def test_publish_drops_immediately_when_queue_is_full():
    manager = MPWebSocketQueue(_FullQueue(), write_only=True)

    assert manager._publish({'method': 'emit'}) is False
    assert manager._dropped_events == 1


def test_publish_uses_nonblocking_queue_operation():
    calls = []

    class RecordingQueue:
        def put_nowait(self, data):
            calls.append(data)

        def get(self):
            raise AssertionError('listener is not used in this test')

    manager = MPWebSocketQueue(RecordingQueue(), write_only=True)
    payload = {'method': 'emit'}

    assert manager._publish(payload) is True
    assert calls == [payload]


def test_publish_drops_when_queue_is_closed():
    class ClosedQueue:
        def put_nowait(self, data):
            raise ValueError('queue is closed')

        def get(self):
            raise AssertionError('listener is not used in this test')

    manager = MPWebSocketQueue(ClosedQueue(), write_only=True)

    assert manager._publish({'method': 'emit'}) is False
    assert manager._dropped_events == 1
