
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

METRON_TABLES = {'volume_provider_links', 'provider_cache', 'volume_enrichment_terms', 'metron_backfill_state', 'provider_match_candidates', 'metron_enrichment_task_reservations', 'volume_metadata_enrichment', 'provider_rate_limit_state'}

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

    def test_interrupted_normalization_preserves_final_and_backup_metron_rows(self):
        self._seed_schema(58)
        with self._connect() as con:
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Final Linked', 1);")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (2, 2, 'Backup Linked', 1);")
            con.executescript("""
                CREATE TABLE volume_provider_links_migration_58_backup(id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, match_method TEXT NOT NULL DEFAULT '', match_confidence REAL, review_status TEXT NOT NULL DEFAULT 'linked', linked_at INTEGER NOT NULL, last_successful_enrichment INTEGER, last_checked INTEGER);
                CREATE TABLE provider_cache_migration_58_backup(provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY(provider, resource_type, external_id));
                INSERT INTO volume_provider_links(volume_id, provider, resource_type, external_id, linked_at) VALUES (1, 'metron', 'series', 'final-row', 10);
                INSERT INTO volume_provider_links_migration_58_backup(volume_id, provider, resource_type, external_id, linked_at) VALUES (2, 'metron', 'series', 'backup-row', 20);
                INSERT INTO provider_cache(provider, resource_type, external_id, payload, fetched_at) VALUES ('metron', 'series', 'final-row', '{"source":"final"}', 10);
                INSERT INTO provider_cache_migration_58_backup(provider, resource_type, external_id, payload, fetched_at) VALUES ('metron', 'series', 'backup-row', '{"source":"backup"}', 20);
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            links = con.execute("SELECT volume_id, external_id FROM volume_provider_links ORDER BY volume_id;").fetchall()
            caches = con.execute("SELECT external_id, payload FROM provider_cache ORDER BY external_id;").fetchall()
            self.assertEqual(links, [(1, 'final-row'), (2, 'backup-row')])
            self.assertEqual(caches, [('backup-row', '{"source":"backup"}'), ('final-row', '{"source":"final"}')])
            self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_backup'))
            self.assertFalse(table_exists(con, 'provider_cache_migration_58_backup'))

    def _create_link_variant(self, con, table_name, volume_id, external_id, fetched_at=10):
        con.execute(f"""CREATE TABLE {table_name}(id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, match_method TEXT NOT NULL DEFAULT '', match_confidence REAL, review_status TEXT NOT NULL DEFAULT 'linked', linked_at INTEGER NOT NULL, last_successful_enrichment INTEGER, last_checked INTEGER);""")
        con.execute(f"INSERT INTO {table_name}(volume_id, provider, resource_type, external_id, linked_at, last_successful_enrichment) VALUES (?, 'metron', 'series', ?, ?, ?);", (volume_id, external_id, fetched_at, fetched_at))

    def test_metron_recovery_state_machine_reads_live_backup_and_staging_sources(self):
        cases = [
            ('live_only', True, False, False, False, ['live-row']),
            ('backup_only', False, True, False, False, ['backup-row']),
            ('staging_only', False, False, True, False, ['staging-row']),
            ('current_live_only', False, False, False, True, ['current-live-row']),
            ('live_backup', True, True, False, False, ['live-row', 'backup-row']),
            ('live_current_live', True, False, False, True, ['live-row', 'current-live-row']),
            ('live_staging', True, False, True, False, ['live-row', 'staging-row']),
            ('backup_staging', False, True, True, False, ['backup-row', 'staging-row']),
            ('backup_current_live', False, True, False, True, ['backup-row', 'current-live-row']),
            ('all_four_source_variants', True, True, True, True, ['live-row', 'backup-row', 'staging-row', 'current-live-row']),
            ('none', False, False, False, False, []),
        ]
        for name, live, backup, staging, current_live, expected in cases:
            with self.subTest(name=name):
                self.tearDown(); self.setUp()
                self._seed_schema(58)
                with self._connect() as con:
                    self._drop_metron_tables(con)
                    con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
                    for idx in range(1, 5):
                        con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (?, ?, ?, 1);", (idx, idx, f'Volume {idx}'))
                    if live:
                        self._create_link_variant(con, 'volume_provider_links', 1, 'live-row', 10)
                    if backup:
                        self._create_link_variant(con, 'volume_provider_links_migration_58_backup', 2, 'backup-row', 20)
                    if staging:
                        self._create_link_variant(con, 'volume_provider_links_migration_58_final', 3, 'staging-row', 30)
                    if current_live:
                        self._create_link_variant(con, 'volume_provider_links_migration_58_current_live', 4, 'current-live-row', 40)
                self._run_setup(); self._assert_normalized()
                with self._connect() as con:
                    rows = [row[0] for row in con.execute("SELECT external_id FROM volume_provider_links ORDER BY external_id;").fetchall()]
                    self.assertEqual(rows, sorted(expected))
                    self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_backup'))
                    self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_final'))
                    self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_live'))
                    self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_current_live'))

    def test_metron_recovery_reads_preexisting_live_source_without_dropping_current_live(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            for idx in range(1, 3):
                con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (?, ?, ?, 1);", (idx, idx, f'Volume {idx}'))
            self._create_link_variant(con, 'volume_provider_links_migration_58_live', 1, 'live-source-row', 10)
            self._create_link_variant(con, 'volume_provider_links', 2, 'current-live-row', 20)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            rows = con.execute("SELECT id, volume_id, external_id FROM volume_provider_links ORDER BY volume_id;").fetchall()
            self.assertEqual([row[2] for row in rows], ['live-source-row', 'current-live-row'])
            self.assertTrue(all(row[0] is not None for row in rows))
            self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_current_live'))


    def test_invalid_current_live_rows_are_explained_as_rejected(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("CREATE TABLE volume_provider_links_migration_58_current_live(id INTEGER PRIMARY KEY, volume_id INTEGER NOT NULL, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, linked_at INTEGER NOT NULL);")
            con.execute("INSERT INTO volume_provider_links_migration_58_current_live(id, volume_id, provider, resource_type, external_id, linked_at) VALUES (10, 999, 'metron', 'series', 'orphan', 1);")
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertFalse(table_exists(con, 'volume_provider_links_migration_58_current_live'))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM volume_provider_links WHERE external_id='orphan';").fetchone()[0], 0)

    def test_candidate_identity_keeps_separate_review_groups_and_reservations(self):
        self._seed_schema(61)
        with self._connect() as con:
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                DROP TABLE provider_match_candidates;
                DROP TABLE metron_enrichment_task_reservations;
                CREATE TABLE provider_match_candidates(id INTEGER PRIMARY KEY, volume_id INTEGER, provider TEXT, resource_type TEXT, candidate_external_id TEXT, title TEXT, review_group_id TEXT, created_at INTEGER, updated_at INTEGER);
                CREATE TABLE metron_enrichment_task_reservations(id INTEGER PRIMARY KEY, volume_id INTEGER, candidate_id INTEGER, task_queue_id INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER);
                INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, created_at, updated_at) VALUES (7, 1, 'metron', 'series', 'same', 'Candidate A', 'group-a', 10, 10);
                INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, created_at, updated_at) VALUES (8, 1, 'metron', 'series', 'same', 'Candidate B', 'group-b', 11, 11);
                INSERT INTO metron_enrichment_task_reservations(id, volume_id, candidate_id, task_queue_id, status, created_at, updated_at) VALUES (17, 1, 7, 100, 'reserved', 10, 10);
                INSERT INTO metron_enrichment_task_reservations(id, volume_id, candidate_id, task_queue_id, status, created_at, updated_at) VALUES (18, 1, 8, 101, 'queued', 11, 11);
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            candidates = con.execute("SELECT id, review_group_id FROM provider_match_candidates ORDER BY id;").fetchall()
            reservations = con.execute("SELECT id, candidate_id, task_queue_id FROM metron_enrichment_task_reservations ORDER BY id;").fetchall()
            self.assertEqual(candidates, [(7, 'group-a'), (8, 'group-b')])
            self.assertEqual(reservations, [(18, 8, 101)])
            self.assertEqual(con.execute('PRAGMA foreign_key_check;').fetchall(), [])

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


    def test_metron_schema_with_wrong_nullability_is_rebuilt_and_preserves_rows(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.execute("CREATE TABLE volume_provider_links(id INTEGER PRIMARY KEY, volume_id INTEGER, provider TEXT, resource_type TEXT, external_id TEXT, linked_at INTEGER);")
            con.execute("INSERT INTO volume_provider_links(id, volume_id, provider, resource_type, external_id, linked_at) VALUES (4, 1, 'metron', 'series', 'old', 5);")
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            cols = {row[1]: row for row in con.execute('PRAGMA table_info(volume_provider_links);')}
            self.assertEqual(cols['provider'][3], 1)
            self.assertEqual(con.execute('SELECT external_id FROM volume_provider_links;').fetchone()[0], 'old')

    def test_duplicate_provider_links_are_merged_deterministically(self):
        self._seed_schema(58)
        with self._connect() as con:
            self._drop_metron_tables(con)
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                CREATE TABLE volume_provider_links(id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, match_method TEXT NOT NULL DEFAULT '', match_confidence REAL, review_status TEXT NOT NULL DEFAULT 'linked', linked_at INTEGER NOT NULL, last_successful_enrichment INTEGER, last_checked INTEGER);
                INSERT INTO volume_provider_links(id, volume_id, provider, resource_type, external_id, linked_at, last_successful_enrichment) VALUES (1, 1, 'metron', 'series', 'older', 1, 10);
                INSERT INTO volume_provider_links(id, volume_id, provider, resource_type, external_id, linked_at, last_successful_enrichment) VALUES (2, 1, 'metron', 'series', 'newer', 2, 20);
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            rows = con.execute('SELECT external_id FROM volume_provider_links;').fetchall()
            self.assertEqual(rows, [('newer',)])

    def test_later_metron_experimental_tables_are_normalized_and_preserve_rows(self):
        self._seed_schema(59)
        with self._connect() as con:
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                DROP TABLE provider_match_candidates;
                DROP TABLE volume_metadata_enrichment;
                DROP TABLE provider_rate_limit_state;
                CREATE TABLE provider_match_candidates(id INTEGER PRIMARY KEY, volume_id INTEGER, provider TEXT, resource_type TEXT, candidate_external_id TEXT, title TEXT, review_group_id TEXT, created_at INTEGER);
                CREATE TABLE volume_metadata_enrichment(volume_id INTEGER, provider TEXT, field_name TEXT, normalized_value TEXT, updated_at INTEGER);
                CREATE TABLE provider_rate_limit_state(provider TEXT, resume_at INTEGER, updated_at INTEGER);
                INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, created_at) VALUES (7, 1, 'metron', 'series', 'm-1', 'Candidate', 'group-1', 10);
                INSERT INTO volume_metadata_enrichment(volume_id, provider, field_name, normalized_value, updated_at) VALUES (1, 'metron', 'publisher', 'DC', 11);
                INSERT INTO provider_rate_limit_state(provider, resume_at, updated_at) VALUES ('metron', 100, 12);
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertEqual(con.execute("SELECT candidate_external_id, payload, review_status FROM provider_match_candidates;").fetchone(), ('m-1', '{}', 'review_required'))
            self.assertEqual(con.execute("SELECT normalized_value, external_provider_id, active FROM volume_metadata_enrichment;").fetchone(), ('DC', '', 1))
            self.assertEqual(con.execute("SELECT provider, resume_at, auth_blocked FROM provider_rate_limit_state;").fetchone(), ('metron', 100, 0))

    def test_phase61_task_reservations_are_normalized_and_active_duplicates_merge(self):
        self._seed_schema(61)
        with self._connect() as con:
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                DROP TABLE metron_enrichment_task_reservations;
                CREATE TABLE metron_enrichment_task_reservations(id INTEGER PRIMARY KEY, volume_id INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER);
                CREATE TABLE metron_enrichment_task_reservations_migration_58_backup(id INTEGER PRIMARY KEY, volume_id INTEGER, status TEXT, safe_error TEXT, created_at INTEGER, updated_at INTEGER);
                INSERT INTO metron_enrichment_task_reservations(id, volume_id, status, created_at, updated_at) VALUES (1, 1, 'reserved', 10, 10);
                INSERT INTO metron_enrichment_task_reservations_migration_58_backup(id, volume_id, status, safe_error, created_at, updated_at) VALUES (2, 1, 'queued', 'newer active', 20, 20);
                INSERT INTO metron_enrichment_task_reservations_migration_58_backup(id, volume_id, status, safe_error, created_at, updated_at) VALUES (3, 1, 'failed', 'historical', 5, 5);
            """)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            rows = con.execute("SELECT status, safe_error FROM metron_enrichment_task_reservations ORDER BY status;").fetchall()
            self.assertEqual(rows, [('failed', 'historical'), ('queued', 'newer active')])
            idx = {row[1]: row for row in con.execute('PRAGMA index_list(metron_enrichment_task_reservations);')}
            self.assertIn('metron_enrichment_task_reservations_active_idx', idx)
            active_idx_columns = tuple(row[2] for row in con.execute('PRAGMA index_info(metron_enrichment_task_reservations_active_idx);'))
            self.assertEqual(active_idx_columns, ('volume_id',))
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO metron_enrichment_task_reservations(volume_id, status, created_at, updated_at) VALUES (1, 'running', 30, 30);")

    def test_only_one_handler_registered_for_each_start_version(self):
        versions = list(DatabaseMigrationHandler.handlers)
        self.assertEqual(len(versions), len(set(versions)))
        self.assertIn(57, DatabaseMigrationHandler.handlers)
        self.assertIn(58, DatabaseMigrationHandler.handlers)
        self.assertIn(62, DatabaseMigrationHandler.handlers)

    def test_fresh_schema_includes_discovery_fact_tables(self):
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertTrue(table_exists(con, 'comic_series_discovery_facts'))
            self.assertTrue(table_exists(con, 'comic_discovery_fact_sync_state'))
            sync = con.execute('SELECT coverage_state, coverage_complete, date_preference FROM comic_discovery_fact_sync_state WHERE sync_id = 1;').fetchone()
            self.assertEqual(sync, ('not_started', 0, 'cover_date'))

    def test_version_59_handler_directly_normalizes_malformed_experimental_tables(self):
        self._seed_schema(59)
        with self._connect() as con:
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                DROP TABLE provider_match_candidates;
                CREATE TABLE provider_match_candidates(id INTEGER PRIMARY KEY, volume_id INTEGER, provider TEXT, resource_type TEXT, candidate_external_id TEXT, title TEXT, review_group_id TEXT, created_at INTEGER, updated_at INTEGER);
                INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, created_at, updated_at) VALUES (42, 1, 'metron', 'series', 'direct', 'Direct', 'group', 10, 11);
            """)
        DBConnectionManager.instances.clear()
        with self.app.app_context():
            DatabaseMigrationHandler.handlers[59]()
            close_db(None)
        DBConnectionManager.instances.clear()
        with self._connect() as con:
            cols = table_columns(con, 'provider_match_candidates')
            self.assertIn('payload', cols)
            self.assertEqual(con.execute('SELECT id, candidate_external_id FROM provider_match_candidates;').fetchone(), (42, 'direct'))
            self.assertEqual(con.execute('PRAGMA foreign_key_check;').fetchall(), [])

    def test_version_61_handler_directly_normalizes_malformed_reservations(self):
        self._seed_schema(61)
        with self._connect() as con:
            con.execute("INSERT INTO root_folders(id, folder) VALUES (1, '/comics');")
            con.execute("INSERT INTO volumes(id, comicvine_id, title, root_folder) VALUES (1, 1, 'Linked', 1);")
            con.executescript("""
                DROP TABLE metron_enrichment_task_reservations;
                CREATE TABLE metron_enrichment_task_reservations(id INTEGER PRIMARY KEY, volume_id INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER);
                INSERT INTO metron_enrichment_task_reservations(id, volume_id, status, created_at, updated_at) VALUES (52, 1, 'reserved', 10, 11);
            """)
        DBConnectionManager.instances.clear()
        with self.app.app_context():
            DatabaseMigrationHandler.handlers[61]()
            close_db(None)
        DBConnectionManager.instances.clear()
        with self._connect() as con:
            cols = table_columns(con, 'metron_enrichment_task_reservations')
            self.assertIn('candidate_id', cols)
            self.assertEqual(con.execute('SELECT id, volume_id, status FROM metron_enrichment_task_reservations;').fetchone(), (52, 1, 'reserved'))
            self.assertEqual(con.execute('PRAGMA foreign_key_check;').fetchall(), [])

    def test_discovery_facts_schema_and_indexes_are_created(self):
        self._seed_schema(61)
        self._run_setup(); self._assert_normalized()
        with self._connect() as con:
            self.assertTrue(table_exists(con, 'comic_series_discovery_facts'))
            cols = {row[1]: row for row in con.execute('PRAGMA table_info(comic_series_discovery_facts);')}
            self.assertEqual(cols['comicvine_volume_id'][5], 1)
            self.assertEqual(cols['is_upcoming_launch'][3], 1)
            self.assertTrue({'volume_title', 'cover_link', 'site_url', 'publisher', 'provider_modified_at', 'fetched_at', 'derivation_status', 'date_preference'} <= set(cols))
            self.assertTrue(table_exists(con, 'comic_discovery_fact_sync_state'))
            sync = con.execute('SELECT coverage_state, coverage_complete, date_preference FROM comic_discovery_fact_sync_state WHERE sync_id = 1;').fetchone()
            self.assertEqual(sync, ('not_started', 0, 'cover_date'))
            index_columns = {row[1]: tuple(info[2] for info in con.execute(f"PRAGMA index_info({row[1]});")) for row in con.execute('PRAGMA index_list(comic_series_discovery_facts);')}
            self.assertIn(('first_known_issue_date',), index_columns.values())
            self.assertIn(('derived_at',), index_columns.values())
            self.assertIn(('comicvine_volume_id',), index_columns.values())

if __name__ == '__main__':
    unittest.main()
