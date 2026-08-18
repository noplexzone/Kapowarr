import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from backend.base.definitions import IssueData, SpecialVersion, VolumeData
from backend.implementations.file_matching import scan_files, set_file_matching
from backend.internals.db import DBConnection, DBConnectionManager, close_db, get_db, setup_db


def _issue(issue_id, number):
    return IssueData(id=issue_id, volume_id=1, comicvine_id=1000 + issue_id, issue_number=str(number), calculated_issue_number=float(number), title='', date='2006-01-01', description='', monitored=True, files=[])


class _FakeVolume:
    def __init__(self, volume_data, issues):
        self._volume_data = volume_data
        self._issues = issues
    def get_data(self):
        return self._volume_data
    def get_issues(self, _skip_files=False):
        return list(self._issues)
    def get_all_files(self):
        return get_db().execute("""SELECT DISTINCT f.id, f.filepath, f.size FROM files f INNER JOIN issues_files if ON if.file_id = f.id INNER JOIN issues i ON i.id = if.issue_id WHERE i.volume_id = 1 ORDER BY f.filepath""").fetchalldict()
    def get_general_files(self):
        return []


class RuntimeIntegrityFileMatchingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.ctx = self.app.app_context(); self.ctx.push()
        DBConnection.file = str(Path(self.tmp.name) / 'kapowarr.db')
        setup_db()
        self.folder = Path(self.tmp.name) / 'library'
        self.folder.mkdir()
        db = get_db()
        db.execute("INSERT INTO root_folders(id, folder, section) VALUES(1, ?, 'comic')", (str(self.folder),))
        db.execute("""INSERT INTO volumes(id, comicvine_id, title, year, publisher, root_folder, folder, special_version) VALUES(1, 10, 'The Punisher - War Zone', 1992, 'Marvel', 1, ?, ?)""", (str(self.folder), SpecialVersion.NORMAL.value))
        for n in range(1, 7):
            db.execute("INSERT INTO issues(id, volume_id, comicvine_id, issue_number, calculated_issue_number, monitored) VALUES(?, 1, ?, ?, ?, 1)", (n, 2000+n, str(n).zfill(3), float(n)))
        db.connection.commit()

    def tearDown(self):
        close_db(None)
        DBConnectionManager.close_connection_of_thread()
        self.ctx.pop()
        self.tmp.cleanup()

    def _patch_volume(self, title='The Punisher War Zone', year=1992):
        vd = VolumeData(id=1, comicvine_id=10, title=title, alt_title=None, year=year, volume_number=1, description='', site_url='', publisher='Marvel', monitored=True, monitor_new_issues=True, root_folder=1, folder=str(self.folder), custom_folder=False, special_version=SpecialVersion.NORMAL, special_version_locked=False, last_cv_fetch=0)
        issues = [_issue(n, n) for n in range(1, 7)]
        return patch('backend.implementations.volumes.Volume', return_value=_FakeVolume(vd, issues))

    def test_punisher_suffix_duplicates_keep_one_active_mapping(self):
        (self.folder / 'The Punisher - War Zone 001 (1992).cbz').write_bytes(b'same')
        (self.folder / 'The Punisher - War Zone 001 (1992) (1).cbz').write_bytes(b'same')
        (self.folder / 'The Punisher - War Zone 001 (1992) (2).cbz').write_bytes(b'same')
        with self._patch_volume(), patch('backend.implementations.file_match_conflicts.Settings') as settings:
            settings.return_value.sv.file_match_quarantine_folder = str(Path(self.tmp.name) / 'quarantine')
            scan_files(1, del_unmatched_files=False)
        rows = [tuple(row) for row in get_db().execute('SELECT issue_id, COUNT(*) FROM issues_files GROUP BY issue_id;').fetchall()]
        self.assertEqual(rows, [(1, 1)])
        conflicts = get_db().execute('SELECT reason FROM file_match_conflicts ORDER BY id;').fetchall()
        self.assertTrue(any(row[0] == 'duplicate_content' for row in conflicts))

    def test_nonidentical_duplicates_are_reviewed_without_active_mapping(self):
        (self.folder / 'The Punisher - War Zone 001 (1992).cbz').write_bytes(b'a')
        (self.folder / 'The Punisher - War Zone 001 (1992) (1).cbz').write_bytes(b'b')
        with self._patch_volume():
            scan_files(1, del_unmatched_files=False)
        rows = [tuple(row) for row in get_db().execute('SELECT issue_id, COUNT(*) FROM issues_files GROUP BY issue_id;').fetchall()]
        self.assertEqual(rows, [])
        conflicts = get_db().execute('SELECT reason FROM file_match_conflicts ORDER BY id;').fetchall()
        self.assertTrue(any(row[0] == 'nonidentical_duplicate' for row in conflicts))

    def test_crisis_range_is_reviewed_and_exact_issue_two_maps(self):
        get_db().execute("UPDATE volumes SET title = 'Crisis Aftermath The Battle for Blüdhaven', year = 2006 WHERE id = 1")
        get_db().connection.commit()
        (self.folder / 'Crisis Aftermath - The Battle for Blüdhaven 001 - 002 (2006).cbz').write_bytes(b'range')
        (self.folder / 'Crisis Aftermath - The Battle for Blüdhaven 002 (2006).cbz').write_bytes(b'exact')
        with self._patch_volume('Crisis Aftermath - The Battle for Blüdhaven', 2006):
            scan_files(1, del_unmatched_files=False)
        mapped = [tuple(row) for row in get_db().execute('SELECT issue_id FROM issues_files ORDER BY issue_id;').fetchall()]
        self.assertEqual(mapped, [(2,)])
        conflicts = get_db().execute('SELECT reason, filepath FROM file_match_conflicts;').fetchall()
        self.assertEqual(conflicts[0][0], 'multi_issue_range')
        self.assertIn('001 - 002', conflicts[0][1])


    def test_schema_enforces_unique_file_and_issue_relationships(self):
        indexes = {row['name'] for row in get_db().execute('PRAGMA index_list(issues_files);').fetchall()}
        self.assertIn('issues_files_file_id_unique_idx', indexes)
        self.assertIn('issues_files_issue_id_unique_idx', indexes)
        fp1 = self.folder / 'The Punisher - War Zone 001 (1992).cbz'; fp1.write_bytes(b'one')
        fp2 = self.folder / 'The Punisher - War Zone 002 (1992).cbz'; fp2.write_bytes(b'two')
        db = get_db()
        db.execute('INSERT INTO files(id, filepath, size) VALUES(1, ?, 1)', (str(fp1),))
        db.execute('INSERT INTO files(id, filepath, size) VALUES(2, ?, 1)', (str(fp2),))
        db.execute('INSERT INTO issues_files(file_id, issue_id) VALUES(1, 1)')
        with self.assertRaises(Exception):
            db.execute('INSERT INTO issues_files(file_id, issue_id) VALUES(1, 2)')
        with self.assertRaises(Exception):
            db.execute('INSERT INTO issues_files(file_id, issue_id) VALUES(2, 1)')

    def test_manual_forced_match_rejects_multi_issue(self):
        fp = self.folder / 'The Punisher - War Zone 001 (1992).cbz'
        fp.write_bytes(b'comic')
        with self.assertRaises(ValueError):
            set_file_matching(1, [{'filepath': str(fp), 'issue_ids': [1, 2], 'general_file': False, 'forced_match': True}])
