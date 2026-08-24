import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from backend.base.definitions import DownloadSource, SpecialVersion, VolumeData
from backend.features import post_processing
from backend.implementations.post_processing_state import ensure_postprocessing_record
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
