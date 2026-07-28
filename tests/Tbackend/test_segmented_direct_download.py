"""Regression tests for validated segmented direct downloads."""

import os
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Lock, Thread
from time import perf_counter
from unittest.mock import MagicMock, patch


class FakeResponse:
    def __init__(self, body=b'', status_code=206, headers=None):
        self.body = body
        self.status_code = status_code
        self.headers = headers or {}
        self.closed = False
        self.raw = MagicMock()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def close(self):
        self.closed = True

    def raise_for_status(self):
        if self.status_code >= 400:
            from requests import HTTPError
            raise HTTPError(response=self)

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.body), chunk_size):
            yield self.body[offset:offset + chunk_size]


class SegmentedDirectDownloadTest(unittest.TestCase):
    def test_build_byte_ranges_cover_file_without_overlap(self):
        from backend.implementations.download_clients import _build_byte_ranges

        self.assertEqual(
            _build_byte_ranges(10, 4),
            [(0, 2), (3, 5), (6, 7), (8, 9)]
        )

    def test_only_large_direct_downloads_probe_for_segmentation(self):
        from backend.implementations.download_clients import (
            BaseDirectDownload,
            DirectDownload,
            SEGMENTED_DOWNLOAD_MIN_SIZE,
        )

        def fake_base_init(download, size):
            download._size = size
            download._supports_range_header = False

        with patch.object(BaseDirectDownload, '__init__', fake_base_init):
            with patch.object(
                DirectDownload,
                '_probe_range_support',
                return_value=True,
            ) as probe:
                small = DirectDownload(SEGMENTED_DOWNLOAD_MIN_SIZE - 1)
                self.assertFalse(small._supports_segmented_download)
                probe.assert_not_called()

                large = DirectDownload(SEGMENTED_DOWNLOAD_MIN_SIZE)
                self.assertTrue(large._supports_segmented_download)
                self.assertTrue(large._supports_range_header)
                probe.assert_called_once_with()

    def test_specialized_direct_clients_keep_base_run_implementation(self):
        from backend.implementations.download_clients import (
            BaseDirectDownload,
            MediaFireDownload,
            PixelDrainDownload,
            UFileDownload,
            WeTransferDownload,
        )

        for download_class in (
            MediaFireDownload,
            PixelDrainDownload,
            UFileDownload,
            WeTransferDownload,
        ):
            self.assertIs(download_class.run, BaseDirectDownload.run)

    def test_range_requests_use_bounded_network_timeout(self):
        from backend.base.definitions import Constants
        from backend.implementations import download_clients

        download = download_clients.DirectDownload.__new__(
            download_clients.DirectDownload
        )
        download._pure_link = 'https://example.test/file.zip'
        download._range_validator = '"fixture-v1"'
        session = MagicMock()
        response = FakeResponse()
        session.get.return_value = response

        with patch.object(download_clients, 'Session', return_value=session):
            result = download._open_range_response(10, 19)

        session.get.assert_called_once_with(
            download.pure_link,
            headers={
                'Accept-Encoding': 'identity',
                'Range': 'bytes=10-19',
                'If-Range': '"fixture-v1"',
            },
            stream=True,
            timeout=Constants.REQUEST_TIMEOUT,
        )
        self.assertIs(result, response)
        download._close_range_response(response)
        session.close.assert_called_once_with()

    def test_range_probe_accepts_valid_206_without_accept_ranges_header(self):
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._size = 100
        response = FakeResponse(
            body=b'x',
            status_code=206,
            headers={
                'Content-Length': '1',
                'Content-Range': 'bytes 0-0/100',
                'ETag': '"fixture-v1"',
            },
        )
        download._open_range_response = MagicMock(return_value=response)

        self.assertTrue(download._probe_range_support())
        download._open_range_response.assert_called_once_with(0, 0)
        self.assertTrue(response.closed)

    def test_range_probe_rejects_weak_etag(self):
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._size = 100
        download._range_validator = None
        response = FakeResponse(
            body=b'x',
            status_code=206,
            headers={
                'Content-Length': '1',
                'Content-Range': 'bytes 0-0/100',
                'ETag': 'W/"fixture-v1"',
            },
        )
        download._open_range_response = MagicMock(return_value=response)

        self.assertFalse(download._probe_range_support())

    def test_range_probe_rejects_malformed_strong_etag(self):
        from backend.implementations.download_clients import DirectDownload

        for etag in ('', '""', 'not-an-entity-tag', '"contains space"'):
            with self.subTest(etag=etag):
                download = DirectDownload.__new__(DirectDownload)
                download._size = 100
                download._range_validator = None
                response = FakeResponse(
                    body=b'x',
                    status_code=206,
                    headers={
                        'Content-Length': '1',
                        'Content-Range': 'bytes 0-0/100',
                        'ETag': etag,
                    },
                )
                download._open_range_response = MagicMock(
                    return_value=response
                )
                self.assertFalse(download._probe_range_support())

    def test_range_probe_rejects_response_without_representation_validator(self):
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._size = 100
        download._range_validator = None
        response = FakeResponse(
            body=b'x',
            status_code=206,
            headers={
                'Content-Length': '1',
                'Content-Range': 'bytes 0-0/100',
            },
        )
        download._open_range_response = MagicMock(return_value=response)

        self.assertFalse(download._probe_range_support())

    def test_range_validation_rejects_content_encoding(self):
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._size = 100
        download._range_validator = None
        response = FakeResponse(
            body=b'x',
            status_code=206,
            headers={
                'Content-Encoding': 'gzip',
                'Content-Length': '1',
                'Content-Range': 'bytes 0-0/100',
            },
        )

        self.assertFalse(download._response_matches_range(response, 0, 0))

    def test_range_probe_rejects_empty_206_response(self):
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._size = 100
        response = FakeResponse(
            body=b'',
            status_code=206,
            headers={
                'Content-Length': '1',
                'Content-Range': 'bytes 0-0/100',
                'ETag': '"fixture-v1"',
            },
        )
        download._open_range_response = MagicMock(return_value=response)

        self.assertFalse(download._probe_range_support())
        self.assertTrue(response.closed)

    def test_range_probe_rejects_200_response(self):
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._size = 100
        response = FakeResponse(
            body=b'x' * 100,
            status_code=200,
            headers={'Content-Length': '100'},
        )
        download._open_range_response = MagicMock(return_value=response)

        self.assertFalse(download._probe_range_support())
        self.assertTrue(response.closed)

    def test_segmented_run_writes_validated_ranges_into_one_file(self):
        from backend.base.definitions import DownloadState
        from backend.implementations import download_clients
        from backend.implementations.download_clients import DirectDownload

        payload = b'abcdefghijklmnopqrstuvwxyz'
        responses = []

        def open_range(start, end):
            response = FakeResponse(
                body=payload[start:end + 1],
                status_code=206,
                headers={
                    'Content-Length': str(end - start + 1),
                    'Content-Range': f'bytes {start}-{end}/{len(payload)}',
                },
            )
            responses.append(response)
            return response

        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, 'payload.bin')
            download = DirectDownload.__new__(DirectDownload)
            download._files = [target]
            download._size = len(payload)
            download._state = DownloadState.QUEUED_STATE
            download._progress = 0.0
            download._speed = 0.0
            download._supports_segmented_download = True
            download._supports_range_header = True
            download._open_range_response = open_range
            download._fetch_pure_link = MagicMock()
            download._BaseDirectDownload__r = None
            download._DirectDownload__active_responses = set()
            download._DirectDownload__active_responses_lock = Lock()

            with patch.object(download_clients, 'WebSocket') as websocket:
                websocket.return_value.emit = MagicMock()
                download.run()

            with open(target, 'rb') as result:
                self.assertEqual(result.read(), payload)
            self.assertEqual(download.progress, 100.0)
            self.assertEqual(len(responses), 4)
            self.assertTrue(all(response.closed for response in responses))
            download._fetch_pure_link.assert_not_called()

    def test_segment_retries_only_unfinished_bytes_after_short_response(self):
        from backend.base.definitions import DownloadState
        from backend.implementations import download_clients
        from backend.implementations.download_clients import DirectDownload

        payload = b'abcdefghijklmnopqrstuvwxyz'
        calls = []

        def open_range(start, end):
            calls.append((start, end))
            body = payload[start:end + 1]
            if start == 0:
                body = body[:2]
            return FakeResponse(
                body=body,
                status_code=206,
                headers={
                    'Content-Length': str(end - start + 1),
                    'Content-Range': f'bytes {start}-{end}/{len(payload)}',
                },
            )

        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, 'payload.bin')
            download = self._make_download(target, len(payload), open_range)
            with patch.object(download_clients, 'WebSocket') as websocket:
                websocket.return_value.emit = MagicMock()
                download.run()

            with open(target, 'rb') as result:
                self.assertEqual(result.read(), payload)
            self.assertIn((2, 6), calls)
            self.assertEqual(download.state, DownloadState.DOWNLOADING_STATE)

    def test_invalid_segment_response_falls_back_to_single_stream(self):
        from backend.implementations import download_clients

        payload = b'fallback payload'
        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, 'payload.bin')
            download = self._make_download(
                target,
                len(payload),
                lambda _start, _end: FakeResponse(
                    body=payload,
                    status_code=200,
                    headers={'Content-Length': str(len(payload))},
                ),
            )
            single_response = FakeResponse(
                body=payload,
                status_code=200,
                headers={'Content-Length': str(len(payload))},
            )
            download._fetch_pure_link = MagicMock(return_value=single_response)

            with patch.object(download_clients, 'WebSocket') as websocket:
                websocket.return_value.emit = MagicMock()
                download.run()

            with open(target, 'rb') as result:
                self.assertEqual(result.read(), payload)
            download._fetch_pure_link.assert_called_once_with(start_byte=0)
            self.assertFalse(download._supports_range_header)
            self.assertEqual(download.progress, 100.0)

    def test_blocked_websocket_emit_does_not_block_segment_workers(self):
        from backend.implementations import download_clients

        payload = b'abcdefghijklmnopqrstuvwxyz'
        release_emit = Event()

        def open_range(start, end):
            return FakeResponse(
                body=payload[start:end + 1],
                status_code=206,
                headers={
                    'Content-Length': str(end - start + 1),
                    'Content-Range': f'bytes {start}-{end}/{len(payload)}',
                },
            )

        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, 'payload.bin')
            download = self._make_download(target, len(payload), open_range)
            started = perf_counter()
            with patch.object(download_clients, 'WebSocket') as websocket:
                websocket.return_value.emit.side_effect = (
                    lambda _event: release_emit.wait(timeout=5)
                )
                download.run()
            elapsed = perf_counter() - started
            release_emit.set()

            self.assertLess(elapsed, 1.0)
            with open(target, 'rb') as result:
                self.assertEqual(result.read(), payload)

    def test_response_created_during_stop_is_closed_before_body_read(self):
        from backend.base.definitions import DownloadState

        response = FakeResponse(
            body=b'x',
            status_code=206,
            headers={
                'Content-Length': '1',
                'Content-Range': 'bytes 0-0/1',
            },
        )
        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, 'payload.bin')
            download = self._make_download(target, 1, None)

            def open_while_stopping(_start, _end):
                download._state = DownloadState.CANCELED_STATE
                return response

            download._open_range_response = open_while_stopping
            download._download_segment(
                0,
                0,
                {'downloaded': 0, 'started': perf_counter()},
                Lock(),
                Event(),
                MagicMock(),
                MagicMock(),
            )

            self.assertTrue(response.closed)
            self.assertEqual(
                download._DirectDownload__active_responses,
                set(),
            )
            self.assertEqual(download.state, DownloadState.CANCELED_STATE)

    def test_shutdown_state_survives_worker_close_error(self):
        from backend.base.definitions import DownloadState

        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, 'payload.bin')
            download = self._make_download(target, 16, lambda _start, _end: None)

            def fail_after_shutdown(*_args, **_kwargs):
                download._state = DownloadState.SHUTDOWN_STATE
                raise RuntimeError('response was closed by stop')

            download._download_segment = fail_after_shutdown
            result = download._run_segmented_download(MagicMock(), MagicMock())

            self.assertTrue(result)
            self.assertEqual(download.state, DownloadState.SHUTDOWN_STATE)

    def test_stop_continues_closing_responses_after_one_close_fails(self):
        from backend.base.definitions import DownloadState
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        first = MagicMock()
        first.close.side_effect = RuntimeError('simulated close failure')
        second = MagicMock()
        download._DirectDownload__active_responses = {first, second}
        download._DirectDownload__active_responses_lock = Lock()
        download._BaseDirectDownload__r = None
        download._state = DownloadState.DOWNLOADING_STATE

        with self.assertLogs(level='ERROR'):
            download.stop(DownloadState.SHUTDOWN_STATE)

        first.close.assert_called_once_with()
        second.close.assert_called_once_with()
        self.assertEqual(download.state, DownloadState.SHUTDOWN_STATE)

    def test_stop_closes_all_active_segment_responses_and_preserves_state(self):
        from backend.base.definitions import DownloadState
        from backend.implementations.download_clients import DirectDownload

        first = FakeResponse()
        second = FakeResponse()
        download = DirectDownload.__new__(DirectDownload)
        download._state = DownloadState.DOWNLOADING_STATE
        download._BaseDirectDownload__r = None
        download._DirectDownload__active_responses = {first, second}
        download._DirectDownload__active_responses_lock = Lock()

        download.stop(DownloadState.SHUTDOWN_STATE)

        self.assertEqual(download.state, DownloadState.SHUTDOWN_STATE)
        self.assertTrue(first.closed)
        self.assertTrue(second.closed)

    def test_real_http_206_server_is_probed_and_downloaded_in_ranges(self):
        import requests

        from backend.implementations import download_clients

        payload = b'0123456789abcdefghijklmnopqrstuvwxyz'
        requested_ranges = []
        if_range_headers = []
        accept_encodings = []

        class RangeHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                range_header = self.headers.get('Range')
                if not range_header or not range_header.startswith('bytes='):
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return

                start_text, end_text = range_header[6:].split('-', 1)
                start = int(start_text)
                end = int(end_text)
                requested_ranges.append((start, end))
                if_range_headers.append(self.headers.get('If-Range'))
                accept_encodings.append(self.headers.get('Accept-Encoding'))
                body = payload[start:end + 1]
                self.send_response(206)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('ETag', '"payload-v1"')
                self.send_header(
                    'Content-Range',
                    f'bytes {start}-{end}/{len(payload)}'
                )
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format, *_args):
                return

        server = ThreadingHTTPServer(('127.0.0.1', 0), RangeHandler)
        server_thread = Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                target = os.path.join(folder, 'payload.bin')
                download = self._make_download(target, len(payload), None)
                download._pure_link = (
                    f'http://127.0.0.1:{server.server_port}/payload.bin'
                )

                with patch.object(download_clients, 'Session', requests.Session):
                    self.assertTrue(download._probe_range_support())
                    with patch.object(download_clients, 'WebSocket') as websocket:
                        websocket.return_value.emit = MagicMock()
                        download.run()

                with open(target, 'rb') as result:
                    self.assertEqual(result.read(), payload)
                self.assertIn((0, 0), requested_ranges)
                self.assertEqual(len(requested_ranges), 5)
                self.assertIsNone(if_range_headers[0])
                self.assertEqual(if_range_headers[1:], ['"payload-v1"'] * 4)
                self.assertEqual(accept_encodings, ['identity'] * 5)
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=2)

    @staticmethod
    def _make_download(target, size, open_range):
        from backend.base.definitions import DownloadState
        from backend.implementations.download_clients import DirectDownload

        download = DirectDownload.__new__(DirectDownload)
        download._files = [target]
        download._size = size
        download._state = DownloadState.QUEUED_STATE
        download._progress = 0.0
        download._speed = 0.0
        download._supports_segmented_download = True
        download._supports_range_header = True
        if open_range is not None:
            download._open_range_response = open_range
        download._fetch_pure_link = MagicMock()
        download._BaseDirectDownload__r = None
        download._DirectDownload__active_responses = set()
        download._DirectDownload__active_responses_lock = Lock()
        return download


if __name__ == '__main__':
    unittest.main()
