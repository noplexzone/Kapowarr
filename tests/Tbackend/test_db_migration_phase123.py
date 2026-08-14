
import sqlite3
from contextlib import closing
from contextlib import contextmanager
import tempfile
import unittest
from pathlib import Path
from flask import Flask
from backend.internals.db import DB_SCHEMA, DBConnection, DBConnectionManager, close_db, setup_db
from backend.internals.db_migration import DatabaseMigrationHandler
from backend.internals.settings import Settings

METRON_TABLES = {'volume_provider_links', 'provider_cache', 'volume_enrichment_terms', 'metron_backfill_state'}

def table_columns(cursor, table):
    return {row[1] for row in cursor.execute(f'PRAGMA table_info({table});')}

def table_exists(cursor, table):
    return cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;", (table,)).fetchone() is not None

class Phase123MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / 'Kapowarr.db'
        self.app = Flask(__name__)
        DBConnectionManager.instances.clear()
        DBConnection.file = str(self.db_path)
        Settings._instances.clear()

    def tearDown(self):
        with self.app.app_context():
            close_db(None)
        DBConnectionManager.instances.clear()
        Settings._instances.clear()
        self.tmpdir.cleanup()

    @contextmanager
    def _connect(self):
        with closing(sqlite3.connect(self.db_path)) as con:
            try:
                yield con
            except Exception:
                con.rollback()
                raise
            else:
                con.commit()

    def _run_setup(self):
        DBConnectionManager.instances.clear()
        Settings._instances.clear()
        with self.app.app_context():
            setup_db()
            close_db(None)
        DBConnectionManager.instances.clear()
        Settings._instances.clear()

    def _seed_schema(self, version):
        with self._connect() as con:
            con.executescript(DB_SCHEMA)
            con.execute("INSERT OR REPLACE INTO config(key, value) VALUES ('database_version', ?);", (version,))


    def _drop_metron_tables(self, con):
        for table in METRON_TABLES:
            con.execute(f'DROP TABLE IF EXISTS {table};')

    def _create_saved_filters(self, con):
        con.execute('''
            CREATE TABLE IF NOT EXISTS saved_filters(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section TEXT NOT NULL CHECK(section IN ('comic', 'manga')),
                name TEXT NOT NULL,
                query TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(section, name)
            );
        ''')

    def _assert_normalized(self):
        with self._connect() as con:
            version = con.execute("SELECT value FROM config WHERE key='database_version';").fetchone()[0]
            self.assertEqual(int(version), DatabaseMigrationHandler.latest_db_version())
            self.assertFalse(table_exists(con, 'saved_filters'))
            for table in METRON_TABLES:
                self.assertTrue(table_exists(con, table), table)
            self.assertEqual(table_columns(con, 'volume_provider_links'), {'id', 'volume_id', 'provider', 'resource_type', 'external_id', 'match_method', 'match_confidence', 'review_status', 'linked_at', 'last_successful_enrichment', 'last_checked'})
            self.assertTrue({'payload', 'etag', 'last_modified', 'fetched_at', 'expires_at'} <= table_columns(con, 'provider_cache'))
            self.assertTrue({'term_type', 'external_id', 'name'} <= table_columns(con, 'volume_enrichment_terms'))
            self.assertTrue({'status', 'processed', 'matched', 'failed'} <= table_columns(con, 'metron_backfill_state'))

    def test_fresh_database_has_normalized_schema(self):
        self._run_setup(); self._assert_normalized()

    def test_pre_phase_database_migrates_from_56(self):
        self._seed_schema(56); self._run_setup(); self._assert_normalized()

    def test_version_57_database_with_saved_views_migrates(self):
        self._seed_schema(57)
        with self._connect() as con:
            self._drop_metron_tables(con)
            self._create_saved_filters(con)
            con.execute("INSERT INTO saved_filters(section, name, query, created_at, updated_at) VALUES ('comic', 'Missing', '{}', 1, 1);")
        self._run_setup(); self._assert_normalized()

    def test_phase1_version_58_schema_gets_metron_tables(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute('DROP TABLE IF EXISTS saved_filters;')
        self._run_setup(); self._assert_normalized()

    def test_phase6_experimental_version_58_preserves_metron_rows_and_drops_saved_views(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._create_saved_filters(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, year, publisher, root_folder) VALUES (1, 123, 'Experimental', 2026, 'Test', 1);")
            con.executescript("""
                CREATE TABLE IF NOT EXISTS volume_provider_links(id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, match_method TEXT NOT NULL DEFAULT '', match_confidence REAL, review_status TEXT NOT NULL DEFAULT 'linked', linked_at INTEGER NOT NULL, last_successful_enrichment INTEGER, last_checked INTEGER);
                CREATE TABLE IF NOT EXISTS provider_cache(provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, payload TEXT NOT NULL, etag TEXT, last_modified TEXT, fetched_at INTEGER NOT NULL, expires_at INTEGER, PRIMARY KEY(provider, resource_type, external_id));
                INSERT INTO volume_provider_links(volume_id, provider, resource_type, external_id, linked_at) VALUES (1, 'metron', 'series', 'm-123', 10);
                INSERT INTO provider_cache(provider, resource_type, external_id, payload, fetched_at) VALUES ('metron', 'series', 'm-123', '{"id":"m-123"}', 11);
                INSERT INTO saved_filters(section, name, query, created_at, updated_at) VALUES ('comic', 'Old', '{}', 1, 1);
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertEqual(con.execute("SELECT external_id FROM volume_provider_links;").fetchone()[0], 'm-123')
            self.assertEqual(con.execute("SELECT payload FROM provider_cache;").fetchone()[0], '{"id":"m-123"}')

    def test_partially_created_metron_schema_is_completed(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("CREATE TABLE volume_provider_links(id INTEGER PRIMARY KEY, volume_id INTEGER, provider TEXT);")
            con.execute("CREATE TABLE provider_cache(provider TEXT, resource_type TEXT, external_id TEXT, payload TEXT);")
        self._run_setup(); self._assert_normalized()

    def test_existing_library_data_is_preserved(self):
        self._seed_schema(56)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, year, publisher, root_folder, folder) VALUES (7, 777, 'Kept Volume', 2020, 'Publisher', 1, '/comics/Kept Volume');")
            con.execute("INSERT INTO issues(id, volume_id, comicvine_id, issue_number, calculated_issue_number, title) VALUES (8, 7, 778, '1', 1.0, 'Kept Issue');")
            con.execute("INSERT INTO files(id, filepath, size) VALUES (9, '/comics/Kept Volume/001.cbz', 1234);")
            con.execute("INSERT INTO issues_files(file_id, issue_id) VALUES (9, 8);")
            con.execute("INSERT OR REPLACE INTO config(key, value) VALUES ('host', '127.0.0.1');")
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertEqual(con.execute("SELECT title FROM volumes WHERE id=7;").fetchone()[0], 'Kept Volume')
            self.assertEqual(con.execute("SELECT filepath FROM files WHERE id=9;").fetchone()[0], '/comics/Kept Volume/001.cbz')
            self.assertEqual(con.execute("SELECT value FROM config WHERE key='host';").fetchone()[0], '127.0.0.1')

    def test_existing_metron_link_cache_and_terms_records_are_preserved(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                CREATE TABLE volume_provider_links(id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, match_method TEXT NOT NULL DEFAULT '', match_confidence REAL, review_status TEXT NOT NULL DEFAULT 'linked', linked_at INTEGER NOT NULL, last_successful_enrichment INTEGER, last_checked INTEGER);
                CREATE TABLE provider_cache(provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY(provider, resource_type, external_id));
                CREATE TABLE volume_enrichment_terms(volume_id INTEGER NOT NULL, provider TEXT NOT NULL, term_type TEXT NOT NULL, external_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, UNIQUE(volume_id, provider, term_type, external_id, name));
                INSERT INTO volume_provider_links(volume_id, provider, resource_type, external_id, linked_at) VALUES (1, 'metron', 'series', '42', 1);
                INSERT INTO provider_cache(provider, resource_type, external_id, payload, fetched_at) VALUES ('metron', 'series', '42', '{"id":42}', 2);
                INSERT INTO volume_enrichment_terms(volume_id, provider, term_type, external_id, name) VALUES (1, 'metron', 'genre', 'noir', 'Noir');
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM volume_provider_links;").fetchone()[0], 1)
            self.assertEqual(con.execute("SELECT name FROM volume_enrichment_terms;").fetchone()[0], 'Noir')

    def test_only_one_handler_registered_for_each_start_version(self):
        versions = list(DatabaseMigrationHandler.handlers)
        self.assertEqual(len(versions), len(set(versions)))
        self.assertIn(57, DatabaseMigrationHandler.handlers)
        self.assertIn(58, DatabaseMigrationHandler.handlers)

if __name__ == '__main__':
    unittest.main()
