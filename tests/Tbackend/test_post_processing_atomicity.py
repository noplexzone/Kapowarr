"""Regression coverage for collision-safe rename and post-processing finalization."""

import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.base.definitions import DownloadState
from backend.features import download_queue, post_processing, tasks
from backend.features.download_queue import DownloadHandler
from backend.implementations.naming import (
    mass_rename,
    preview_mass_rename,
    same_name_indexing,
)
from backend.internals.db_models import FilesDB


class SafeMassRenameTests(TestCase):
    def test_colliding_plans_raise_destination_conflict_when_target_folder_is_new(self):
        with TemporaryDirectory() as folder:
            source_folder = Path(folder, 'old')
            source_folder.mkdir()
            target_folder = Path(folder, 'new')
            sources = [
                str(source_folder / name)
                for name in ('main.cbz', 'variant.cbz', 'other.cbz')
            ]
            canonical = str(target_folder / 'Series v01.cbz')

            with self.assertRaises(FileExistsError):
                same_name_indexing(
                    str(target_folder),
                    {source: canonical for source in reversed(sources)},
                )

    def test_filesystem_rolls_back_when_database_update_fails(self):
        with TemporaryDirectory() as folder:
            old_folder = Path(folder, 'old')
            new_folder = Path(folder, 'new')
            old_folder.mkdir()
            sources = [old_folder / name for name in ('main.cbz', 'variant.cbz')]
            for index, source in enumerate(sources):
                source.write_text('source-{}'.format(index))
            destinations = [
                new_folder / 'Series v01.cbz',
                new_folder / 'Series v01 (1).cbz',
            ]
            mapping = dict(zip(map(str, sources), map(str, destinations)))
            volume_data = SimpleNamespace(folder=str(old_folder), root_folder=1)
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                update=lambda values: None,
            )

            with patch(
                'backend.implementations.naming.preview_mass_rename',
                return_value=(mapping, str(new_folder)),
            ), patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.RootFolders', return_value={1: object()},
            ), patch(
                'backend.implementations.naming.FilesDB.update_filepaths',
                side_effect=RuntimeError('db failure'),
            ), patch(
                'backend.implementations.naming.delete_empty_child_folders',
            ), patch(
                'backend.implementations.naming.delete_empty_parent_folders',
            ):
                with self.assertRaisesRegex(RuntimeError, 'db failure'):
                    mass_rename(1, process_individual_files=False)

            self.assertEqual(
                [source.read_text() for source in sources],
                ['source-0', 'source-1'],
            )
            self.assertFalse(any(destination.exists() for destination in destinations))

    def test_property_failure_rolls_back_filesystem_and_database(self):
        with TemporaryDirectory() as folder:
            old_folder = Path(folder, 'old')
            new_folder = Path(folder, 'new')
            old_folder.mkdir()
            source = old_folder / 'main.cbz'
            destination = new_folder / 'Series 001.cbz'
            source.write_text('source')
            mapping = {str(source): str(destination)}
            volume_data = SimpleNamespace(folder=str(old_folder), root_folder=1)
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                update=lambda values: None,
            )
            database_updates = []
            with patch(
                'backend.implementations.naming.preview_mass_rename',
                return_value=(mapping, str(new_folder)),
            ), patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.RootFolders', return_value={1: object()},
            ), patch(
                'backend.implementations.naming.FilesDB.update_filepaths',
                side_effect=lambda changes: database_updates.append(changes.copy()),
            ), patch(
                'backend.implementations.naming.delete_empty_child_folders',
            ), patch(
                'backend.implementations.naming.delete_empty_parent_folders',
            ), patch(
                'backend.implementations.naming.mass_process_files',
                side_effect=RuntimeError('property failure'),
            ):
                with self.assertRaisesRegex(RuntimeError, 'property failure'):
                    mass_rename(1, process_individual_files=True)
            self.assertEqual(source.read_text(), 'source')
            self.assertFalse(destination.exists())
            self.assertEqual(database_updates, [
                mapping,
                {str(destination): str(source)},
            ])

    def test_database_filepath_update_handles_swaps(self):
        connection = sqlite3.connect(':memory:')
        self.addCleanup(connection.close)
        connection.execute(
            'CREATE TABLE files (id INTEGER PRIMARY KEY, filepath TEXT UNIQUE, size INTEGER)'
        )
        connection.executemany(
            'INSERT INTO files(filepath, size) VALUES (?, 1)',
            (('/library/main.cbz',), ('/library/variant.cbz',)),
        )

        with patch(
            'backend.internals.db_models.get_db',
            return_value=connection.cursor(),
        ):
            FilesDB.update_filepaths({
                '/library/main.cbz': '/library/variant.cbz',
                '/library/variant.cbz': '/library/main.cbz',
            })

        rows = connection.execute(
            'SELECT id, filepath FROM files ORDER BY id'
        ).fetchall()
        self.assertEqual(
            rows,
            [(1, '/library/variant.cbz'), (2, '/library/main.cbz')],
        )

    def test_preview_strictly_honors_nonempty_filepath_filter(self):
        with TemporaryDirectory() as folder:
            selected = str(Path(folder, 'newly-extracted.cbz'))
            unrelated = str(Path(folder, 'existing-variant.cbz'))
            for filepath in (selected, unrelated):
                Path(filepath).write_text(filepath)
            volume_data = SimpleNamespace(
                folder=folder,
                custom_folder=True,
                root_folder=1,
            )
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                get_all_files=lambda: [
                    {'filepath': unrelated},
                    {'filepath': selected},
                ],
            )

            with patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.FilesDB.issues_covered',
                return_value=[1.0],
            ), patch(
                'backend.implementations.naming.generate_issue_name',
                return_value='Series 001',
            ):
                result, _ = preview_mass_rename(
                    1, filepath_filter=[selected]
                )

            self.assertEqual(list(result), [selected])
            self.assertNotIn(unrelated, result)

    def test_explicit_empty_filter_selects_nothing(self):
        with TemporaryDirectory() as folder:
            filepath = str(Path(folder, 'existing.cbz'))
            Path(filepath).write_text('content')
            volume_data = SimpleNamespace(
                folder=folder,
                custom_folder=True,
                root_folder=1,
            )
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                get_all_files=lambda: [{'filepath': filepath}],
            )
            with patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ):
                result, new_folder = preview_mass_rename(
                    1, filepath_filter=[]
                )
            self.assertEqual(result, {})
            self.assertIsNone(new_folder)

    def test_filtered_rename_does_not_move_volume_folder_pointer(self):
        with TemporaryDirectory() as folder:
            old_folder = Path(folder, 'old')
            old_folder.mkdir()
            selected = str(old_folder / 'selected.cbz')
            unrelated = str(old_folder / 'unrelated.cbz')
            Path(selected).write_text('selected')
            Path(unrelated).write_text('unrelated')
            volume_data = SimpleNamespace(
                folder=str(old_folder),
                custom_folder=False,
                root_folder=1,
            )
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                get_all_files=lambda: [
                    {'filepath': selected}, {'filepath': unrelated}
                ],
            )
            with patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.FilesDB.issues_covered',
                return_value=[1.0],
            ), patch(
                'backend.implementations.naming.generate_issue_name',
                return_value='Series 001',
            ):
                result, new_folder = preview_mass_rename(
                    1, filepath_filter=[selected]
                )
            self.assertIsNone(new_folder)
            self.assertEqual(
                result[selected], str(old_folder / 'Series 001.cbz')
            )
            self.assertNotIn(unrelated, result)

    def test_cancellation_is_atomic_and_returns_original_paths(self):
        with TemporaryDirectory() as folder:
            old_folder = Path(folder, 'old')
            new_folder = Path(folder, 'new')
            old_folder.mkdir()
            sources = [old_folder / name for name in ('one.cbz', 'two.cbz')]
            for index, source in enumerate(sources):
                source.write_text('source-{}'.format(index))
            mapping = {
                str(source): str(new_folder / source.name)
                for source in sources
            }
            volume_data = SimpleNamespace(folder=str(old_folder), root_folder=1)
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                update=lambda values: self.fail('volume pointer moved'),
            )
            calls = [False, True]
            with patch(
                'backend.implementations.naming.preview_mass_rename',
                return_value=(mapping, str(new_folder)),
            ), patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.RootFolders', return_value={1: object()},
            ), patch(
                'backend.implementations.naming.FilesDB.update_filepaths'
            ) as update_paths, patch(
                'backend.implementations.naming.delete_empty_child_folders',
            ), patch(
                'backend.implementations.naming.delete_empty_parent_folders',
            ):
                result = mass_rename(
                    1,
                    process_individual_files=False,
                    stop_fn=lambda: calls.pop(0),
                )
            self.assertEqual(result, list(mapping))
            self.assertEqual(
                [source.read_text() for source in sources],
                ['source-0', 'source-1'],
            )
            update_paths.assert_not_called()
            self.assertFalse(new_folder.exists())

    def test_unrelated_existing_destination_is_never_overwritten(self):
        with TemporaryDirectory() as folder:
            old_folder = Path(folder, 'old')
            new_folder = Path(folder, 'new')
            old_folder.mkdir()
            new_folder.mkdir()
            source = old_folder / 'source.cbz'
            destination = new_folder / 'destination.cbz'
            source.write_text('source')
            destination.write_text('unrelated')
            mapping = {str(source): str(destination)}
            volume_data = SimpleNamespace(folder=str(old_folder), root_folder=1)
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                update=lambda values: None,
            )
            with patch(
                'backend.implementations.naming.preview_mass_rename',
                return_value=(mapping, str(new_folder)),
            ), patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.RootFolders', return_value={1: object()},
            ):
                with self.assertRaises((FileExistsError, ValueError)):
                    mass_rename(1, process_individual_files=False)
            self.assertEqual(source.read_text(), 'source')
            self.assertEqual(destination.read_text(), 'unrelated')

    def test_mass_rename_rejects_colliding_issue_files(self):
        with TemporaryDirectory() as folder:
            old_folder = Path(folder, 'old')
            new_folder = Path(folder, 'new')
            old_folder.mkdir()
            sources = [
                str(old_folder / name)
                for name in ('main.cbz', 'variant-a.cbz', 'variant-b.cbz')
            ]
            for index, source in enumerate(sources):
                Path(source).write_text('distinct-{}'.format(index))
            canonical = str(new_folder / 'Series v01.cbz')
            mapping = {source: canonical for source in sources}
            volume_data = SimpleNamespace(folder=str(old_folder), root_folder=1)
            fake_volume = SimpleNamespace(
                get_data=lambda: volume_data,
                update=lambda values: None,
            )
            recorded = []

            with patch(
                'backend.implementations.naming.preview_mass_rename',
                return_value=(mapping, str(new_folder)),
            ), patch(
                'backend.implementations.naming.Volume', return_value=fake_volume,
            ), patch(
                'backend.implementations.naming.RootFolders', return_value={1: object()},
            ), patch(
                'backend.implementations.naming.FilesDB.update_filepaths',
                side_effect=lambda changes: recorded.append(changes.copy()),
            ), patch(
                'backend.implementations.naming.delete_empty_child_folders',
            ), patch(
                'backend.implementations.naming.delete_empty_parent_folders',
            ):
                with self.assertRaises((FileExistsError, ValueError)):
                    mass_rename(1, process_individual_files=False)

            self.assertEqual(recorded, [])


class DownloadBatchAtomicityTests(TestCase):
    def tearDown(self):
        tasks.DownloadBatch.begin(88001)
        tasks.DownloadBatch.begin(88002)

    def test_commit_failure_rolls_back_before_idempotent_retry(self):
        class Connection:
            def __init__(self):
                self.pending_rows = 0
                self.committed_rows = 0
                self.commit_calls = 0
                self.rollback_calls = 0

            def commit(self):
                self.commit_calls += 1
                if self.commit_calls == 1:
                    raise sqlite3.OperationalError('commit failed')
                self.committed_rows += self.pending_rows
                self.pending_rows = 0

            def rollback(self):
                self.rollback_calls += 1
                self.pending_rows = 0

        class Database:
            def __init__(self, connection):
                self.connection = connection

            def execute(self, query, parameters):
                self.connection.pending_rows += 1
                return self

        connection = Connection()
        batch = tasks.DownloadBatch(88001, 1, 1, 'test')
        batch.results = [{'success': True}]
        with patch.object(tasks, 'get_db', return_value=Database(connection)), patch.object(
            tasks, '_emit_task_event'
        ), patch.object(batch, '_queue_fallback_searches'):
            with self.assertRaises(sqlite3.OperationalError):
                batch._finalize()
            batch._finalize()
        self.assertEqual(connection.rollback_calls, 1)
        self.assertEqual(connection.committed_rows, 1)

    def test_pre_registration_results_deduplicate_by_download_id(self):
        tasks.DownloadBatch.begin(88002)
        for _ in range(2):
            tasks.DownloadBatch.record(
                88002, 'title', True, '', result_key=41
            )
        self.assertEqual(
            len(tasks.DownloadBatch._pending_results[88002]), 1
        )


class PostProcessingAtomicityTests(TestCase):
    def test_success_history_and_queue_removal_follow_conversion(self):
        action_names = [
            action.__name__
            for action in post_processing.PostProcessor.actions_success
        ]
        self.assertEqual(
            action_names[-2:], ['add_to_history_transactional', 'remove_from_queue']
        )
        self.assertLess(
            action_names.index('convert_file'),
            action_names.index('add_to_history_transactional'),
        )

    def test_conversion_failure_prevents_success_history_and_queue_removal(self):
        order = []

        def replacement(original):
            def run(download):
                order.append(original.__name__)
                if original.__name__ == 'convert_file':
                    raise RuntimeError('conversion failed')
            return run

        actions = [
            replacement(action)
            for action in post_processing.PostProcessor.actions_success
        ]
        with patch.object(post_processing.PostProcessor, 'actions_success', actions):
            with self.assertRaisesRegex(RuntimeError, 'conversion failed'):
                post_processing.PostProcessor.success(SimpleNamespace(id=1))

        self.assertIn('convert_file', order)
        self.assertNotIn('add_to_history_transactional', order)
        self.assertNotIn('remove_from_queue', order)

    def test_failed_import_restores_exact_destination_and_runs_full_scan(self):
        with TemporaryDirectory() as folder:
            destination = Path(folder, 'Series 001.cbz')
            destination.write_text('prior artifact')
            download = SimpleNamespace(
                volume_id=4,
                files=[str(destination)],
            )
            post_processing._stage_existing_destination(
                download, str(destination)
            )
            destination.write_text('failed new artifact')
            connection = SimpleNamespace(commit=lambda: None)
            with patch.object(
                post_processing,
                'get_db',
                return_value=SimpleNamespace(connection=connection),
            ), patch.object(post_processing, 'scan_files') as scan:
                post_processing.reconcile_failed_import(download)
            self.assertEqual(destination.read_text(), 'prior artifact')
            self.assertEqual(download._destination_backups, [])
            scan.assert_called_once_with(4, update_websocket=True)

    def test_replaced_issue_file_is_restored_when_database_commit_fails(self):
        with TemporaryDirectory() as folder:
            existing = Path(folder, 'existing.cbz')
            existing.write_text('prior issue')
            download = SimpleNamespace(
                issue_id=12,
                covered_issues=1.0,
                files=[str(Path(folder, 'new.cbz'))],
            )

            class FailingConnection:
                def __init__(self):
                    self.rolled_back = False

                def commit(self):
                    raise sqlite3.OperationalError('commit failed')

                def rollback(self):
                    self.rolled_back = True

            connection = FailingConnection()
            with patch.object(
                post_processing.FilesDB,
                'fetch',
                return_value=[{'id': 7, 'filepath': str(existing)}],
            ), patch.object(
                post_processing.FilesDB, 'delete_file'
            ), patch.object(
                post_processing,
                'get_db',
                return_value=SimpleNamespace(connection=connection),
            ):
                with self.assertRaises(sqlite3.OperationalError):
                    post_processing.replace_existing_issue_files(download)

            self.assertTrue(connection.rolled_back)
            self.assertEqual(existing.read_text(), 'prior issue')
            self.assertEqual(
                list(Path(folder).glob('*.kapowarr-replaced-*')), []
            )

    def test_queue_commit_failure_rolls_back_pending_success_history(self):
        class FailingConnection:
            def __init__(self):
                self.rolled_back = False

            def execute(self, query, parameters):
                return None

            def commit(self):
                raise sqlite3.OperationalError('database locked')

            def rollback(self):
                self.rolled_back = True

        connection = FailingConnection()
        download = SimpleNamespace(
            id=9,
            _pending_history_batch=(1, 'title', True, ''),
            _pending_history_batch_kwargs={'source_type': 'getcomics'},
        )
        with patch.object(
            post_processing,
            'get_db',
            return_value=SimpleNamespace(connection=connection),
        ):
            with self.assertRaises(sqlite3.OperationalError):
                post_processing.remove_from_queue(download)
        self.assertTrue(connection.rolled_back)
        self.assertIsNone(download._pending_history_batch)
        self.assertEqual(download._pending_history_batch_kwargs, {})

    def test_external_post_processors_finalize_history_after_processing(self):
        nzb_actions = [
            action.__name__
            for action in post_processing.PostProcessorNZB.actions_success
        ]
        torrent_actions = [
            action.__name__
            for action in post_processing.PostProcessorTorrentsComplete.actions_success
        ]
        seeding_actions = [
            action.__name__
            for action in post_processing.PostProcessorTorrentsCopy.actions_seeding
        ]
        self.assertEqual(
            nzb_actions[-2:],
            ['add_to_history_transactional', 'remove_from_queue'],
        )
        self.assertEqual(
            torrent_actions[-2:],
            ['add_to_history_transactional', 'remove_from_queue'],
        )
        self.assertEqual(
            seeding_actions[-2:],
            ['add_to_history_transactional', 'commit_history'],
        )

    def test_shutdown_errors_preserve_queue_and_shutdown_state(self):
        wrappers = (
            ('_DownloadHandler__run_download',
             '_DownloadHandler__run_download_inner'),
            ('_DownloadHandler__run_nzb_download',
             '_DownloadHandler__run_nzb_download_inner'),
            ('_DownloadHandler__run_torrent_download',
             '_DownloadHandler__run_torrent_download_inner'),
        )
        for wrapper_name, inner_name in wrappers:
            with self.subTest(wrapper=wrapper_name):
                download = SimpleNamespace(
                    id=77,
                    state=DownloadState.SHUTDOWN_STATE,
                )
                handler = DownloadHandler.__new__(DownloadHandler)
                handler.queue = [download]
                handler.settings = SimpleNamespace(
                    sv=SimpleNamespace(
                        seeding_handling=download_queue.SeedingHandling.COPY,
                    )
                )
                advances = []
                handler._process_queue = lambda: advances.append(True)
                connection = SimpleNamespace(
                    in_transaction=False,
                    rollback=lambda: None,
                )
                with patch.object(
                    DownloadHandler, inner_name,
                    side_effect=RuntimeError('shutdown cleanup failed'),
                ), patch.object(
                    download_queue, 'get_db',
                    return_value=SimpleNamespace(connection=connection),
                ), patch.object(download_queue, '_emit_queue_event'):
                    getattr(DownloadHandler, wrapper_name)(handler, download)
                self.assertEqual(download.state, DownloadState.SHUTDOWN_STATE)
                self.assertEqual(handler.queue, [download])
                self.assertEqual(advances, [])

    def test_shutdown_during_real_postprocessing_preserves_each_worker(self):
        class FakePostProcessor:
            @staticmethod
            def success(download):
                download.state = DownloadState.SHUTDOWN_STATE
                raise RuntimeError('shutdown during post-processing')

        class FakeWebSocket:
            def emit(self, event):
                return

        class FakeSleepEvent:
            def wait(self, timeout=None):
                return

        class DirectDownload:
            id = 81
            state = DownloadState.QUEUED_STATE
            volume_id = 1
            issue_id = 1
            files = ['/tmp/direct.cbz']

            def run(self):
                self.state = DownloadState.DOWNLOADING_STATE

            def as_dict(self):
                return {'id': self.id}

        class ExternalDownload:
            id = 82
            state = DownloadState.QUEUED_STATE
            sleep_event = FakeSleepEvent()

            def run(self):
                return

            def update_status(self):
                self.state = DownloadState.IMPORTING_STATE

            def remove_from_client(self, delete_files):
                return

            def as_dict(self):
                return {'id': self.id}

        cases = (
            ('_DownloadHandler__run_download', DirectDownload(), 'PostProcessor', 1),
            ('_DownloadHandler__run_nzb_download', ExternalDownload(), 'PostProcessorNZB', 0),
            ('_DownloadHandler__run_torrent_download', ExternalDownload(), 'PostProcessorTorrentsCopy', 0),
        )
        for wrapper_name, download, processor_name, prior_advances in cases:
            with self.subTest(worker=wrapper_name):
                download.state = DownloadState.QUEUED_STATE
                handler = DownloadHandler.__new__(DownloadHandler)
                handler.queue = [download]
                handler.settings = SimpleNamespace(
                    sv=SimpleNamespace(
                        concurrent_direct_downloads=1,
                        delete_completed_downloads=False,
                        seeding_handling=download_queue.SeedingHandling.COPY,
                    )
                )
                advances = []
                handler._process_queue = lambda: advances.append(True)
                connection = SimpleNamespace(
                    in_transaction=False,
                    rollback=lambda: None,
                )
                patches = [
                    patch.object(download_queue, processor_name, FakePostProcessor),
                    patch.object(download_queue, 'WebSocket', return_value=FakeWebSocket()),
                    patch.object(download_queue, '_emit_queue_event'),
                    patch.object(
                        download_queue, 'get_db',
                        return_value=SimpleNamespace(connection=connection),
                    ),
                ]
                with patches[0], patches[1], patches[2], patches[3]:
                    getattr(DownloadHandler, wrapper_name)(handler, download)
                self.assertEqual(download.state, DownloadState.SHUTDOWN_STATE)
                self.assertEqual(handler.queue, [download])
                # Direct imports intentionally start the next queued item before
                # post-processing; the wrapper must not add another advancement.
                self.assertEqual(len(advances), prior_advances)

    def test_direct_terminal_cleanup_survives_failure_finalizer_errors(self):
        advances = []

        class FakePostProcessor:
            @staticmethod
            def postprocess_failed(download):
                raise RuntimeError('reconciliation failed')

            @staticmethod
            def terminal_failed(download):
                raise RuntimeError('history failed')

        class FakeConnection:
            def rollback(self):
                return

            def execute(self, query, parameters):
                return

            def commit(self):
                return

        download = SimpleNamespace(
            id=42,
            state=DownloadState.DOWNLOADING_STATE,
            stop=lambda state=DownloadState.CANCELED_STATE: setattr(
                download, 'state', state
            ),
        )
        handler = DownloadHandler.__new__(DownloadHandler)
        handler.queue = [download]
        handler._process_queue = lambda: advances.append(True)
        with patch.object(
            DownloadHandler,
            '_DownloadHandler__run_download_inner',
            side_effect=RuntimeError('worker failed'),
        ), patch.object(
            download_queue, 'PostProcessor', FakePostProcessor
        ), patch.object(
            download_queue, '_emit_queue_event'
        ), patch.object(
            download_queue, 'get_db',
            return_value=SimpleNamespace(connection=FakeConnection()),
        ):
            DownloadHandler._DownloadHandler__run_download(handler, download)
        self.assertEqual(handler.queue, [])
        self.assertEqual(advances, [True])

    def test_worker_records_sanitized_post_processing_failure(self):
        failed = []
        advances = []

        class FakePostProcessor:
            @staticmethod
            def success(download):
                raise RuntimeError('secret path /downloads/private/file.cbz')

            @staticmethod
            def postprocess_failed(download):
                failed.append((download.state, download._failure_reason.copy()))

        class FakeDownload:
            id = 41
            state = DownloadState.QUEUED_STATE
            volume_id = 1
            issue_id = 2
            files = ['/tmp/test.cbz']

            def run(self):
                self.state = DownloadState.DOWNLOADING_STATE

            def stop(self, state=DownloadState.CANCELED_STATE):
                self.state = state

            def as_dict(self):
                return {'id': self.id, 'status': self.state.value}

        download = FakeDownload()
        handler = DownloadHandler.__new__(DownloadHandler)
        handler.settings = SimpleNamespace(
            sv=SimpleNamespace(concurrent_direct_downloads=1)
        )
        handler.queue = [download]
        handler._process_queue = lambda: advances.append(True)

        fake_connection = SimpleNamespace(rollback=lambda: None)
        with patch.object(download_queue, 'PostProcessor', FakePostProcessor), patch.object(
            download_queue, '_emit_queue_event', lambda event: None
        ), patch.object(
            download_queue,
            'get_db',
            return_value=SimpleNamespace(connection=fake_connection),
        ):
            DownloadHandler._DownloadHandler__run_download(handler, download)

        self.assertEqual(handler.queue, [])
        self.assertEqual(failed, [(
            DownloadState.FAILED_STATE,
            {'stage': 'post_processing', 'type': 'RuntimeError'},
        )])
        self.assertTrue(advances)


if __name__ == '__main__':
    import unittest
    unittest.main()
