"""Bounded Suwayomi execution and structured-failure regressions."""

import base64
import json
import importlib.util
import os
import tempfile
import time
import unittest
from threading import Event, Timer
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from requests import RequestException

from backend.base.definitions import DownloadSource, DownloadState
from backend.features import post_processing
from backend.implementations import suwayomi
from backend.implementations.suwayomi import (
    SuwayomiClient,
    SuwayomiDownloadError,
    SuwayomiWaitStatus,
)


def _hanging_pdf_worker(page_paths, output_path, result_queue, artifact_dir):
    with open(os.path.join(artifact_dir, 'orphan-batch.pdf'), 'wb') as handle:
        handle.write(b'partial')
    time.sleep(30)


def _request_error(status):
    error = RequestException('sanitized test failure')
    error.response = SimpleNamespace(status_code=status)
    return error


class WaitForDownloadReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.client = SuwayomiClient.__new__(SuwayomiClient)

    def test_never_completing_download_times_out(self):
        self.client.get_chapter_info = MagicMock(return_value={
            'id': 2, 'isDownloaded': False,
        })
        self.client.get_download_entry = MagicMock(return_value={
            'state': 'DOWNLOADING', 'tries': 1,
        })
        result = self.client.wait_for_download(1, 2, Event(), timeout=0.02)
        self.assertIs(result.status, SuwayomiWaitStatus.TIMED_OUT)
        self.assertEqual(result.failure['stage'], 'wait_for_download')
        self.assertEqual(result.failure['type'], 'timeout')

    def test_cancellation_is_interruptible(self):
        stopped = Event()
        stopped.set()
        started = time.monotonic()
        result = self.client.wait_for_download(1, 2, stopped, timeout=30)
        self.assertIs(result.status, SuwayomiWaitStatus.CANCELED)
        self.assertLess(time.monotonic() - started, 0.5)

    def test_transient_status_errors_can_recover(self):
        self.client.get_chapter_info = MagicMock(side_effect=[
            RequestException('first'),
            RequestException('second'),
            {'id': 2, 'isDownloaded': True, 'pageCount': 1},
        ])
        self.client.get_download_entry = MagicMock()
        with patch.object(suwayomi, 'POLL_INTERVAL', 0.0):
            result = self.client.wait_for_download(1, 2, Event(), timeout=2)
        self.assertIs(result.status, SuwayomiWaitStatus.COMPLETED)
        self.assertEqual(self.client.get_chapter_info.call_count, 3)

    def test_terminal_upstream_error_is_reported(self):
        self.client.get_chapter_info = MagicMock(return_value={
            'id': 2, 'isDownloaded': False,
        })
        self.client.get_download_entry = MagicMock(return_value={
            'state': 'ERROR', 'tries': 4,
        })
        result = self.client.wait_for_download(1, 2, Event(), timeout=30)
        self.assertIs(result.status, SuwayomiWaitStatus.FAILED)
        self.assertEqual(result.failure['type'], 'upstream_error')
        self.assertEqual(result.failure['attempts'], 4)


class PageRetryReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.client = SuwayomiClient.__new__(SuwayomiClient)

    def test_transient_500_then_success_uses_bounded_retries(self):
        self.client.get_page_image = MagicMock(side_effect=[
            _request_error(500), _request_error(500), b'page',
        ])
        with patch.object(suwayomi, 'PAGE_RETRY_BACKOFF', (0.0, 0.0)):
            result = self.client._get_page_with_retry(1, 3, 0, Event())
        self.assertEqual(result, b'page')
        self.assertEqual(self.client.get_page_image.call_count, 3)

    def test_429_is_retryable(self):
        self.client.get_page_image = MagicMock(side_effect=[
            _request_error(429), b'page',
        ])
        with patch.object(suwayomi, 'PAGE_RETRY_BACKOFF', (0.0, 0.0)):
            result = self.client._get_page_with_retry(1, 3, 0, Event())
        self.assertEqual(result, b'page')
        self.assertEqual(self.client.get_page_image.call_count, 2)

    def test_404_fails_immediately_with_status_and_attempt(self):
        self.client.get_page_image = MagicMock(side_effect=_request_error(404))
        with self.assertRaises(SuwayomiDownloadError) as raised:
            self.client._get_page_with_retry(
                1, 3, 7, Event(), chapter_id=99,
            )
        self.assertEqual(self.client.get_page_image.call_count, 1)
        self.assertEqual(raised.exception.details['status'], 404)
        self.assertEqual(raised.exception.details['attempts'], 1)
        self.assertEqual(raised.exception.details['chapter_id'], 99)
        self.assertEqual(raised.exception.details['source_order'], 3)
        self.assertEqual(raised.exception.details['page_index'], 7)

    def test_failed_cbz_removes_partial_output(self):
        self.client.get_page_image = MagicMock(side_effect=[
            b'not-an-image', _request_error(404),
        ])
        with tempfile.TemporaryDirectory() as folder:
            destination = os.path.join(folder, 'chapter.cbz')
            with self.assertRaises(SuwayomiDownloadError):
                self.client.create_cbz(1, 3, 2, destination, Event())
            self.assertFalse(os.path.exists(destination))
            self.assertFalse(os.path.exists(destination + '.part'))


class PdfDeadlineReliabilityTests(unittest.TestCase):
    def test_successful_page_fetch_after_total_deadline_is_rejected(self):
        client = SuwayomiClient.__new__(SuwayomiClient)

        def slow_page(*args, **kwargs):
            time.sleep(0.03)
            return b'not-an-image'

        client.get_page_image = slow_page
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(suwayomi, 'PDF_TOTAL_TIMEOUT', 0.01):
            destination = os.path.join(folder, 'volume.pdf')
            with self.assertRaises(SuwayomiDownloadError) as raised:
                client.create_pdf_from_chapters(
                    1, [(99, 3, 1)], destination, Event(),
                )
            self.assertEqual(raised.exception.details['type'], 'timeout')
            self.assertFalse(os.path.exists(destination))
            self.assertEqual(os.listdir(folder), [])


class PdfWorkerReliabilityTests(unittest.TestCase):
    def test_hanging_conversion_is_killed_and_partial_output_removed(self):
        client = SuwayomiClient.__new__(SuwayomiClient)
        client.get_page_image = MagicMock(return_value=b'not-an-image')
        with tempfile.TemporaryDirectory() as folder:
            destination = os.path.join(folder, 'volume.pdf')
            started = time.monotonic()
            with patch.object(suwayomi, '_pdf_assembly_worker', _hanging_pdf_worker), \
                    patch.object(suwayomi, 'PDF_ASSEMBLY_TIMEOUT', 0.2), \
                    patch.object(suwayomi, 'PDF_TOTAL_TIMEOUT', 2.0):
                with self.assertRaises(SuwayomiDownloadError) as raised:
                    client.create_pdf_from_chapters(
                        1, [(3, 1)], destination, Event(),
                    )
            self.assertEqual(raised.exception.details['stage'], 'pdf_assembly')
            self.assertEqual(raised.exception.details['type'], 'timeout')
            self.assertLess(time.monotonic() - started, 5)
            self.assertFalse(os.path.exists(destination))
            self.assertEqual(os.listdir(folder), [])


    def test_cancellation_kills_hanging_worker_without_success(self):
        client = SuwayomiClient.__new__(SuwayomiClient)
        client.get_page_image = MagicMock(return_value=b'not-an-image')
        stopped = Event()
        timer = Timer(0.2, stopped.set)
        with tempfile.TemporaryDirectory() as folder:
            destination = os.path.join(folder, 'volume.pdf')
            timer.start()
            try:
                with patch.object(suwayomi, '_pdf_assembly_worker', _hanging_pdf_worker), \
                        patch.object(suwayomi, 'PDF_ASSEMBLY_TIMEOUT', 30.0), \
                        patch.object(suwayomi, 'PDF_TOTAL_TIMEOUT', 30.0):
                    result = client.create_pdf_from_chapters(
                        1, [(3, 1)], destination, stopped,
                    )
            finally:
                timer.cancel()
            self.assertFalse(result)
            self.assertFalse(os.path.exists(destination))
            self.assertEqual(os.listdir(folder), [])

    @unittest.skipUnless(
        importlib.util.find_spec('pypdf'),
        'pypdf is installed by project requirements',
    )
    def test_real_spawn_worker_creates_pdf_atomically(self):
        client = SuwayomiClient.__new__(SuwayomiClient)
        jpeg = base64.b64decode(
            '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABkAGQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q=='
        )
        client.get_page_image = MagicMock(return_value=jpeg)
        with tempfile.TemporaryDirectory() as folder:
            destination = os.path.join(folder, 'volume.pdf')
            result = client.create_pdf_from_chapters(
                1, [(3, 1)], destination, Event(),
            )
            self.assertTrue(result)
            with open(destination, 'rb') as handle:
                self.assertEqual(handle.read(4), b'%PDF')
            self.assertEqual(os.listdir(folder), ['volume.pdf'])


class StructuredHistoryFailureTests(unittest.TestCase):
    def test_distinct_sanitized_causes_are_persisted(self):
        params = []

        class FakeCursor:
            def execute(self, query, values=None):
                if values and isinstance(values, dict):
                    params.append(values)
                return self

        def make_download(reason):
            return SimpleNamespace(
                state=DownloadState.FAILED_STATE,
                _failure_reason=reason.details,
                task_history_id=0,
                web_link=None,
                web_title=None,
                web_sub_title='Series',
                title='Series',
                volume_id=1,
                issue_id=None,
                source_type=DownloadSource.SUWAYOMI,
                source_name='Suwayomi',
                covered_issues=1.0,
                download_link='suwayomi:1:2',
            )

        timeout = SuwayomiDownloadError(
            'wait_for_download', 'timeout', manga_id=1, chapter_id=2,
        )
        not_found = SuwayomiDownloadError(
            'page_fetch', 'http_error', manga_id=1,
            chapter_id=2, source_order=7, page_index=3,
            status=404, attempts=1,
        )
        with patch.object(post_processing, 'get_db', return_value=FakeCursor()):
            post_processing.add_to_history(make_download(timeout))
            post_processing.add_to_history(make_download(not_found))

        reasons = [json.loads(item['failure_reason']) for item in params]
        self.assertEqual(reasons[0]['type'], 'timeout')
        self.assertEqual(reasons[1]['status'], 404)
        self.assertEqual(reasons[1]['chapter_id'], 2)
        self.assertEqual(reasons[1]['source_order'], 7)
        self.assertNotEqual(reasons[0], reasons[1])
        self.assertNotIn('password', params[0]['failure_reason'].lower())

    def test_failed_blocklist_write_suppresses_batch_fallback_source(self):
        class FakeCursor:
            def execute(self, query, values=None):
                return self

        download = SimpleNamespace(
            state=DownloadState.FAILED_STATE,
            _failure_reason={'stage': 'download', 'type': 'failed'},
            _allow_batch_fallback=False,
            task_history_id=55,
            web_link=None, web_title=None, web_sub_title='Series',
            title='Series', volume_id=1, issue_id=None,
            source_type=DownloadSource.SUWAYOMI, source_name='Suwayomi',
            covered_issues=(1.0, 2.0), download_link='suwayomi:1:2,3',
        )

        with patch.object(post_processing, 'get_db', return_value=FakeCursor()), \
                patch('backend.features.tasks.DownloadBatch.record') as record:
            post_processing.add_to_history(download)

        self.assertIsNone(record.call_args.kwargs['source_type'])
        self.assertEqual(record.call_args.kwargs['download_link'], download.download_link)



if __name__ == '__main__':
    unittest.main()
