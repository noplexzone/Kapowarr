import asyncio
import json
import sqlite3
import unittest
from unittest.mock import patch

import backend.features.tasks as task_mod
from backend.base.custom_exceptions import CVRateLimitReached
from backend.features.tasks import ComicDiscoveryFactSyncTask
from backend.implementations import comicvine as cv_mod
from backend.implementations.comicvine import ComicVine


FACT_SCHEMA = """
CREATE TABLE comic_series_discovery_facts(
    comicvine_volume_id INTEGER PRIMARY KEY, first_known_issue_id INTEGER,
    first_known_issue_number TEXT, first_known_issue_date TEXT, date_source TEXT,
    series_started_at TEXT, volume_title TEXT, cover_link TEXT, site_url TEXT,
    year INTEGER, publisher TEXT, is_upcoming_launch BOOL, provider_modified_at TEXT,
    metadata_modified_at INTEGER, fetched_at INTEGER, derived_at INTEGER,
    derivation_status TEXT, date_preference TEXT, last_error TEXT
);
CREATE TABLE comic_discovery_fact_sync_state(
    sync_id INTEGER PRIMARY KEY CHECK(sync_id = 1), scope TEXT NOT NULL DEFAULT 'comic_series_discovery',
    provider_cursor TEXT, last_started_at INTEGER, last_completed_at INTEGER,
    coverage_state TEXT NOT NULL DEFAULT 'not_started', coverage_complete BOOL NOT NULL DEFAULT 0,
    date_preference TEXT NOT NULL DEFAULT 'cover_date', last_error TEXT, next_resume_at INTEGER,
    last_successful_cursor TEXT, records_processed INTEGER NOT NULL DEFAULT 0,
    facts_created INTEGER NOT NULL DEFAULT 0, facts_updated INTEGER NOT NULL DEFAULT 0
);
INSERT INTO comic_discovery_fact_sync_state(sync_id, scope, coverage_state, coverage_complete, date_preference)
VALUES(1, 'comic_series_discovery', 'not_started', 0, 'cover_date');
"""


def memory_db():
    con = sqlite3.connect(':memory:')
    con.row_factory = sqlite3.Row
    con.executescript(FACT_SCHEMA)
    return con


class ComicDiscoveryFactSyncTests(unittest.TestCase):
    def settings_patch(self):
        class SV:
            date_type = 'cover_date'
        class Settings:
            sv = SV()
        return patch.object(task_mod, 'Settings', return_value=Settings())

    def test_task_persists_scope_offsets_and_resumes(self):
        con = memory_db()
        calls = []

        class FakeComicVine:
            async def sync_discovery_fact_page(self, scope, *, offset, limit, date_preference):
                calls.append((scope, offset, limit, date_preference))
                if scope == 'recently_started' and offset < 500:
                    return {'records_processed': 100, 'facts_created': 5, 'facts_updated': 5, 'facts_failed': 0, 'candidate_volumes_found': 5, 'next_offset': offset + 100, 'has_more': True, 'window_start': '2025-01-01', 'window_end': '2026-01-01'}
                return {'records_processed': 3, 'facts_created': 1, 'facts_updated': 1, 'facts_failed': 0, 'candidate_volumes_found': 1, 'next_offset': None, 'has_more': False, 'window_start': '2025-01-01', 'window_end': '2026-01-01'}

        with patch.object(task_mod, 'get_db', return_value=con), patch.object(task_mod, 'commit', lambda: None), patch.object(task_mod, '_emit_task_event', lambda event: None), self.settings_patch(), patch.object(task_mod, 'ComicVine', return_value=FakeComicVine()):
            task = ComicDiscoveryFactSyncTask()
            task.run()
            row = con.execute('SELECT provider_cursor, coverage_state, coverage_complete FROM comic_discovery_fact_sync_state WHERE sync_id=1').fetchone()
            state = json.loads(row['provider_cursor'])
            self.assertEqual(row['coverage_state'], 'partial')
            self.assertEqual(row['coverage_complete'], 0)
            self.assertEqual(state['scopes']['recently_started']['offset'], 500)
            self.assertEqual(calls, [
                ('recently_started', offset, 100, 'cover_date')
                for offset in (0, 100, 200, 300, 400)
            ])

            task = ComicDiscoveryFactSyncTask()
            task.run()
            row = con.execute('SELECT provider_cursor, coverage_state, coverage_complete, records_processed FROM comic_discovery_fact_sync_state WHERE sync_id=1').fetchone()
            state = json.loads(row['provider_cursor'])
            self.assertEqual(calls[-2:], [('recently_started', 500, 100, 'cover_date'), ('upcoming_launches', 0, 100, 'cover_date')])
            self.assertEqual(state['scopes']['recently_started']['coverage_state'], 'complete')
            self.assertEqual(state['scopes']['upcoming_launches']['coverage_state'], 'complete')
            self.assertEqual(row['coverage_state'], 'complete')
            self.assertEqual(row['coverage_complete'], 1)
            self.assertEqual(row['records_processed'], 506)

    def test_completed_index_restarts_when_daily_maintenance_is_due(self):
        con = memory_db()
        completed = ComicDiscoveryFactSyncTask()._empty_cursor('cover_date')
        for scope in completed['scopes'].values():
            scope['coverage_state'] = 'complete'
        con.execute("""UPDATE comic_discovery_fact_sync_state
            SET provider_cursor=?, coverage_state='complete', coverage_complete=1,
                last_completed_at=1, records_processed=999
            WHERE sync_id=1;""", (json.dumps(completed),))
        calls = []

        class FakeComicVine:
            async def sync_discovery_fact_page(self, scope, *, offset, limit, date_preference):
                calls.append((scope, offset))
                return {'records_processed': 1, 'facts_created': 1,
                    'facts_updated': 1, 'facts_failed': 0,
                    'candidate_volumes_found': 1, 'next_offset': None,
                    'has_more': False, 'window_start': '2025-01-01',
                    'window_end': '2026-01-01'}

        with patch.object(task_mod, 'get_db', return_value=con), \
                patch.object(task_mod, 'commit', lambda: None), \
                patch.object(task_mod, '_emit_task_event', lambda event: None), \
                self.settings_patch(), \
                patch.object(task_mod, 'ComicVine', return_value=FakeComicVine()):
            ComicDiscoveryFactSyncTask().run()
        row = con.execute("""SELECT coverage_state, coverage_complete,
            records_processed FROM comic_discovery_fact_sync_state WHERE sync_id=1""").fetchone()
        self.assertEqual(calls, [('recently_started', 0), ('upcoming_launches', 0)])
        self.assertEqual((row['coverage_state'], row['coverage_complete'], row['records_processed']), ('complete', 1, 2))

    def test_task_records_rate_limit_pause_without_completing(self):
        con = memory_db()

        class FakeComicVine:
            async def sync_discovery_fact_page(self, *args, **kwargs):
                raise CVRateLimitReached

        with patch.object(task_mod, 'get_db', return_value=con), patch.object(task_mod, 'commit', lambda: None), patch.object(task_mod, '_emit_task_event', lambda event: None), self.settings_patch(), patch.object(task_mod, 'ComicVine', return_value=FakeComicVine()):
            ComicDiscoveryFactSyncTask().run()
        row = con.execute('SELECT provider_cursor, coverage_state, coverage_complete, next_resume_at FROM comic_discovery_fact_sync_state WHERE sync_id=1').fetchone()
        state = json.loads(row['provider_cursor'])
        self.assertEqual(row['coverage_state'], 'rate_limit_paused')
        self.assertEqual(row['coverage_complete'], 0)
        self.assertGreater(row['next_resume_at'], 0)
        self.assertEqual(state['scopes']['recently_started']['coverage_state'], 'rate_limit_paused')

    def test_provider_sync_uses_issue_date_scope_and_rejects_long_running_future_issue_as_launch(self):
        con = memory_db()
        calls = []
        today = cv_mod._date.today()
        future = (today + cv_mod.timedelta(days=10)).isoformat()
        past = (today - cv_mod.timedelta(days=100)).isoformat()

        class FakeAsyncSession:
            async def __aenter__(self):
                return self
            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def fake_call_api(self, session, endpoint, params, default=None):
            calls.append((endpoint, dict(params)))
            if endpoint == '/issues':
                return {'number_of_total_results': 2, 'results': [
                    {'id': 2001, 'issue_number': '25', 'cover_date': future, 'store_date': future, 'volume': {'id': 10, 'name': 'Long Runner'}},
                    {'id': 3001, 'issue_number': '0', 'cover_date': future, 'store_date': future, 'volume': {'id': 11, 'name': 'Future Launch'}},
                ]}
            if endpoint == '/volumes':
                return {'results': [
                    {'id': 10, 'name': 'Long Runner', 'start_year': str(today.year - 1), 'publisher': {'name': 'Image'}, 'image': {}, 'site_detail_url': '', 'issues': [
                        {'id': 1001, 'issue_number': '1', 'cover_date': past, 'store_date': past},
                        {'id': 2001, 'issue_number': '25', 'cover_date': future, 'store_date': future},
                    ]},
                    {'id': 11, 'name': 'Future Launch', 'start_year': str(today.year), 'publisher': {'name': 'Image'}, 'image': {}, 'site_detail_url': '', 'issues': [
                        {'id': 3001, 'issue_number': '0', 'cover_date': future, 'store_date': future},
                    ]},
                ]}
            return default or {'results': []}

        with patch.object(cv_mod, 'get_db', return_value=con), patch.object(cv_mod, 'AsyncSession', FakeAsyncSession), patch.object(ComicVine, '__init__', lambda self, comicvine_api_key=None: None), patch.object(ComicVine, '_ComicVine__call_api', fake_call_api):
            page = asyncio.run(ComicVine().sync_discovery_fact_page('upcoming_launches', offset=0, limit=100, date_preference='cover_date'))
        self.assertEqual(page['records_processed'], 2)
        self.assertEqual(page['candidate_volumes_found'], 1)
        rows = con.execute('SELECT comicvine_volume_id, first_known_issue_id, first_known_issue_number, is_upcoming_launch FROM comic_series_discovery_facts').fetchall()
        self.assertEqual([(r['comicvine_volume_id'], r['first_known_issue_id'], r['first_known_issue_number'], r['is_upcoming_launch']) for r in rows], [(11, 3001, '0', 1)])
        issue_call = calls[0][1]
        self.assertIn('cover_date:', issue_call['filter'])
        self.assertEqual(issue_call['offset'], 0)


if __name__ == '__main__':
    unittest.main()
