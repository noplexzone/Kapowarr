"""End-to-end regressions for Suwayomi search and fallback automation."""

import asyncio
import unittest
from threading import Barrier, Event, Thread
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from backend.base.definitions import DownloadState, SpecialVersion
from backend.features import download_queue, search, tasks
from backend.implementations.download_clients import SuwayomiDownload


def _result(link, match=False, issue_number=1.0, source='Suwayomi'):
    return {
        'link': link,
        'display_title': link,
        'source': source,
        'series': 'Series',
        'year': None,
        'volume_number': 1,
        'special_version': None,
        'issue_number': issue_number,
        'annual': False,
        'match': match,
        'match_issue': None if match else 'Title mismatch',
    }


class SuwayomiSearchReliabilityTests(unittest.TestCase):
    def test_manual_search_uses_alternate_when_primary_only_has_raw_misses(self):
        volume_data = SimpleNamespace(
            title='Primary Title', alt_title='Alternate Title', year=2020,
            volume_number=1, special_version=SpecialVersion.TPB,
            publisher='VIZ Media',
        )
        volume = MagicMock()
        volume.get_data.return_value = volume_data
        volume.get_issues.return_value = []
        responses = [
            [_result('https://example.invalid/primary')],
            [_result('https://example.invalid/alternate')],
        ]
        calls = []

        def fake_run(coroutine):
            coroutine.close()
            calls.append(True)
            return responses.pop(0)

        def fake_match(result, *args, **kwargs):
            matched = result['link'].endswith('/alternate')
            return {
                'match': matched,
                'match_issue': None if matched else 'Title mismatch',
            }

        with patch.object(search, 'Volume', return_value=volume), \
                patch.object(search, 'run', fake_run), \
                patch.object(search, 'check_search_result_match', fake_match):
            results = search.manual_search(1)

        self.assertEqual(len(calls), 2)
        self.assertTrue(results[0]['match'])
        self.assertTrue(results[0]['link'].endswith('/alternate'))
        self.assertEqual({result['link'] for result in results}, {
            'https://example.invalid/primary',
            'https://example.invalid/alternate',
        })

    def test_auto_search_retains_raw_chapters_until_tpb_bundle(self):
        volume_data = SimpleNamespace(
            title='Series', alt_title=None, year=2020, volume_number=1,
            special_version=SpecialVersion.TPB, publisher='VIZ Media',
            monitored=True,
        )
        volume = MagicMock()
        volume.get_data.return_value = volume_data
        volume.get_issues.return_value = []
        volume.get_open_issues.return_value = [(10, 1.0), (11, 2.0)]
        raw = [
            _result('suwayomi:10:100', match=False, issue_number=1.0),
            _result('suwayomi:10:101', match=False, issue_number=2.0),
        ]
        captured = {}

        def fake_manual(*args, **kwargs):
            captured.update(kwargs)
            return raw

        with patch.object(search, 'Volume', return_value=volume), \
                patch.object(search, 'manual_search', fake_manual), \
                patch.object(search, '_sort_by_source_priority', lambda rows, data: rows):
            results = search.auto_search(1)

        self.assertTrue(captured['_retain_suwayomi_chapters'])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['link'], 'suwayomi:10:100,101')
        self.assertEqual(results[0]['issue_number'], (1.0, 2.0))

    def test_formatted_queries_share_one_suwayomi_pass(self):
        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        search_mock = AsyncMock(return_value=[])
        volume_data = SimpleNamespace(publisher='VIZ Media')
        with patch.object(search, 'AsyncSession', FakeSession), \
                patch.object(search, 'get_subclasses', return_value=[search.SearchSuwayomi]), \
                patch.object(search.SearchSuwayomi, 'search', search_mock):
            queries = tuple(
                template.format(
                    title='Series', volume_number=1, year=2020,
                    issue_number=None,
                )
                for template in search.QUERY_FORMATS['TPB']
            )
            asyncio.run(search.search_multiple_queries(
                *queries,
                volume_data=volume_data,
            ))

        self.assertEqual(search_mock.await_count, 1)


class SuwayomiFallbackReliabilityTests(unittest.TestCase):
    def test_auto_search_volume_carries_pack_coverage_to_admission(self):
        volume_data = SimpleNamespace(
            title='Series', alt_title=None, year=2020,
            volume_number=1, special_version=SpecialVersion.TPB,
            publisher='VIZ Media', monitored=True,
        )
        volume = MagicMock()
        volume.vd.title = 'Series'
        volume.get_data.return_value = volume_data
        bundle = _result(
            'suwayomi:10:100,101', match=True,
            issue_number=(1.0, 2.0),
        )

        with patch.object(tasks, 'Volume', return_value=volume), \
                patch.object(tasks, 'auto_search', return_value=[bundle]), \
                patch.object(tasks, '_emit_task_event'):
            admitted = tasks.AutoSearchVolume(44).run()

        self.assertEqual(admitted[0][4], (1.0, 2.0))

    def test_suwayomi_volume_admission_uses_pack_coverage_override(self):
        from backend.features import download_queue

        handler = object.__new__(download_queue.DownloadHandler)
        handler.queue = []
        handler.settings = MagicMock()
        fake_volume = MagicMock()
        fake_volume.get_data.return_value.publisher = 'VIZ Media'
        captured = {}
        fake_download = MagicMock()
        fake_download.download_link = 'suwayomi:10:100,101'
        fake_download.as_dict.return_value = {'id': 1}

        def fake_constructor(**kwargs):
            captured.update(kwargs)
            return fake_download

        with patch.object(download_queue, 'Volume', return_value=fake_volume), \
                patch.object(download_queue, 'SuwayomiVolumeDownload', side_effect=fake_constructor), \
                patch.object(handler, '_DownloadHandler__prepare_downloads_for_queue', lambda rows, forced_match: rows), \
                patch.object(handler, '_process_queue'), \
                patch.object(download_queue, '_emit_queue_event'):
            added, reason = asyncio.run(handler.add(
                'suwayomi:10:100,101', 44,
                covered_issues_override=(1.0, 2.0),
            ))

        self.assertIsNone(reason)
        self.assertEqual(added, [{'id': 1}])
        self.assertEqual(captured['covered_issues'], (1.0, 2.0))
        handler.queue = []

    def test_concurrent_records_finalize_batch_once(self):
        task_history_id = 99124
        batch = tasks.DownloadBatch(task_history_id, 1, 44, 'Auto Search')
        tasks.DownloadBatch._registry[task_history_id] = batch
        finalized = []
        start = Barrier(3)

        def record(title):
            start.wait()
            tasks.DownloadBatch.record(
                task_history_id, title, False, 'failed',
                covered_issues=1.0, source_type='suwayomi',
            )

        workers = [Thread(target=record, args=(str(i),)) for i in range(2)]
        with patch.object(
            tasks.DownloadBatch, '_finalize',
            lambda current: finalized.append(current.task_history_id),
        ):
            for worker in workers:
                worker.start()
            start.wait()
            for worker in workers:
                worker.join()

        self.assertEqual(finalized, [task_history_id])
        tasks.DownloadBatch._registry.pop(task_history_id, None)
        tasks.DownloadBatch._pending_results.pop(task_history_id, None)

    def test_download_result_finishing_before_registration_is_preserved(self):
        task_history_id = 99123
        tasks.DownloadBatch._registry.pop(task_history_id, None)
        tasks.DownloadBatch._pending_results.pop(task_history_id, None)
        finalized = []

        with patch.object(
            tasks.DownloadBatch,
            '_finalize',
            lambda batch: finalized.append(list(batch.results)),
        ):
            tasks.DownloadBatch.record(
                task_history_id,
                'Fast Suwayomi result',
                False,
                'Download failed',
                covered_issues=1.0,
            )
            tasks.DownloadBatch.register(
                task_history_id,
                1,
                44,
                'Auto Search',
            )

        self.assertEqual(len(finalized), 1)
        self.assertEqual(finalized[0][0]['_covered_issues'], 1.0)
        self.assertNotIn(task_history_id, tasks.DownloadBatch._pending_results)

    def test_failed_issue_and_pack_queue_unique_issue_fallbacks(self):
        class FakeResult:
            def fetchall(self):
                return [{'id': 11}, {'id': 11}, {'id': 12}]

        class FakeDB:
            def execute(self, *args, **kwargs):
                return FakeResult()

        added = []
        handler = SimpleNamespace(add=lambda task: added.append(task.issue_id))
        batch = tasks.DownloadBatch(1, 2, 44, 'Auto Search')
        batch.results = [
            {
                'success': False, '_covered_issues': 1.0,
                '_source_type': 'suwayomi',
            },
            {
                'success': False, '_covered_issues': (1.0, 2.0),
                '_source_type': 'suwayomi',
            },
        ]

        with patch.object(tasks, 'get_db', return_value=FakeDB()), \
                patch.object(tasks, 'TaskHandler', return_value=handler):
            batch._queue_fallback_searches()

        self.assertEqual(added, [11, 12])

    def test_false_pdf_assembly_marks_volume_download_failed(self):
        from backend.base.definitions import DownloadState
        from backend.implementations import download_clients
        from backend.implementations.download_clients import SuwayomiVolumeDownload

        download = SuwayomiVolumeDownload.__new__(SuwayomiVolumeDownload)
        download._download_link = 'suwayomi:10:100,101'
        download._stop_event = Event()
        download._state = DownloadState.QUEUED_STATE
        download._files = ['/tmp/unused-suwayomi-test.pdf']
        download._progress = 0.0
        download._speed = 0.0
        download._bytes_downloaded = 0
        download._size = 0

        client = MagicMock()
        client.wait_for_download.side_effect = [
            {'sourceOrder': 1, 'pageCount': 1},
            {'sourceOrder': 2, 'pageCount': 1},
        ]
        client.create_pdf_from_chapters.return_value = False

        with patch.object(download_clients, 'SuwayomiClient', return_value=client), \
                patch.object(download_clients, '_emit_download_status'):
            download.run()

        self.assertEqual(download.state, DownloadState.FAILED_STATE)

    def test_failed_suwayomi_link_is_blocklisted_before_batch_recording(self):
        order = []
        download = SuwayomiDownload.__new__(SuwayomiDownload)
        download._id = 7
        download._state = DownloadState.FAILED_STATE
        handler = download_queue.DownloadHandler.__new__(download_queue.DownloadHandler)
        handler.queue = [download]

        with patch.object(SuwayomiDownload, 'run', lambda self: None), \
                patch.object(download_queue, 'QueueStatusEvent', lambda item: object()), \
                patch.object(download_queue, '_emit_queue_event', lambda event: None), \
                patch.object(download_queue, 'add_dl_to_blocklist',
                             lambda item: order.append('blocklist')), \
                patch.object(download_queue.PostProcessor, 'failed',
                             lambda item: order.append('record')), \
                patch.object(handler, '_process_queue', lambda: None):
            handler._DownloadHandler__run_download(download)

        self.assertEqual(order, ['blocklist', 'record'])


if __name__ == '__main__':
    unittest.main()
