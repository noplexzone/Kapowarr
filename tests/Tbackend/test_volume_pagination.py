import sqlite3
import unittest
from unittest.mock import patch

from backend.base.definitions import LibraryFilter, LibrarySorting
from backend.implementations.volumes import Library


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchalldict(self):
        return [dict(row) for row in self.rows]


class _SqliteResult:
    def __init__(self, cursor):
        self.cursor = cursor

    def fetchalldict(self):
        return [dict(row) for row in self.cursor.fetchall()]


class _SqliteDB:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, query, params=()):
        return _SqliteResult(self.connection.execute(query, params))


class _DB:
    def __init__(self, batches):
        self.batches = list(batches)
        self.calls = []

    def execute(self, query, params=()):
        self.calls.append((query, params))
        return _Result(self.batches.pop(0))


class VolumePaginationTests(unittest.TestCase):
    def test_page_uses_bounded_sql_and_returns_truthful_total(self):
        db = _DB([[{'id': 121, 'title': 'Saga', '_total_count': 1167}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows, total = Library.get_public_volumes_page(
                LibrarySorting.TITLE,
                LibraryFilter.MONITORED,
                'comic',
                page=2,
                page_size=60,
            )

        self.assertEqual(total, 1167)
        self.assertEqual(rows, [{'id': 121, 'title': 'Saga'}])
        query, params = db.calls[0]
        self.assertIn('COUNT(*) OVER () AS _total_count', query)
        self.assertIn('LIMIT ? OFFSET ?', query)
        self.assertIn('ORDER BY title, year, volume_number, volumes.id', query)
        self.assertIn('issue_stats AS', query)
        self.assertNotIn('WHERE volume_id = volumes.id', query)
        self.assertNotIn('issues_to_files AS', query)
        self.assertEqual(params, ('comic', 60, 120))

    def test_empty_out_of_range_page_still_reports_total(self):
        db = _DB([[], [{'_total_count': 87}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows, total = Library.get_public_volumes_page(
                section='manga', page=9, page_size=60
            )

        self.assertEqual(rows, [])
        self.assertEqual(total, 87)
        self.assertEqual(db.calls[1][1], ('manga', 1, 0))

    def test_section_and_page_bounds_fail_closed(self):
        with self.assertRaises(ValueError):
            Library.get_public_volumes_page(section='comic\' OR 1=1 --')
        with self.assertRaises(ValueError):
            Library.get_public_volumes_page(page=-1)
        with self.assertRaises(ValueError):
            Library.get_public_volumes_page(page_size=0)

    def test_legacy_list_contract_does_not_leak_total_metadata(self):
        db = _DB([[{'id': 1, '_total_count': 2}, {'id': 2, '_total_count': 2}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows = Library.get_public_volumes()
        self.assertEqual(rows, [{'id': 1}, {'id': 2}])
        self.assertNotIn('LIMIT ? OFFSET ?', db.calls[0][0])

    def test_filtered_pages_use_set_based_issue_stats(self):
        db_conn = sqlite3.connect(':memory:')
        db_conn.row_factory = sqlite3.Row
        db_conn.executescript("""
            CREATE TABLE root_folders (id INTEGER PRIMARY KEY, section TEXT);
            CREATE TABLE volumes (
                id INTEGER PRIMARY KEY,
                comicvine_id INTEGER,
                title TEXT,
                year INTEGER,
                publisher TEXT,
                volume_number INTEGER,
                description TEXT,
                special_version TEXT,
                monitored INTEGER,
                monitor_new_issues INTEGER,
                root_folder INTEGER,
                folder TEXT
            );
            CREATE TABLE issues (
                id INTEGER PRIMARY KEY,
                volume_id INTEGER,
                monitored INTEGER,
                date TEXT
            );
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER);
            CREATE TABLE issues_files (file_id INTEGER, issue_id INTEGER);
        """)
        db_conn.executemany(
            'INSERT INTO root_folders VALUES (?, ?)',
            [(1, 'comic'), (2, 'manga')]
        )
        db_conn.executemany(
            """INSERT INTO volumes VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )""",
            [
                (10, 100, 'Wanted Volume', 2020, 'Image', 1, '', '', 1, 1, 1, '/wanted'),
                (11, 101, 'Complete Volume', 2020, 'Image', 1, '', '', 1, 1, 1, '/complete'),
                (20, 200, 'Manga Wanted', 2020, 'Viz', 1, '', '', 1, 1, 2, '/manga'),
            ]
        )
        db_conn.executemany(
            'INSERT INTO issues VALUES (?, ?, ?, ?)',
            [
                (101, 10, 1, '2020-01-01'),
                (102, 10, 1, '2999-01-01'),
                (103, 10, 0, '2020-01-01'),
                (104, 10, 1, '2020-01-01'),
                (111, 11, 1, '2020-01-01'),
                (201, 20, 1, '2020-01-01'),
            ]
        )
        db_conn.executemany(
            'INSERT INTO files VALUES (?, ?)',
            [(1, 100), (2, 50), (3, 300)]
        )
        db_conn.executemany(
            'INSERT INTO issues_files VALUES (?, ?)',
            [(1, 104), (2, 104), (3, 111)]
        )
        db_conn.commit()

        try:
            with patch('backend.implementations.volumes.get_db', return_value=_SqliteDB(db_conn)):
                wanted, wanted_total = Library.get_public_volumes_page(
                    LibrarySorting.TITLE,
                    LibraryFilter.WANTED,
                    'comic',
                    page=0,
                    page_size=60,
                )
                upcoming, upcoming_total = Library.get_public_volumes_page(
                    LibrarySorting.TITLE,
                    LibraryFilter.UPCOMING,
                    'comic',
                    page=0,
                    page_size=60,
                )
                unmonitored, unmonitored_total = Library.get_public_volumes_page(
                    LibrarySorting.TITLE,
                    LibraryFilter.UNMONITORED,
                    'comic',
                    page=0,
                    page_size=60,
                )
                manga_wanted, manga_total = Library.get_public_volumes_page(
                    LibrarySorting.TITLE,
                    LibraryFilter.WANTED,
                    'manga',
                    page=0,
                    page_size=60,
                )
        finally:
            db_conn.close()

        self.assertEqual([row['id'] for row in wanted], [10])
        self.assertEqual(wanted_total, 1)
        self.assertEqual(wanted[0]['issue_count'], 4)
        self.assertEqual(wanted[0]['issue_count_monitored'], 3)
        self.assertEqual(wanted[0]['issues_downloaded'], 1)
        self.assertEqual(wanted[0]['issues_downloaded_monitored'], 1)
        self.assertEqual(wanted[0]['total_size'], 150)
        self.assertEqual([row['id'] for row in upcoming], [10])
        self.assertEqual(upcoming_total, 1)
        self.assertEqual([row['id'] for row in unmonitored], [10])
        self.assertEqual(unmonitored_total, 1)
        self.assertEqual([row['id'] for row in manga_wanted], [20])
        self.assertEqual(manga_total, 1)


if __name__ == '__main__':
    unittest.main()
