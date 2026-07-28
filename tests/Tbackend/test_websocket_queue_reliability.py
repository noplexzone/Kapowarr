"""Regression tests for bounded multiprocessing WebSocket delivery."""

import unittest
from multiprocessing import get_context
from queue import Full

from backend.internals.server import MPWebSocketQueue


class _FullQueue:
    def put_nowait(self, data):
        raise Full

    def get(self):
        raise AssertionError('listener is not used in this test')


def _publish_from_spawned_process(queue, result_pipe):
    manager = MPWebSocketQueue(queue, write_only=True)
    result_pipe.send(manager._publish({'method': 'emit'}))
    result_pipe.close()


class WebSocketQueueReliabilityTests(unittest.TestCase):
    def test_publish_drops_immediately_when_queue_is_full(self):
        manager = MPWebSocketQueue(_FullQueue(), write_only=True)

        self.assertFalse(manager._publish({'method': 'emit'}))
        self.assertEqual(manager._dropped_events, 1)

    def test_publish_uses_nonblocking_queue_operation(self):
        calls = []

        class RecordingQueue:
            def put_nowait(self, data):
                calls.append(data)

            def get(self):
                raise AssertionError('listener is not used in this test')

        manager = MPWebSocketQueue(RecordingQueue(), write_only=True)
        payload = {'method': 'emit'}

        self.assertTrue(manager._publish(payload))
        self.assertEqual(calls, [payload])

    def test_publish_drops_when_queue_is_closed(self):
        class ClosedQueue:
            def put_nowait(self, data):
                raise ValueError('queue is closed')

            def get(self):
                raise AssertionError('listener is not used in this test')

        manager = MPWebSocketQueue(ClosedQueue(), write_only=True)

        self.assertFalse(manager._publish({'method': 'emit'}))
        self.assertEqual(manager._dropped_events, 1)

    def test_real_bounded_queue_is_spawn_compatible(self):
        context = get_context('spawn')
        queue = context.Queue(maxsize=1)
        queue.put_nowait({'method': 'already-full'})
        result_pipe, child_pipe = context.Pipe(duplex=False)
        process = context.Process(
            target=_publish_from_spawned_process,
            args=(queue, child_pipe),
        )
        process.start()
        process.join(10)
        if process.is_alive():
            process.terminate()
            process.join(5)
            self.fail('spawned websocket publisher did not exit')

        self.assertEqual(process.exitcode, 0)
        self.assertFalse(result_pipe.recv())
        queue.close()
        queue.cancel_join_thread()



if __name__ == '__main__':
    unittest.main()
