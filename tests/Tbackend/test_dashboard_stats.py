import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask, request as flask_request

from backend.implementations.volumes import Library
import frontend.api as api_mod


class _Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.cursor = None

    def execute(self, query, params=()):
        self.cursor = self.connection.execute(query, params)
        return self

    def fetchonedict(self):
        row = self.cursor.fetchone()
        return dict(row) if row is not None else None

    def fetchall(self):
        return self.cursor.fetchall()


class DashboardStatsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE root_folders (id INTEGER PRIMARY KEY, section TEXT);
            CREATE TABLE volumes (
                id INTEGER PRIMARY KEY,
                root_folder INTEGER,
                monitored INTEGER,
                folder TEXT,
                title TEXT,
                publisher TEXT
            );
            CREATE TABLE issues (id INTEGER PRIMARY KEY, volume_id INTEGER, monitored INTEGER, date TEXT);
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER, exists_on_disk INTEGER DEFAULT 1);
            CREATE TABLE issues_files (issue_id INTEGER, file_id INTEGER);
            CREATE TABLE volume_files (volume_id INTEGER, file_id INTEGER);
            CREATE TABLE download_history (id INTEGER PRIMARY KEY, success INTEGER);
            CREATE TABLE download_queue (id INTEGER PRIMARY KEY);
        ''')
        self.db.executemany('INSERT INTO root_folders VALUES (?, ?)', [(1, 'comic'), (2, 'manga')])
        self.db.executemany('INSERT INTO volumes VALUES (?, ?, ?, ?, ?, ?)', [
            (10, 1, 1, '/comics/Wrong Folder (2020)', 'Saga', 'Image'),
            (11, 1, 1, '/comics/Invincible (2003)', 'Invincible', 'Image'),
            (20, 2, 1, '/manga/Berserk (1989)', 'Berserk', 'Glénat'),
        ])
        self.db.executemany('INSERT INTO issues VALUES (?, ?, ?, ?)', [
            (101, 10, 1, '2020-01-01'),
            (102, 10, 1, '2999-01-01'),
            (103, 10, 0, '2020-01-01'),
            (104, 10, 1, '2020-01-01'),
            (105, 10, 1, None),
            (201, 20, 1, '2020-01-01'),
        ])
        self.db.executemany('INSERT INTO files(id, size) VALUES (?, ?)', [(1, 100), (2, 200), (3, 300), (4, 400)])
        self.db.executemany('INSERT INTO issues_files VALUES (?, ?)', [(104, 1), (201, 3)])
        self.db.execute('INSERT INTO volume_files VALUES (10, 2)')
        self.db.executemany('INSERT INTO download_history VALUES (?, ?)', [(1, 0), (2, 1)])
        self.db.execute('INSERT INTO download_queue VALUES (1)')
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_stats_distinguish_monitored_issue_states_and_section_file_totals(self):
        cursor = _Cursor(self.db)
        with patch('backend.implementations.volumes.get_db', return_value=cursor):
            stats = Library.get_stats('comic')

        self.assertEqual(stats['missing_monitored'], 1)
        self.assertEqual(stats['upcoming_monitored'], 1)
        self.assertEqual(stats['released_issues'], 3)
        self.assertEqual(stats['downloaded_released_issues'], 1)
        self.assertEqual(stats['completion_percentage'], 33.3)
        self.assertEqual(stats['unmonitored_issues'], 1)
        self.assertEqual(stats['failed_downloads'], 1)
        self.assertEqual(stats['active_downloads'], 1)
        self.assertEqual(stats['mismatches'], 1)
        self.assertEqual(stats['files'], 2)
        self.assertEqual(stats['total_file_size'], 300)


    def test_missing_file_state_excludes_invalid_files_from_completion_and_counts(self):
        self.db.execute('UPDATE files SET exists_on_disk = 0 WHERE id = 1')
        self.db.commit()
        cursor = _Cursor(self.db)
        with patch('backend.implementations.volumes.get_db', return_value=cursor):
            stats = Library.get_stats('comic')

        self.assertEqual(stats['missing_monitored'], 2)
        self.assertEqual(stats['downloaded_released_issues'], 0)
        self.assertEqual(stats['completion_percentage'], 0.0)
        self.assertEqual(stats['files'], 1)
        self.assertEqual(stats['total_file_size'], 200)

    def test_empty_section_returns_numeric_zero_counts(self):
        cursor = _Cursor(self.db)
        with patch('backend.implementations.volumes.get_db', return_value=cursor):
            stats = Library.get_stats('empty')

        self.assertEqual(stats['volumes'], 0)
        self.assertEqual(stats['monitored'], 0)
        self.assertEqual(stats['unmonitored'], 0)
        self.assertEqual(stats['files'], 0)
        self.assertEqual(stats['total_file_size'], 0)

    def test_manga_stats_do_not_include_comic_files(self):
        cursor = _Cursor(self.db)
        with patch('backend.implementations.volumes.get_db', return_value=cursor):
            stats = Library.get_stats('manga')

        self.assertEqual(stats['missing_monitored'], 0)
        self.assertEqual(stats['mismatches'], 1)
        self.assertEqual(stats['files'], 1)
        self.assertEqual(stats['total_file_size'], 300)

    def test_section_value_cannot_inject_stats_predicates(self):
        cursor = _Cursor(self.db)
        injection = "comic' OR '1'='1"
        with patch('backend.implementations.volumes.get_db', return_value=cursor):
            stats = Library.get_stats(injection)

        self.assertEqual(stats['volumes'], 0)
        self.assertEqual(stats['issues'], 0)
        self.assertEqual(stats['released_issues'], 0)
        self.assertIsNone(stats['completion_percentage'])
        self.assertEqual(stats['files'], 0)
        self.assertEqual(stats['total_file_size'], 0)

    def test_stats_route_rejects_invalid_section(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        settings = MagicMock()
        settings.sv = SimpleNamespace(auth_password=None)

        with patch.object(api_mod, 'request', flask_request), patch.object(
            api_mod, 'Settings', return_value=settings
        ), patch.object(
            api_mod.StartTypeHandlers, 'diffuse_timer'
        ), patch.object(api_mod.Library, 'get_stats') as get_stats:
            response = app.test_client().get(
                '/api/volumes/stats',
                query_string={'section': "comic' OR '1'='1"},
            )

        self.assertEqual(response.status_code, 400)
        get_stats.assert_not_called()


if __name__ == '__main__':
    unittest.main()
