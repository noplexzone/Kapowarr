import sqlite3
import unittest
from unittest.mock import patch

from backend.implementations.volumes import Library


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


class DashboardStatsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE root_folders (id INTEGER PRIMARY KEY, section TEXT);
            CREATE TABLE volumes (id INTEGER PRIMARY KEY, root_folder INTEGER, monitored INTEGER);
            CREATE TABLE issues (id INTEGER PRIMARY KEY, volume_id INTEGER, monitored INTEGER, date TEXT);
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER);
            CREATE TABLE issues_files (issue_id INTEGER, file_id INTEGER);
            CREATE TABLE volume_files (volume_id INTEGER, file_id INTEGER);
            CREATE TABLE download_history (id INTEGER PRIMARY KEY, success INTEGER);
            CREATE TABLE download_queue (id INTEGER PRIMARY KEY);
        ''')
        self.db.executemany('INSERT INTO root_folders VALUES (?, ?)', [(1, 'comic'), (2, 'manga')])
        self.db.executemany('INSERT INTO volumes VALUES (?, ?, ?)', [(10, 1, 1), (20, 2, 1)])
        self.db.executemany('INSERT INTO issues VALUES (?, ?, ?, ?)', [
            (101, 10, 1, '2020-01-01'),
            (102, 10, 1, '2999-01-01'),
            (103, 10, 0, '2020-01-01'),
            (104, 10, 1, '2020-01-01'),
            (201, 20, 1, '2020-01-01'),
        ])
        self.db.executemany('INSERT INTO files VALUES (?, ?)', [(1, 100), (2, 200), (3, 300), (4, 400)])
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
        self.assertEqual(stats['unmonitored_issues'], 1)
        self.assertEqual(stats['failed_downloads'], 1)
        self.assertEqual(stats['active_downloads'], 1)
        self.assertEqual(stats['import_problems'], 1)
        self.assertEqual(stats['files'], 2)
        self.assertEqual(stats['total_file_size'], 300)

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
        self.assertEqual(stats['files'], 1)
        self.assertEqual(stats['total_file_size'], 300)


if __name__ == '__main__':
    unittest.main()
