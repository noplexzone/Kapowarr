import sqlite3
import unittest
from unittest.mock import patch

from backend.base.definitions import LibraryFilter, LibrarySorting, MonitorScheme
from backend.implementations.volumes import Library, Volume


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

    def test_recently_released_sort_uses_set_based_issue_date(self):
        db = _DB([[{'id': 1, 'latest_issue_date': '2024-01-01', '_total_count': 1}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows, total = Library.get_public_volumes_page(
                LibrarySorting.RECENTLY_RELEASED,
                None,
                'comic',
                page=0,
                page_size=60,
            )

        self.assertEqual(rows, [{'id': 1, 'latest_issue_date': '2024-01-01'}])
        self.assertEqual(total, 1)
        query, params = db.calls[0]
        self.assertIn('MAX(i.date) AS latest_issue_date', query)
        self.assertIn(
            'ORDER BY latest_issue_date DESC, title, year, volume_number, volumes.id',
            query,
        )
        self.assertNotIn('(SELECT MAX(date) FROM vol_issues)', query)
        self.assertEqual(params, ('comic', 60, 0))


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
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER, exists_on_disk INTEGER DEFAULT 1);
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
            'INSERT INTO files(id, size) VALUES (?, ?)',
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


    def test_open_issues_use_valid_file_state(self):
        db_conn = sqlite3.connect(':memory:')
        db_conn.row_factory = sqlite3.Row
        db_conn.executescript("""
            CREATE TABLE issues (id INTEGER PRIMARY KEY, volume_id INTEGER, monitored INTEGER, calculated_issue_number REAL);
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER, exists_on_disk INTEGER DEFAULT 1);
            CREATE TABLE issues_files (file_id INTEGER, issue_id INTEGER);
        """)
        db_conn.executemany('INSERT INTO issues VALUES (?, 10, ?, ?)', [(1, 1, 1.0), (2, 1, 2.0), (3, 1, 3.0), (4, 0, 4.0)])
        db_conn.executemany('INSERT INTO files(id, size, exists_on_disk) VALUES (?, 100, ?)', [(10, 1), (20, 0), (30, 1)])
        db_conn.executemany('INSERT INTO issues_files VALUES (?, ?)', [(10, 1), (20, 2), (20, 3), (30, 3)])
        db_conn.commit()
        try:
            with patch('backend.implementations.volumes.get_db', return_value=db_conn):
                self.assertEqual([tuple(row) for row in Volume(10).get_open_issues()], [(2, 2.0)])
        finally:
            db_conn.close()

    def test_monitor_missing_sets_missing_and_clears_valid_files(self):
        db_conn = sqlite3.connect(':memory:')
        db_conn.row_factory = sqlite3.Row
        db_conn.executescript("""
            CREATE TABLE issues (id INTEGER PRIMARY KEY, volume_id INTEGER, monitored INTEGER, calculated_issue_number REAL);
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER, exists_on_disk INTEGER DEFAULT 1);
            CREATE TABLE issues_files (file_id INTEGER, issue_id INTEGER);
        """)
        db_conn.executemany('INSERT INTO issues VALUES (?, 10, ?, ?)', [(1, 0, 1.0), (2, 0, 2.0), (3, 1, 3.0), (4, 1, 4.0)])
        db_conn.executemany('INSERT INTO files(id, size, exists_on_disk) VALUES (?, 100, ?)', [(10, 1), (20, 0), (30, 1)])
        db_conn.executemany('INSERT INTO issues_files VALUES (?, ?)', [(10, 1), (20, 2), (20, 3), (30, 3)])
        db_conn.commit()
        try:
            with patch('backend.implementations.volumes.get_db', return_value=db_conn):
                Volume(10).apply_monitor_scheme(MonitorScheme.MISSING)
                rows = dict(db_conn.execute('SELECT id, monitored FROM issues ORDER BY id').fetchall())
                self.assertEqual(rows, {1: 0, 2: 1, 3: 0, 4: 1})
                self.assertEqual([tuple(row) for row in Volume(10).get_open_issues()], [(2, 2.0), (4, 4.0)])
                Volume(10).apply_monitor_scheme(MonitorScheme.MISSING)
                rows2 = dict(db_conn.execute('SELECT id, monitored FROM issues ORDER BY id').fetchall())
                self.assertEqual(rows2, rows)
        finally:
            db_conn.close()


    def test_completion_sort_uses_released_issue_counts_and_nulls_last(self):
        db_conn = sqlite3.connect(':memory:')
        db_conn.row_factory = sqlite3.Row
        db_conn.executescript("""
            CREATE TABLE root_folders (id INTEGER PRIMARY KEY, section TEXT);
            CREATE TABLE volumes (
                id INTEGER PRIMARY KEY, comicvine_id INTEGER, title TEXT, year INTEGER,
                publisher TEXT, volume_number INTEGER, description TEXT, special_version TEXT,
                monitored INTEGER, monitor_new_issues INTEGER, root_folder INTEGER, folder TEXT
            );
            CREATE TABLE issues (id INTEGER PRIMARY KEY, volume_id INTEGER, monitored INTEGER, date TEXT);
            CREATE TABLE files (id INTEGER PRIMARY KEY, size INTEGER, exists_on_disk INTEGER DEFAULT 1);
            CREATE TABLE issues_files (file_id INTEGER, issue_id INTEGER);
        """)
        db_conn.execute("INSERT INTO root_folders VALUES (1, 'comic')")
        db_conn.executemany(
            "INSERT INTO volumes VALUES (?, ?, ?, 2020, 'Image', 1, '', '', 1, 1, 1, '/v')",
            [(1, 1, 'Alpha'), (2, 2, 'Beta'), (3, 3, 'Gamma')],
        )
        db_conn.executemany('INSERT INTO issues VALUES (?, ?, 1, ?)', [
            (11, 1, '2020-01-01'), (12, 1, '2020-02-01'), (13, 1, '2999-01-01'), (14, 1, None),
            (21, 2, '2020-01-01'), (22, 2, '2020-02-01'),
            (31, 3, None),
        ])
        db_conn.executemany('INSERT INTO files(id, size) VALUES (?, 100)', [(101,), (102,), (201,), (202,)])
        db_conn.executemany('INSERT INTO issues_files VALUES (?, ?)', [(101, 11), (102, 11), (201, 21), (202, 22)])
        db_conn.commit()
        try:
            with patch('backend.implementations.volumes.get_db', return_value=_SqliteDB(db_conn)):
                asc, _ = Library.get_public_volumes_page(LibrarySorting.COMPLETION, None, 'comic', page=0, page_size=10, direction='asc')
                desc, _ = Library.get_public_volumes_page(LibrarySorting.COMPLETION, None, 'comic', page=0, page_size=10, direction='desc')
        finally:
            db_conn.close()
        self.assertEqual([row['id'] for row in asc], [1, 2, 3])
        self.assertEqual([row['completion_percentage'] for row in asc], [50.0, 100.0, None])
        self.assertEqual(asc[0]['released_issue_count'], 2)
        self.assertEqual(asc[0]['released_issues_downloaded'], 1)
        self.assertEqual(asc[0]['upcoming_issue_count'], 1)
        self.assertEqual([row['id'] for row in desc], [2, 1, 3])


if __name__ == '__main__':
    unittest.main()
