import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod


class DiscoveryShelfApiTests(unittest.TestCase):
    def _client(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        return app.test_client()

    def _auth_patches(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.sv.api_key = 'test-key'
        return (
            patch.object(api_mod, 'request', flask_request),
            patch.object(api_mod, 'Settings', return_value=settings),
            patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'),
        )

    def _item(self, source='comicvine', metadata_id='1'):
        return {
            'metadata_source': source,
            'metadata_id': metadata_id,
            'comicvine_id': int(metadata_id) if str(metadata_id).isdigit() else metadata_id,
            'title': f'Title {metadata_id}',
        }

    def _comicvine(self):
        comicvine = MagicMock()
        comicvine.browse_catalog_volumes = AsyncMock(return_value={
            'items': [self._item('comicvine', '100')],
            'total': 1,
            'offset': 0,
            'page_size': 10,
            'has_more': False,
        })
        comicvine.get_upcoming_releases = AsyncMock(return_value=[self._item('comicvine', '200')])
        comicvine.get_new_volumes = AsyncMock(return_value=[self._item('comicvine', '300')])
        return comicvine

    def _assert_envelope(self, response):
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertIn('error', body)
        self.assertIsNone(body['error'])
        self.assertIn('result', body)
        return body['result']

    def test_metron_backfill_post_is_suppressed_during_delayed_pause(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        handler = MagicMock()
        handler.has_pending_action.return_value = True
        with request_patch, settings_patch, timer_patch, \
                patch('backend.features.tasks.TaskHandler', return_value=handler):
            response = self._client().post(
                '/api/metadata/metron/backfill',
                headers={'X-Api-Key': 'test-key'},
            )

        self.assertEqual(response.status_code, 202, response.get_data(as_text=True))
        result = response.get_json()['result']
        self.assertTrue(result['duplicate'])
        self.assertEqual(result['status'], 'already_queued')
        handler.add.assert_not_called()

    def test_metron_backfill_delete_preserves_completed_state_when_nothing_is_active(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        handler = MagicMock()
        handler.cancel_action.return_value = (False, False)
        query = MagicMock()
        query.fetchonedict.return_value = {'status': 'completed'}
        db = MagicMock()
        db.execute.return_value = query
        with request_patch, settings_patch, timer_patch, \
                patch('backend.features.tasks.TaskHandler', return_value=handler), \
                patch.object(api_mod, 'get_db', return_value=db), \
                patch.object(api_mod, 'commit') as commit:
            response = self._client().delete(
                '/api/metadata/metron/backfill',
                headers={'X-Api-Key': 'test-key'},
            )

        result = self._assert_envelope(response)
        self.assertEqual(result, {
            'status': 'completed',
            'active_task_cancelled': False,
            'delayed_task_cancelled': False,
        })
        commit.assert_not_called()

    def test_metron_backfill_delete_uses_atomic_action_cancellation(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        handler = MagicMock()
        handler.cancel_action.return_value = (True, False)
        query = MagicMock()
        query.fetchonedict.return_value = {'status': 'rate_limit_paused'}
        db = MagicMock()
        db.execute.return_value = query
        with request_patch, settings_patch, timer_patch, \
                patch('backend.features.tasks.TaskHandler', return_value=handler), \
                patch.object(api_mod, 'get_db', return_value=db), \
                patch.object(api_mod, 'commit'):
            response = self._client().delete(
                '/api/metadata/metron/backfill',
                headers={'X-Api-Key': 'test-key'},
            )

        result = self._assert_envelope(response)
        handler.cancel_action.assert_called_once_with('metron_backfill')
        self.assertTrue(result['active_task_cancelled'])
        self.assertFalse(result['delayed_task_cancelled'])

    def test_supported_shelf_combinations_return_envelopes(self):
        cases = [
            ('comic', 'recently-started', False),
            ('comic', 'recently-started', True),
            ('comic', 'upcoming-launches', False),
            ('comic', 'upcoming-launches', True),
            ('comic', 'recently-active', False),
            ('comic', 'recently-active', True),
            ('manga', 'recently-started', False),
            ('manga', 'recently-started', True),
            ('manga', 'recently-updated', False),
            ('manga', 'recently-updated', True),
        ]
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        manga_page = {
            'items': [self._item('mangadex', 'manga-1')],
            'total': 1,
            'offset': 0,
            'page_size': 10,
            'has_more': False,
        }
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, 'ComicVine', return_value=comicvine
        ), patch.object(api_mod, 'browse_mangadex_catalog', return_value=manga_page), patch.object(
            api_mod, '_exclude_added_provider_results', side_effect=lambda items: items
        ):
            for section, shelf_type, exclude_added in cases:
                with self.subTest(section=section, shelf_type=shelf_type, exclude_added=exclude_added):
                    response = self._client().get('/api/discovery', query_string={
                        'section': section,
                        'type': shelf_type,
                        'paginated': 'true',
                        'limit': '10',
                        'exclude_added': 'true' if exclude_added else 'false',
                    })
                    result = self._assert_envelope(response)
                    self.assertIn('items', result)



    def test_shelf_exclusion_refills_from_later_provider_pages(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(side_effect=[
            {'items': [self._item('comicvine', '1'), self._item('comicvine', '2')], 'total': 4, 'offset': 0, 'page_size': 2, 'has_more': True},
            {'items': [self._item('comicvine', '3'), self._item('comicvine', '4')], 'total': 4, 'offset': 2, 'page_size': 2, 'has_more': False},
        ])
        def exclude(items):
            return [item for item in items if item['metadata_id'] in {'3', '4'}]
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine), patch.object(api_mod, '_exclude_added_provider_results', side_effect=exclude):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-active',
                'paginated': 'true',
                'limit': '2',
                'exclude_added': 'true',
            })
        result = self._assert_envelope(response)
        self.assertEqual([item['metadata_id'] for item in result['items']], ['3', '4'])
        self.assertIsNone(result['total'])
        self.assertFalse(result['total_is_exact'])
        self.assertEqual(comicvine.browse_catalog_volumes.await_count, 2)

    def test_hidden_library_cursor_continues_from_raw_provider_offset(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(side_effect=[
            {'items': [self._item('comicvine', '1'), self._item('comicvine', '2')], 'total': 6, 'offset': 0, 'page_size': 2, 'has_more': True},
            {'items': [self._item('comicvine', '3'), self._item('comicvine', '4')], 'total': 6, 'offset': 2, 'page_size': 2, 'has_more': True},
            {'items': [self._item('comicvine', '5'), self._item('comicvine', '6')], 'total': 6, 'offset': 4, 'page_size': 2, 'has_more': False},
        ])
        def exclude(items):
            return [item for item in items if item['metadata_id'] in {'3', '4', '5', '6'}]
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine), patch.object(api_mod, '_exclude_added_provider_results', side_effect=exclude):
            first = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-active', 'paginated': 'true', 'limit': '2', 'exclude_added': 'true',
            })
            first_result = self._assert_envelope(first)
            self.assertEqual([item['metadata_id'] for item in first_result['items']], ['3', '4'])
            self.assertTrue(first_result['next_cursor'])
            second = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-active', 'paginated': 'true', 'limit': '2', 'exclude_added': 'true', 'cursor': first_result['next_cursor'],
            })
        second_result = self._assert_envelope(second)
        self.assertEqual([item['metadata_id'] for item in second_result['items']], ['5', '6'])
        self.assertEqual(comicvine.browse_catalog_volumes.await_args_list[-1].kwargs['offset'], 4)


    def test_hidden_library_cursor_retains_visible_overflow(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(side_effect=[
            {'items': [self._item('comicvine', '1'), self._item('comicvine', '2'), self._item('comicvine', '3'), self._item('comicvine', '4')], 'total': 8, 'offset': 0, 'page_size': 4, 'has_more': True},
            {'items': [self._item('comicvine', '5'), self._item('comicvine', '6'), self._item('comicvine', '7'), self._item('comicvine', '8')], 'total': 8, 'offset': 4, 'page_size': 4, 'has_more': False},
        ])
        def exclude(items):
            return [item for item in items if item['metadata_id'] != '1']
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine), patch.object(api_mod, '_exclude_added_provider_results', side_effect=exclude):
            first = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-active', 'paginated': 'true', 'limit': '2', 'exclude_added': 'true',
            })
            first_result = self._assert_envelope(first)
            self.assertEqual([item['metadata_id'] for item in first_result['items']], ['2', '3'])
            second = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-active', 'paginated': 'true', 'limit': '2', 'exclude_added': 'true', 'cursor': first_result['next_cursor'],
            })
        second_result = self._assert_envelope(second)
        self.assertEqual([item['metadata_id'] for item in second_result['items']], ['4', '5'])
        self.assertEqual(comicvine.browse_catalog_volumes.await_count, 2)

    def test_hidden_library_cursor_rejects_tampering(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(return_value={'items': [self._item('comicvine', '1')], 'total': 2, 'offset': 0, 'page_size': 1, 'has_more': True})
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine), patch.object(api_mod, '_exclude_added_provider_results', side_effect=lambda items: items):
            first = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-active', 'paginated': 'true', 'limit': '1', 'exclude_added': 'true',
            })
            cursor = self._assert_envelope(first)['next_cursor']
            bad = cursor[:-1] + ('a' if cursor[-1] != 'a' else 'b')
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-active', 'paginated': 'true', 'limit': '1', 'exclude_added': 'true', 'cursor': bad,
            })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_comic_browse_exclusion_refills_from_later_provider_pages(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(side_effect=[
            {'items': [self._item('comicvine', '1'), self._item('comicvine', '2')], 'total': 4, 'offset': 0, 'page_size': 2, 'has_more': True},
            {'items': [self._item('comicvine', '3'), self._item('comicvine', '4')], 'total': 4, 'offset': 2, 'page_size': 2, 'has_more': False},
        ])
        def exclude(items):
            return [item for item in items if item['metadata_id'] in {'3', '4'}]
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine), patch.object(api_mod, '_exclude_added_provider_results', side_effect=exclude):
            response = self._client().get('/api/discovery/browse', query_string={
                'section': 'comic',
                'sort': 'trending',
                'limit': '2',
                'exclude_added': 'true',
            })
        result = self._assert_envelope(response)
        self.assertEqual([item['metadata_id'] for item in result['items']], ['3', '4'])
        self.assertIsNone(result['total'])
        self.assertFalse(result['total_is_exact'])
        self.assertEqual(comicvine.browse_catalog_volumes.await_count, 2)

    def test_manga_browse_exclusion_refills_from_later_provider_pages(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        pages = [
            {'items': [self._item('mangadex', '1'), self._item('mangadex', '2')], 'total': 4, 'offset': 0, 'page_size': 2, 'has_more': True},
            {'items': [self._item('mangadex', '3'), self._item('mangadex', '4')], 'total': 4, 'offset': 2, 'page_size': 2, 'has_more': False},
        ]
        def exclude(items):
            return [item for item in items if item['metadata_id'] in {'3', '4'}]
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'browse_mangadex_catalog', side_effect=pages) as browse, patch.object(api_mod, '_exclude_added_provider_results', side_effect=exclude):
            response = self._client().get('/api/discovery/browse', query_string={
                'section': 'manga',
                'sort': 'recently_updated',
                'limit': '2',
                'exclude_added': 'true',
            })
        result = self._assert_envelope(response)
        self.assertEqual([item['metadata_id'] for item in result['items']], ['3', '4'])
        self.assertIsNone(result['total'])
        self.assertFalse(result['total_is_exact'])
        self.assertEqual(browse.call_count, 2)

    def test_recently_started_fact_index_returns_without_provider(self):
        import sqlite3
        con = sqlite3.connect(':memory:')
        con.executescript("""
            CREATE TABLE volumes(id INTEGER PRIMARY KEY, comicvine_id INTEGER);
            CREATE TABLE comic_series_discovery_facts(
                comicvine_volume_id INTEGER PRIMARY KEY, first_known_issue_id INTEGER,
                first_known_issue_number TEXT, first_known_issue_date TEXT, date_source TEXT,
                series_started_at TEXT, volume_title TEXT, cover_link TEXT, site_url TEXT,
                year INTEGER, publisher TEXT, is_upcoming_launch BOOL, metadata_modified_at INTEGER,
                derived_at INTEGER, last_error TEXT
            );
            INSERT INTO comic_series_discovery_facts(
                comicvine_volume_id, first_known_issue_id, first_known_issue_number,
                first_known_issue_date, date_source, series_started_at, volume_title,
                cover_link, site_url, year, publisher, is_upcoming_launch, metadata_modified_at, derived_at
            ) VALUES (501, 9001, '1', '2026-08-01', 'cover_date', '2026-08-01',
                'Fact Indexed Series', 'cover.jpg', 'site', 2026, 'DC', 0, 1, 1);
        """)
        with patch.object(api_mod, 'get_db', return_value=con):
            page = api_mod._comic_discovery_facts_page('recently-started', offset=0, limit=10)
        self.assertTrue(page['fact_index'])
        self.assertEqual(page['items'][0]['metadata_id'], '501')
        self.assertEqual(page['items'][0]['volume_title'], 'Fact Indexed Series')


    def test_recently_started_endpoint_serves_cached_fact_without_comicvine(self):
        import sqlite3
        con = sqlite3.connect(':memory:')
        con.executescript("""
            CREATE TABLE volumes(id INTEGER PRIMARY KEY, comicvine_id INTEGER, metadata_source TEXT DEFAULT 'comicvine');
            CREATE TABLE comic_series_discovery_facts(
                comicvine_volume_id INTEGER PRIMARY KEY, first_known_issue_id INTEGER,
                first_known_issue_number TEXT, first_known_issue_date TEXT, date_source TEXT,
                series_started_at TEXT, volume_title TEXT, cover_link TEXT, site_url TEXT,
                year INTEGER, publisher TEXT, is_upcoming_launch BOOL, provider_modified_at TEXT,
                metadata_modified_at INTEGER, fetched_at INTEGER, derived_at INTEGER,
                derivation_status TEXT, date_preference TEXT, last_error TEXT
            );
            CREATE TABLE comic_discovery_fact_sync_state(
                sync_id INTEGER PRIMARY KEY, scope TEXT, provider_cursor TEXT, last_started_at INTEGER,
                last_completed_at INTEGER, coverage_state TEXT, coverage_complete BOOL,
                date_preference TEXT, last_error TEXT, next_resume_at INTEGER
            );
            INSERT INTO comic_discovery_fact_sync_state(sync_id, scope, coverage_state, coverage_complete, date_preference) VALUES (1, 'comic_series_discovery', 'partial', 0, 'cover_date');
            INSERT INTO comic_series_discovery_facts(
                comicvine_volume_id, first_known_issue_id, first_known_issue_number, first_known_issue_date,
                date_source, series_started_at, volume_title, cover_link, site_url, year, publisher,
                is_upcoming_launch, provider_modified_at, metadata_modified_at, fetched_at, derived_at,
                derivation_status, date_preference
            ) VALUES (501, 9001, '1', '2026-08-01', 'cover_date', '2026-08-01',
                'Cached Fact Series', '', '', 2026, 'DC', 0, '2026-08-02', 1, 2, 3, 'valid', 'cover_date');
        """)
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'get_db', return_value=con), patch.object(api_mod, 'ComicVine', side_effect=AssertionError('provider should not be constructed')):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic', 'type': 'recently-started', 'paginated': 'true', 'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'][0]['metadata_id'], '501')
        self.assertEqual(result['coverage_state'], 'partial')

    def test_comicvine_full_search_uses_provider_offset(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.search_volumes_page = AsyncMock(return_value={
            'items': [self._item('comicvine', '41'), self._item('comicvine', '42')],
            'total': 60, 'offset': 30, 'page_size': 2, 'has_more': True,
            'next_offset': 32, 'total_is_exact': True,
        })
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = self._client().get('/api/volumes/search', query_string={
                'query': 'Batman', 'section': 'comic', 'metadata_source': 'comicvine',
                'paginated': 'true', 'offset': '30', 'limit': '2',
            })
        result = self._assert_envelope(response)
        self.assertEqual([item['metadata_id'] for item in result['items']], ['41', '42'])
        comicvine.search_volumes_page.assert_awaited_once_with('Batman', section='comic', offset=30, limit=2)

    def test_recently_started_paginated_empty_fact_index_stays_local(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', side_effect=AssertionError('provider fallback')):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
                'paginated': 'true',
                'offset': '0',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'], [])
        self.assertTrue(result['fact_index'])

    def test_upcoming_paginated_empty_fact_index_stays_local(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', side_effect=AssertionError('provider fallback')):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'upcoming-launches',
                'paginated': 'true',
                'offset': '0',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'], [])
        self.assertTrue(result['fact_index'])


    def test_discovery_refresh_queues_fact_sync_task(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod.TaskHandler, 'add', return_value=123) as add_task:
            response = self._client().post('/api/discovery/facts/refresh', headers={'X-Api-Key': 'test-key'})
        result = self._assert_envelope(response)
        self.assertEqual(result['sync_task_id'], 123)
        self.assertEqual(result['coverage'], 'partial')
        self.assertEqual(add_task.call_args[0][0].action, 'comic_discovery_fact_sync')

    def test_discovery_refresh_does_not_reset_an_active_singleton_sync(self):
        from threading import RLock
        request_patch, settings_patch, timer_patch = self._auth_patches()
        handler = MagicMock()
        handler.queue_lock = RLock()
        handler.active_task_id_for_action.return_value = 321
        handler.add.return_value = 999
        with request_patch, settings_patch, timer_patch, \
                patch.object(api_mod, 'TaskHandler', return_value=handler), \
                patch.object(api_mod, 'get_db') as get_db:
            response = self._client().post(
                '/api/discovery/facts/refresh',
                headers={'X-Api-Key': 'test-key'},
            )
        result = self._assert_envelope(response)
        self.assertEqual(result['sync_task_id'], 321)
        self.assertIn('already running', result['source_note'])
        get_db.assert_not_called()
        handler.add.assert_not_called()

    def test_discovery_refresh_restarts_completed_fact_cursor(self):
        import sqlite3
        con = sqlite3.connect(':memory:')
        con.execute("""CREATE TABLE comic_discovery_fact_sync_state(
            sync_id INTEGER PRIMARY KEY, scope TEXT, provider_cursor TEXT,
            coverage_state TEXT, coverage_complete BOOL, date_preference TEXT,
            last_started_at INTEGER, last_completed_at INTEGER, last_error TEXT,
            next_resume_at INTEGER, records_processed INTEGER,
            facts_created INTEGER, facts_updated INTEGER
        );""")
        con.execute("""INSERT INTO comic_discovery_fact_sync_state VALUES(
            1, 'comic_series_discovery', 'completed-cursor', 'complete', 1,
            'cover_date', 1, 2, NULL, NULL, 400, 20, 10
        );""")
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch, \
                patch.object(api_mod, 'get_db', return_value=con), \
                patch.object(api_mod, 'commit', side_effect=con.commit), \
                patch.object(api_mod.TaskHandler, 'add', return_value=124):
            response = self._client().post(
                '/api/discovery/facts/refresh',
                headers={'X-Api-Key': 'test-key'},
            )
        self._assert_envelope(response)
        state = con.execute("""SELECT provider_cursor, coverage_state,
            coverage_complete, records_processed, facts_created, facts_updated
            FROM comic_discovery_fact_sync_state WHERE sync_id=1;""").fetchone()
        self.assertEqual(state, (None, 'partial', 0, 0, 0, 0))

    def test_missing_shelf_type_is_validation_error(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'comic'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'KeyNotFound')

    def test_rejects_unsupported_shelf_type(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'comic', 'type': 'story-arcs'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_rejects_comic_only_shelf_for_manga(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'manga', 'type': 'upcoming-launches'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_rejects_manga_only_shelf_for_comics(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'comic', 'type': 'recently-updated'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_rejects_invalid_section(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        with request_patch, settings_patch, timer_patch:
            response = self._client().get('/api/discovery', query_string={'section': 'movie', 'type': 'recently-started'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'InvalidKeyValue')

    def test_empty_provider_result_returns_valid_envelope(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        comicvine.browse_catalog_volumes = AsyncMock(return_value={
            'items': [],
            'total': 0,
            'offset': 0,
            'page_size': 10,
            'has_more': False,
        })
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-active',
                'paginated': 'true',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'], [])

    def test_recently_started_paginated_empty_page_does_not_construct_provider(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', side_effect=AssertionError('provider fallback')):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
                'paginated': 'true',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'], [])

    def test_recently_started_public_empty_fact_index_stays_local(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'ComicVine', side_effect=AssertionError('provider fallback')):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
                'limit': '10',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result, [])

    def test_url_base_prefixed_route_returns_valid_envelope(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/kapowarr/ui/api')
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.sv.api_key = 'test-key'
        comicvine = self._comicvine()
        with patch.object(api_mod, 'request', flask_request), patch.object(api_mod, 'Settings', return_value=settings), patch.object(
            api_mod.StartTypeHandlers, 'diffuse_timer'
        ), patch.object(api_mod, 'ComicVine', return_value=comicvine):
            response = app.test_client().get('/kapowarr/ui/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-active',
                'paginated': 'true',
            })
        self._assert_envelope(response)


    def test_completed_empty_recently_started_shelf_stays_local(self):
        import sqlite3
        con = sqlite3.connect(':memory:')
        con.executescript("""
            CREATE TABLE volumes(id INTEGER PRIMARY KEY, comicvine_id INTEGER, metadata_source TEXT DEFAULT 'comicvine');
            CREATE TABLE comic_series_discovery_facts(
                comicvine_volume_id INTEGER PRIMARY KEY, first_known_issue_id INTEGER,
                first_known_issue_number TEXT, first_known_issue_date TEXT, date_source TEXT,
                series_started_at TEXT, volume_title TEXT, cover_link TEXT, site_url TEXT,
                year INTEGER, publisher TEXT, is_upcoming_launch BOOL, provider_modified_at TEXT,
                metadata_modified_at INTEGER, fetched_at INTEGER, derived_at INTEGER,
                derivation_status TEXT, date_preference TEXT, last_error TEXT
            );
            CREATE TABLE comic_discovery_fact_sync_state(
                sync_id INTEGER PRIMARY KEY, scope TEXT, provider_cursor TEXT, last_started_at INTEGER,
                last_completed_at INTEGER, coverage_state TEXT, coverage_complete BOOL,
                date_preference TEXT, last_error TEXT, next_resume_at INTEGER
            );
            INSERT INTO comic_discovery_fact_sync_state(sync_id, scope, coverage_state, coverage_complete, date_preference)
            VALUES(1, 'recently_started', 'complete', 1, 'cover_date');
        """)
        request_patch, settings_patch, timer_patch = self._auth_patches()
        comicvine = self._comicvine()
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'get_db', return_value=con), patch.object(api_mod, 'ComicVine', side_effect=AssertionError('provider fallback')):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result, [])

    def test_mangadex_full_search_uses_paginated_provider_path(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        page = {
            'items': [self._item('mangadex', 'manga-1')],
            'total': 9,
            'offset': 30,
            'page_size': 30,
            'next_offset': 60,
            'has_more': True,
            'total_is_exact': True,
        }
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'search_mangadex_volumes_page', return_value=page) as search_page:
            response = self._client().get('/api/volumes/search', query_string={
                'query': 'Berserk',
                'section': 'manga',
                'metadata_source': 'mangadex',
                'paginated': 'true',
                'offset': '30',
                'limit': '30',
            })
        result = self._assert_envelope(response)
        self.assertEqual(result['items'][0]['metadata_source'], 'mangadex')
        search_page.assert_called_once_with('Berserk', offset=30, limit=30)

    def test_hidden_library_search_cursor_exposes_previous_cursor_history(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        pages = [
            {'items': [self._item('mangadex', '1'), self._item('mangadex', '2'), self._item('mangadex', '3')], 'total': 6, 'offset': 0, 'page_size': 3, 'has_more': True},
            {'items': [self._item('mangadex', '4'), self._item('mangadex', '5'), self._item('mangadex', '6')], 'total': 6, 'offset': 3, 'page_size': 3, 'has_more': False},
        ]
        def exclude(items):
            return [item for item in items if item['metadata_id'] != '1']
        with request_patch, settings_patch, timer_patch, patch.object(api_mod, 'search_mangadex_volumes_page', side_effect=pages), patch.object(api_mod, '_exclude_added_provider_results', side_effect=exclude):
            first = self._client().get('/api/volumes/search', query_string={
                'query': 'Berserk', 'section': 'manga', 'metadata_source': 'mangadex', 'paginated': 'true', 'limit': '2', 'exclude_added': 'true',
            })
            first_result = self._assert_envelope(first)
            self.assertIsNone(first_result.get('previous_cursor'))
            second = self._client().get('/api/volumes/search', query_string={
                'query': 'Berserk', 'section': 'manga', 'metadata_source': 'mangadex', 'paginated': 'true', 'limit': '2', 'exclude_added': 'true', 'cursor': first_result['next_cursor'],
            })
        second_result = self._assert_envelope(second)
        self.assertIsNone(second_result.get('previous_cursor'))
        self.assertIn(first_result['next_cursor'], second_result.get('cursor_history') or [])

    def test_hidden_fact_shelf_preserves_refill_cursor(self):
        request_patch, settings_patch, timer_patch = self._auth_patches()
        refill_page = {
            'items': [self._item('comicvine', '501')],
            'total': None,
            'offset': 0,
            'page_size': 1,
            'has_more': True,
            'next_cursor': 'signed-next-page',
        }
        with request_patch, settings_patch, timer_patch, patch.object(
            api_mod, '_refill_excluding_added', return_value=refill_page
        ):
            response = self._client().get('/api/discovery', query_string={
                'section': 'comic',
                'type': 'recently-started',
                'paginated': 'true',
                'limit': '1',
                'exclude_added': 'true',
            })
        result = self._assert_envelope(response)
        self.assertTrue(result['has_more'])
        self.assertEqual(result['next_cursor'], 'signed-next-page')


if __name__ == '__main__':
    unittest.main()
