import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from backend.base.definitions import (
    DownloadSource, DownloadState, SpecialVersion, VolumeData,
)
from backend.features import post_processing
from backend.implementations.post_processing_state import (
    ensure_postprocessing_record, update_postprocessing_state,
)
from backend.internals.db import DBConnection, DBConnectionManager, close_db, get_db, setup_db


class GetComicsPostprocessingStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.ctx = self.app.app_context()
        self.ctx.push()
        DBConnection.file = str(Path(self.tmp.name) / 'kapowarr.db')
        setup_db()
        self.folder = Path(self.tmp.name) / 'library'
        self.folder.mkdir()
        db = get_db()
        db.execute("INSERT INTO root_folders(id, folder, section) VALUES(1, ?, 'comic')", (str(self.folder),))
        db.execute("""INSERT INTO volumes(id, comicvine_id, title, year, publisher, root_folder, folder, special_version) VALUES(1, 10, 'The Punisher', 1992, 'Marvel', 1, ?, ?)""", (str(self.folder), SpecialVersion.NORMAL.value))
        db.execute("INSERT INTO issues(id, volume_id, comicvine_id, issue_number, calculated_issue_number, monitored) VALUES(1, 1, 2001, '001', 1.0, 1)")
        db.connection.commit()

    def tearDown(self):
        close_db(None)
        DBConnectionManager.close_connection_of_thread()
        self.ctx.pop()
        self.tmp.cleanup()

    def _download(self, source=DownloadSource.GETCOMICS):
        source_file = Path(self.tmp.name) / 'download.cbz'
        source_file.write_bytes(b'comic')
        return SimpleNamespace(
            id=77,
            volume_id=1,
            issue_id=1,
            covered_issues=1.0,
            source_type=source,
            source_name='GetComics',
            download_link='https://getcomics.org/download/punisher',
            web_link='https://getcomics.org/punisher',
            web_title='The Punisher',
            web_sub_title='GetComics Release',
            files=[str(source_file)],
            filename_body='The Punisher 001 (1992)',
            title='The Punisher 001',
            _destination_backups=[],
        )

    def test_getcomics_lifecycle_persists_staged_analyzed_applying_completed(self):
        download = self._download()
        vd = VolumeData(id=1, comicvine_id=10, title='The Punisher', alt_title=None, year=1992, volume_number=1, description='', site_url='', publisher='Marvel', monitored=True, monitor_new_issues=True, root_folder=1, folder=str(self.folder), custom_folder=False, special_version=SpecialVersion.NORMAL, special_version_locked=False, last_cv_fetch=0)
        with patch('backend.features.post_processing.Volume', return_value=SimpleNamespace(vd=vd)):
            post_processing.move_to_dest(download)
        row = get_db().execute('SELECT state, download_link FROM download_postprocessing_state WHERE download_id = 77').fetchone()
        self.assertEqual(row['state'], 'staged')
        self.assertEqual(row['download_link'], 'https://getcomics.org/download/punisher')

        with patch('backend.features.post_processing.scan_files'):
            post_processing.add_file_to_database(download)
        self.assertEqual(get_db().execute('SELECT state FROM download_postprocessing_state WHERE download_id = 77').fetchone()['state'], 'applying')

        post_processing.remove_from_queue(download)
        row = get_db().execute('SELECT state, completed_at FROM download_postprocessing_state WHERE download_id = 77').fetchone()
        self.assertEqual(row['state'], 'completed')
        self.assertIsNotNone(row['completed_at'])

    def test_getcomics_conflict_and_rollback_are_persisted(self):
        download = self._download()
        ensure_postprocessing_record(download)
        get_db().execute("""
            INSERT INTO file_match_conflicts(volume_id, filepath, proposed_issue_numbers, reason, source_type, parser_result, created_at)
            VALUES(1, ?, '[1]', 'multi_issue_range', 'scan', '{}', 1)
        """, (download.files[0],))
        with patch('backend.features.post_processing.scan_files'):
            post_processing.add_file_to_database(download)
        row = get_db().execute('SELECT state, stage_details FROM download_postprocessing_state WHERE download_id = 77').fetchone()
        self.assertEqual(row['state'], 'conflict')
        self.assertIn('multi_issue_range', row['stage_details'])

        post_processing.remove_from_queue(download)
        self.assertEqual(
            get_db().execute('SELECT state FROM download_postprocessing_state WHERE download_id = 77').fetchone()['state'],
            'conflict',
        )

        with patch('backend.features.post_processing.scan_files'):
            post_processing.reconcile_failed_import(download)
        row = get_db().execute('SELECT state, completed_at FROM download_postprocessing_state WHERE download_id = 77').fetchone()
        self.assertEqual(row['state'], 'rolled_back')
        self.assertIsNotNone(row['completed_at'])

    def test_non_getcomics_downloads_are_not_tracked(self):
        download = self._download(source=DownloadSource.PIXELDRAIN)
        self.assertIsNone(ensure_postprocessing_record(download))
        self.assertEqual(get_db().execute('SELECT COUNT(*) FROM download_postprocessing_state').fetchone()[0], 0)

    def test_reused_queue_id_creates_a_fresh_lifecycle_row(self):
        first = self._download()
        first_id = ensure_postprocessing_record(first)
        update_postprocessing_state(first, 'completed', {'attempt': 1})

        second = self._download()
        second_id = ensure_postprocessing_record(second)

        self.assertNotEqual(second_id, first_id)
        rows = get_db().execute(
            """SELECT state, stage_details, completed_at
            FROM download_postprocessing_state
            WHERE download_id = 77 ORDER BY id"""
        ).fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['state'], 'completed')
        self.assertIsNotNone(rows[0]['completed_at'])
        self.assertEqual(rows[1]['state'], 'staged')
        self.assertEqual(rows[1]['stage_details'], '{}')
        self.assertIsNone(rows[1]['completed_at'])

    def test_conflicted_postprocessing_history_is_not_successful(self):
        download = self._download()
        download.state = DownloadState.IMPORTING_STATE
        download.task_history_id = 0
        ensure_postprocessing_record(download)
        update_postprocessing_state(
            download,
            'conflict',
            {'conflicts': [{'reason': 'multi_issue_range'}]},
        )

        post_processing.add_to_history(download)

        row = get_db().execute(
            'SELECT success, failure_reason FROM download_history'
        ).fetchone()
        self.assertEqual(row['success'], 0)
        self.assertIn('post_processing_conflict', row['failure_reason'])

    def test_conversion_reconciles_conflict_paths_and_stage_details(self):
        download = self._download()
        source_path = Path(download.files[0])
        old_path = source_path.with_suffix('.cbr')
        source_path.rename(old_path)
        download.files = [str(old_path)]
        new_path = old_path.with_suffix('.cbz')
        ensure_postprocessing_record(download)
        get_db().execute(
            """INSERT INTO file_match_conflicts(
                volume_id, filepath, proposed_issue_numbers, reason,
                source_type, parser_result, created_at
            ) VALUES(1, ?, '[1]', 'multi_issue_range', 'scan', '{}', 1)""",
            (str(old_path),),
        )
        other_folder = self.folder / 'other-volume'
        other_folder.mkdir()
        get_db().execute(
            """INSERT INTO volumes(
                id, comicvine_id, title, year, publisher, root_folder,
                folder, special_version
            ) VALUES(2, 20, 'Other Volume', 1992, 'Marvel', 1, ?, ?)""",
            (str(other_folder), SpecialVersion.NORMAL.value),
        )
        get_db().execute(
            """INSERT INTO file_match_conflicts(
                volume_id, filepath, proposed_issue_numbers, reason,
                source_type, parser_result, created_at
            ) VALUES(2, ?, '[1]', 'multi_issue_range', 'scan', '{}', 1)""",
            (str(old_path),),
        )
        update_postprocessing_state(
            download,
            'conflict',
            {
                'conflicts': [{
                    'filepath': str(old_path),
                    'reason': 'multi_issue_range',
                }],
                'files': [str(old_path)],
            },
        )

        def convert(*_args, **_kwargs):
            old_path.unlink()
            new_path.write_bytes(b'converted')
            return [str(new_path)]

        with patch.object(
            post_processing, 'Settings',
            return_value=SimpleNamespace(sv=SimpleNamespace(convert=True)),
        ), patch.object(post_processing, 'mass_convert', side_effect=convert):
            post_processing.convert_file(download)

        conflicts = get_db().execute(
            """SELECT volume_id, filepath, resolved_at, resolution
            FROM file_match_conflicts ORDER BY id"""
        ).fetchall()
        conflict = conflicts[0]
        unrelated = conflicts[1]
        state = get_db().execute(
            """SELECT state, stage_details
            FROM download_postprocessing_state WHERE id = ?""",
            (download._postprocessing_state_id,),
        ).fetchone()
        self.assertEqual(conflict['filepath'], str(old_path))
        self.assertIsNotNone(conflict['resolved_at'])
        self.assertEqual(
            conflict['resolution'], 'converted_filepath_replaced'
        )
        self.assertEqual(unrelated['volume_id'], 2)
        self.assertEqual(unrelated['filepath'], str(old_path))
        self.assertIsNone(unrelated['resolved_at'])
        self.assertIsNone(unrelated['resolution'])
        self.assertEqual(state['state'], 'applying')
        self.assertIn(str(new_path), state['stage_details'])
        self.assertNotIn(str(old_path), state['stage_details'])
        self.assertEqual(download.files, [str(new_path)])

    def test_one_to_many_conversion_rebuilds_current_conflict_paths(self):
        download = self._download()
        source_path = Path(download.files[0])
        old_path = source_path.with_suffix('.zip')
        source_path.rename(old_path)
        download.files = [str(old_path)]
        outputs = [
            old_path.with_name('Punisher 001.cbz'),
            old_path.with_name('Punisher 002.cbz'),
        ]
        ensure_postprocessing_record(download)
        get_db().execute(
            """INSERT INTO file_match_conflicts(
                volume_id, filepath, proposed_issue_numbers, reason,
                source_type, parser_result, created_at
            ) VALUES(1, ?, '[1,2]', 'multi_issue_range', 'scan', '{}', 1)""",
            (str(old_path),),
        )
        update_postprocessing_state(
            download,
            'conflict',
            {'files': [str(old_path)]},
        )

        def convert(*_args, **_kwargs):
            old_path.unlink()
            for index, output in enumerate(outputs, 1):
                output.write_bytes(b'converted')
                get_db().execute(
                    """INSERT INTO file_match_conflicts(
                        volume_id, filepath, proposed_issue_numbers, reason,
                        source_type, parser_result, created_at
                    ) VALUES(1, ?, ?, 'nonidentical_duplicate',
                             'scan', '{}', 2)""",
                    (str(output), f'[{index}]'),
                )
            return [str(output) for output in outputs]

        with patch.object(
            post_processing, 'Settings',
            return_value=SimpleNamespace(sv=SimpleNamespace(convert=True)),
        ), patch.object(post_processing, 'mass_convert', side_effect=convert):
            post_processing.convert_file(download)

        rows = get_db().execute(
            """SELECT filepath, resolved_at, resolution
            FROM file_match_conflicts ORDER BY id"""
        ).fetchall()
        self.assertEqual(rows[0]['filepath'], str(old_path))
        self.assertIsNotNone(rows[0]['resolved_at'])
        self.assertEqual(
            rows[0]['resolution'], 'converted_filepath_replaced'
        )
        self.assertEqual(
            [row['filepath'] for row in rows[1:]],
            [str(output) for output in outputs],
        )
        self.assertTrue(all(row['resolved_at'] is None for row in rows[1:]))

        state = get_db().execute(
            """SELECT state, stage_details
            FROM download_postprocessing_state WHERE id = ?""",
            (download._postprocessing_state_id,),
        ).fetchone()
        self.assertEqual(state['state'], 'conflict')
        self.assertNotIn(str(old_path), state['stage_details'])
        for output in outputs:
            self.assertIn(str(output), state['stage_details'])
        self.assertEqual(download.files, [str(output) for output in outputs])
