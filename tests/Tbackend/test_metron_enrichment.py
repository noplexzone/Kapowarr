import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from flask import Flask, request as flask_request

from backend.implementations.metron import (
    MetronAuthenticationError, MetronClient, MetronInvalidResponseError,
    MetronNotModifiedError, MetronPausedError, MetronRateLimit,
    MetronRateLimitedError, parse_rate_limit_headers, safe_headers,
)
from backend.features.metron_enrichment import MetronEnrichmentService, extract_terms, get_review_candidates, resolve_candidate, safe_test_connection
from backend.internals.db import DB_SCHEMA, DBConnection, DBConnectionManager, close_db, commit, get_db, setup_db
from backend.internals.settings import Constants, PublicSettingsValues, _settings_for_log


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"results": []}
        self.headers = headers or {'Content-Type': 'application/json'}
    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)


class MetronClientSecurityTests(unittest.TestCase):
    @patch('backend.implementations.metron.get_about_data', return_value={'version': '9.9.9'})
    def test_bearer_header_pagination_and_redaction(self, _about):
        session = FakeSession([
            FakeResponse(payload={'results': [{'id': 1}], 'next': 'https://metron.cloud/api/series/?page=2'}),
            FakeResponse(payload={'results': [{'id': 2}], 'next': None}),
        ])
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
        self.assertEqual(client.get_paginated('series/', {'cv_id': 123}), [{'id': 1}, {'id': 2}])
        first_headers = session.calls[0][2]['headers']
        self.assertEqual(first_headers['Authorization'], 'Bearer TEST_METRON_TOKEN_REDACTED')
        self.assertNotIn('TEST_METRON_TOKEN_REDACTED', session.calls[0][1])
        self.assertEqual(safe_headers(first_headers)['Authorization'], '[REDACTED]')

    def test_rejects_unapproved_metron_targets_before_authorization(self):
        blocked = [
            'https://evil.example/steal',
            'http://metron.cloud/api/series/',
            'https://metron.cloud.evil.example/api/series/',
            'https://evil-metron.cloud/api/series/',
            'https://user:password@metron.cloud/api/series/',
            '//evil.example/api/series/',
            'https://metron.cloud:444/api/series/',
        ]
        for target in blocked:
            with self.subTest(target=target):
                session = FakeSession([FakeResponse(payload={'results': []})])
                client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
                with self.assertRaises(MetronInvalidResponseError):
                    client.get_paginated(target)
                self.assertEqual(session.calls, [])

    def test_relative_and_same_origin_absolute_targets_are_normalized(self):
        session = FakeSession([
            FakeResponse(payload={'results': [{'id': 1}], 'next': 'https://metron.cloud/api/series/?page=2'}),
            FakeResponse(payload={'results': [{'id': 2}], 'next': None}),
        ])
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
        self.assertEqual(client.get_paginated('/series/', {'page_size': 1}), [{'id': 1}, {'id': 2}])
        self.assertEqual(session.calls[0][1], 'https://metron.cloud/api/series/')
        self.assertEqual(session.calls[1][1], 'https://metron.cloud/api/series/?page=2')
        self.assertTrue(all(call[2]['headers']['Authorization'] == 'Bearer TEST_METRON_TOKEN_REDACTED' for call in session.calls))


    def test_rejects_relative_metron_path_escape_before_authorization(self):
        blocked = [
            '../admin',
            '%2e%2e/admin',
            '..%2fadmin',
            '.%2e/admin',
            r'\..\admin',
            'api/../../admin',
            'series/%252e%252e/admin',
        ]
        for target in blocked:
            with self.subTest(target=target):
                session = FakeSession([FakeResponse(payload={'results': []})])
                client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
                with self.assertRaises(MetronInvalidResponseError):
                    client.get_paginated(target)
                self.assertEqual(session.calls, [])

    def test_redirects_are_validated_before_following_with_authorization(self):
        session = FakeSession([
            FakeResponse(302, payload='', headers={'Location': 'https://evil.example/api/series/'}),
            FakeResponse(payload={'results': [{'id': 'evil'}]}),
        ])
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
        with self.assertRaises(MetronInvalidResponseError):
            client.get_paginated('series/')
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(session.calls[0][1], 'https://metron.cloud/api/series/')

    def test_same_origin_redirect_is_followed_after_validation(self):
        session = FakeSession([
            FakeResponse(302, payload='', headers={'Location': 'https://metron.cloud/api/series/?page=2'}),
            FakeResponse(payload={'results': [{'id': 2}], 'next': None}),
        ])
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=session)
        self.assertEqual(client.get_paginated('series/'), [{'id': 2}])
        self.assertEqual([call[1] for call in session.calls], [
            'https://metron.cloud/api/series/',
            'https://metron.cloud/api/series/?page=2',
        ])
        self.assertTrue(all(call[2]['headers']['Authorization'] == 'Bearer TEST_METRON_TOKEN_REDACTED' for call in session.calls))

    def test_error_classes_and_rate_limit_headers(self):
        rate = parse_rate_limit_headers({'X-RateLimit-Burst-Remaining': '0', 'Retry-After': '42'})
        self.assertEqual(rate.burst_remaining, 0)
        self.assertEqual(rate.retry_after, 42)
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([FakeResponse(429, headers={'Retry-After': '5', 'Content-Type': 'application/json'})]))
        with self.assertRaises(MetronRateLimitedError):
            client.test_connection()
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([FakeResponse(401)]))
        with self.assertRaises(MetronAuthenticationError):
            client.test_connection()
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([FakeResponse(200, payload='<html>', headers={'Content-Type': 'text/html'})]))
        with self.assertRaises(MetronInvalidResponseError):
            client.test_connection()

    def test_not_modified_and_last_modified_are_supported(self):
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([
            FakeResponse(304, headers={'Content-Type': 'application/json'}),
        ]))
        with self.assertRaises(MetronNotModifiedError):
            client.get_series('9001', 'Wed, 21 Oct 2015 07:28:00 GMT')
        client = MetronClient('TEST_METRON_TOKEN_REDACTED', session=FakeSession([
            FakeResponse(payload={'id': 9001}, headers={'Content-Type': 'application/json', 'Last-Modified': 'Thu, 22 Oct 2015 07:28:00 GMT', 'ETag': 'W/"series-9001"'}),
        ]))
        payload = client.get_series('9001')
        self.assertEqual(payload['_metron_last_modified'], 'Thu, 22 Oct 2015 07:28:00 GMT')
        self.assertNotIn('_metron_etag', payload)

    def test_extract_terms_indexes_additive_metron_payload_without_duplicates(self):
        payload = {
            'characters': [{'id': 1, 'name': 'Ada'}, {'id': 1, 'name': 'Ada'}],
            'genres': ['Noir'],
            'credits': [{'id': 2, 'name': 'Writer One'}],
            'imprint': {'id': 3, 'name': 'Imprint House'},
            'aliases': ['Alt Title'],
            'identifiers': [{'source': 'isbn', 'value': '123'}],
            'images': [{'url': 'https://example.invalid/cover.jpg', 'type': 'cover'}],
        }
        terms = extract_terms(payload)
        self.assertIn({'term_type': 'character', 'external_id': '1', 'name': 'Ada'}, terms)
        self.assertIn({'term_type': 'genre', 'external_id': 'noir', 'name': 'Noir'}, terms)
        self.assertIn({'term_type': 'creator', 'external_id': '2', 'name': 'Writer One'}, terms)
        self.assertIn({'term_type': 'imprint', 'external_id': '3', 'name': 'Imprint House'}, terms)
        self.assertIn({'term_type': 'alternate_title', 'external_id': 'alt title', 'name': 'Alt Title'}, terms)
        self.assertIn({'term_type': 'identifier', 'external_id': '123', 'name': 'isbn'}, terms)
        self.assertEqual([t for t in terms if t['term_type'] == 'character'], [{'term_type': 'character', 'external_id': '1', 'name': 'Ada'}])

    def test_metron_token_masked_in_public_settings_and_logs(self):
        public = PublicSettingsValues(metron_api_token='TEST_METRON_TOKEN_REDACTED').todict()
        self.assertEqual(public['metron_api_token'], Constants.CREDENTIAL_REPLACEMENT)
        logged = _settings_for_log({'metron_api_token': 'TEST_METRON_TOKEN_REDACTED', 'host': '127.0.0.1'})
        self.assertEqual(logged['metron_api_token'], '[REDACTED]')
        self.assertNotIn('TEST_METRON_TOKEN_REDACTED', repr(logged))


    def test_startup_invokes_metron_reservation_reconciliation(self):
        source = Path(__file__).parents[2].joinpath('Kapowarr.py').read_text()
        self.assertIn('reconcile_metron_task_reservations', source)
        self.assertIn('interrupted Metron enrichment reservation', source)

    def test_startup_restores_paused_metron_backfill(self):
        source = Path(__file__).parents[2].joinpath('Kapowarr.py').read_text()
        self.assertIn('restore_metron_backfill', source)


class MetronEnrichmentPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / 'Kapowarr.db'
        self.app = Flask(__name__)
        DBConnectionManager.instances.clear()
        DBConnection.file = str(self.db_path)
        with self.app.app_context():
            setup_db()
            db = get_db()
            db.execute("INSERT INTO root_folders(id, folder, section) VALUES(1, '/comics', 'comic');")
            db.execute("""INSERT INTO volumes(id, comicvine_id, metadata_source, metadata_id, title, publisher, description, root_folder)
                VALUES(1, 111, 'comicvine', '111', 'Canonical Title', 'ComicVine Publisher', 'ComicVine Description', 1);""")
            commit()

    def tearDown(self):
        with self.app.app_context():
            close_db(None)
        DBConnectionManager.instances.clear()
        self.tmpdir.cleanup()

    def test_apply_payload_records_scalar_fallbacks_without_mutating_canonical_volume_fields(self):
        payload = {'id': 'm1', 'imprint': {'id': 2, 'name': 'Metron Imprint'}, 'desc': 'Metron Description', 'characters': [{'id': 9, 'name': 'Metron Person'}]}
        with self.app.app_context():
            MetronEnrichmentService().apply_payload(1, 'm1', payload)
            row = get_db().execute('SELECT publisher, description FROM volumes WHERE id = 1;').fetchonedict()
            self.assertEqual(row['publisher'], 'ComicVine Publisher')
            self.assertEqual(row['description'], 'ComicVine Description')
            scalars = get_db().execute('SELECT field_name, normalized_value FROM volume_metadata_enrichment WHERE volume_id = 1 AND active = 1 ORDER BY field_name;').fetchalldict()
            self.assertIn({'field_name': 'publisher', 'normalized_value': 'Metron Imprint'}, scalars)
            self.assertIn({'field_name': 'description', 'normalized_value': 'Metron Description'}, scalars)
            terms = get_db().execute('SELECT term_type, name FROM volume_enrichment_terms WHERE volume_id = 1;').fetchalldict()
            self.assertIn({'term_type': 'character', 'name': 'Metron Person'}, terms)


    def test_candidate_task_reservation_dedupes_active_volume_task(self):
        from backend.features.metron_enrichment import attach_metron_task_reservation, reserve_candidate_enrichment_task, finish_metron_task_reservation
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(1, 'metron', 'series', 'm-candidate', 'Metron Candidate', 'grp', 'review_required', 1, 1);""")
            commit()
            candidate_id = db.execute('SELECT id FROM provider_match_candidates LIMIT 1;').fetchone()[0]
            first = reserve_candidate_enrichment_task(candidate_id)
            self.assertFalse(first['duplicate'])
            attach_metron_task_reservation(int(first['reservation_id']), 17)
            second = reserve_candidate_enrichment_task(candidate_id)
            self.assertTrue(second['duplicate'])
            self.assertEqual(second['task_id'], 17)
            finish_metron_task_reservation(1, False, 'provider exploded with token [REDACTED]')
            row = db.execute('SELECT status, safe_error FROM metron_enrichment_task_reservations WHERE id = ?;', (first['reservation_id'],)).fetchonedict()
            self.assertEqual(row['status'], 'failed')
            self.assertIn('provider exploded', row['safe_error'])

    def test_candidate_selection_resolves_review_without_losing_candidates_before_task(self):
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(1, 'metron', 'series', 'm-candidate', 'Metron Candidate', 'grp', 'review_required', 1, 1);""")
            commit()
            pending = get_review_candidates(1)['candidates']
            self.assertEqual(len(pending), 1)
            result = resolve_candidate(int(pending[0]['id']))
            self.assertEqual(result['status'], 'enrichment_pending')
            link = db.execute("SELECT external_id, review_status FROM volume_provider_links WHERE volume_id = 1 AND provider = 'metron';").fetchonedict()
            self.assertEqual(link['external_id'], 'm-candidate')
            self.assertEqual(link['review_status'], 'enrichment_pending')
            self.assertEqual(get_review_candidates(1)['total'], 0)

    def test_candidate_reservation_atomically_sets_link_candidate_and_reservation(self):
        from backend.features.metron_enrichment import reserve_candidate_enrichment_task
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(1, 'metron', 'series', 'm-candidate', 'Metron Candidate', 'grp', 'review_required', 1, 1);""")
            commit()
            candidate_id = db.execute('SELECT id FROM provider_match_candidates LIMIT 1;').fetchone()[0]
            result = reserve_candidate_enrichment_task(candidate_id)
            self.assertFalse(result['duplicate'])
            candidate = db.execute('SELECT review_status FROM provider_match_candidates WHERE id = ?;', (candidate_id,)).fetchonedict()
            link = db.execute("SELECT external_id, review_status FROM volume_provider_links WHERE volume_id = 1 AND provider = 'metron';").fetchonedict()
            reservation = db.execute('SELECT volume_id, candidate_id, status FROM metron_enrichment_task_reservations WHERE id = ?;', (result['reservation_id'],)).fetchonedict()
            self.assertEqual(candidate['review_status'], 'enrichment_pending')
            self.assertEqual(link, {'external_id': 'm-candidate', 'review_status': 'enrichment_pending'})
            self.assertEqual(reservation, {'volume_id': 1, 'candidate_id': candidate_id, 'status': 'reserved'})

    def test_queue_failure_compensates_exact_reservation_and_link(self):
        from backend.features.metron_enrichment import select_candidate_and_queue_enrichment
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(1, 'metron', 'series', 'm-candidate', 'Metron Candidate', 'grp', 'review_required', 1, 1);""")
            commit()
            candidate_id = db.execute('SELECT id FROM provider_match_candidates LIMIT 1;').fetchone()[0]
            with patch('backend.features.tasks.TaskHandler.add', side_effect=RuntimeError('queue unavailable')):
                with self.assertRaises(RuntimeError):
                    select_candidate_and_queue_enrichment(candidate_id)
            candidate = db.execute('SELECT review_status FROM provider_match_candidates WHERE id = ?;', (candidate_id,)).fetchonedict()
            link = db.execute("SELECT review_status FROM volume_provider_links WHERE volume_id = 1 AND provider = 'metron';").fetchonedict()
            reservations = db.execute('SELECT id, candidate_id, status, safe_error FROM metron_enrichment_task_reservations;').fetchalldict()
            self.assertEqual(candidate['review_status'], 'failed')
            self.assertEqual(link['review_status'], 'review_required')
            self.assertEqual(len(reservations), 1)
            self.assertEqual(reservations[0]['candidate_id'], candidate_id)
            self.assertEqual(reservations[0]['status'], 'failed')
            self.assertIn('queue unavailable', reservations[0]['safe_error'])

    def test_candidate_selection_queues_task_with_reservation_scope(self):
        from backend.features.metron_enrichment import select_candidate_and_queue_enrichment
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(1, 'metron', 'series', 'm-candidate', 'Metron Candidate', 'grp', 'review_required', 1, 1);""")
            commit()
            candidate_id = db.execute('SELECT id FROM provider_match_candidates LIMIT 1;').fetchone()[0]
            captured = {}
            def capture_task(task):
                captured['task'] = task
                return 91
            with patch('backend.features.tasks.TaskHandler.add', side_effect=capture_task):
                result = select_candidate_and_queue_enrichment(candidate_id)
            task = captured['task']
            self.assertEqual(task.volume_id, 1)
            self.assertEqual(task.reservation_id, result['reservation_id'])
            self.assertEqual(task.candidate_id, candidate_id)
            self.assertEqual(task.review_group_id, 'grp')
            self.assertEqual(result['task_id'], 91)

    def test_metron_task_completion_uses_exact_reservation_scope(self):
        from backend.features.tasks import MetronEnrichmentTask
        with self.app.app_context():
            with patch('backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume', return_value={'status': 'linked'}), \
                 patch('backend.features.tasks._emit_task_event'), \
                 patch('backend.features.metron_enrichment.mark_candidate_enrichment_result') as mark_result:
                MetronEnrichmentTask(1, reservation_id=20, candidate_id=10, review_group_id='grp-a').run()
        mark_result.assert_called_once_with(1, 'linked', reservation_id=20, candidate_id=10, review_group_id='grp-a')

    def test_completion_is_scoped_to_exact_reservation_candidate_and_group(self):
        from backend.features.metron_enrichment import mark_candidate_enrichment_result
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(10, 1, 'metron', 'series', 'm-a', 'A', 'grp-a', 'enrichment_pending', 1, 1);""")
            db.execute("""INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(11, 1, 'metron', 'series', 'm-b', 'B', 'grp-b', 'review_required', 1, 1);""")
            db.execute("""INSERT INTO metron_enrichment_task_reservations(id, volume_id, candidate_id, status, created_at, updated_at)
                VALUES(20, 1, 10, 'running', 1, 1);""")
            commit()
            mark_candidate_enrichment_result(1, 'linked', reservation_id=20, candidate_id=10, review_group_id='grp-a')
            rows = db.execute('SELECT id, review_status FROM provider_match_candidates ORDER BY id;').fetchalldict()
            reservation = db.execute('SELECT status FROM metron_enrichment_task_reservations WHERE id = 20;').fetchonedict()
            self.assertEqual(rows, [{'id': 10, 'review_status': 'resolved'}, {'id': 11, 'review_status': 'review_required'}])
            self.assertEqual(reservation['status'], 'completed')

    def test_restart_reconciliation_restores_pending_link_for_manual_retry(self):
        from backend.features.metron_enrichment import reconcile_metron_task_reservations
        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO provider_match_candidates(id, volume_id, provider, resource_type, candidate_external_id, title, review_group_id, review_status, created_at, updated_at)
                VALUES(10, 1, 'metron', 'series', 'm-a', 'A', 'grp-a', 'enrichment_pending', 1, 1);""")
            db.execute("""INSERT INTO volume_provider_links(volume_id, provider, resource_type, external_id, review_status, linked_at)
                VALUES(1, 'metron', 'series', 'm-a', 'enrichment_pending', 1);""")
            db.execute("""INSERT INTO metron_enrichment_task_reservations(id, volume_id, candidate_id, status, created_at, updated_at)
                VALUES(20, 1, 10, 'queued', 1, 1);""")
            commit()
            self.assertEqual(reconcile_metron_task_reservations(), 1)
            candidate = db.execute('SELECT review_status FROM provider_match_candidates WHERE id = 10;').fetchonedict()
            link = db.execute("SELECT review_status FROM volume_provider_links WHERE volume_id = 1 AND provider = 'metron';").fetchonedict()
            reservation = db.execute('SELECT status, safe_error FROM metron_enrichment_task_reservations WHERE id = 20;').fetchonedict()
            self.assertEqual(candidate['review_status'], 'failed')
            self.assertEqual(link['review_status'], 'review_required')
            self.assertEqual(reservation['status'], 'interrupted')
            self.assertIn('retry required', reservation['safe_error'])

    def _backfill_state(self):
        return get_db().execute(
            'SELECT status, total, total_estimate, processed, matched, unmatched, '
            'review_required, failed, skipped, current_volume_id, '
            'last_terminal_volume_id, rate_limit_paused_until, resume_time, '
            'cancel_requested, completed_at, updated_at '
            'FROM metron_backfill_state WHERE id = 1;'
        ).fetchonedict()

    def test_backfill_quota_pause_returns_promptly_and_schedules_one_resume(self):
        from backend.features.tasks import MetronBackfillTask, TaskHandler

        calls = []

        def refresh(volume_id):
            calls.append(volume_id)
            raise MetronPausedError('persisted quota exhausted')

        with self.app.app_context(), \
                patch('backend.features.tasks.time', return_value=100), \
                patch('backend.features.tasks.sleep') as sleeper, \
                patch('backend.features.tasks._emit_task_event'), \
                patch.object(TaskHandler, 'schedule_delayed', return_value=True) as schedule, \
                patch('backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume', side_effect=refresh), \
                patch('backend.implementations.metron.get_rate_limit_state', return_value={'resume_at': 102}):
            MetronBackfillTask().run()
            state = self._backfill_state()

        self.assertEqual(calls, [1])
        sleeper.assert_not_called()
        schedule.assert_called_once_with(MetronBackfillTask, 102)
        self.assertEqual(state['status'], 'rate_limit_paused')
        self.assertEqual(state['processed'], 0)
        self.assertEqual(state['last_terminal_volume_id'], 0)
        self.assertEqual(state['current_volume_id'], 1)
        self.assertEqual(state['rate_limit_paused_until'], 102)
        self.assertEqual(state['resume_time'], 102)

    def test_backfill_cancellation_during_pause_does_not_schedule_resume(self):
        from backend.features.tasks import MetronBackfillTask, TaskHandler

        task = MetronBackfillTask()

        def cancel_while_resolving_reset():
            task.stop = True
            return {'resume_at': 102}

        with self.app.app_context(), \
                patch('backend.features.tasks.time', return_value=100), \
                patch('backend.features.tasks._emit_task_event'), \
                patch.object(TaskHandler, 'schedule_delayed', return_value=True) as schedule, \
                patch(
                    'backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume',
                    side_effect=MetronPausedError('persisted quota exhausted'),
                ), \
                patch(
                    'backend.implementations.metron.get_rate_limit_state',
                    side_effect=cancel_while_resolving_reset,
                ):
            task.run()
            state = self._backfill_state()

        schedule.assert_not_called()
        self.assertEqual(state['status'], 'cancelled')
        self.assertEqual(state['cancel_requested'], 1)
        self.assertIsNone(state['resume_time'])

    def test_backfill_cancellation_after_refresh_does_not_advance_progress(self):
        from backend.features.tasks import MetronBackfillTask

        task = MetronBackfillTask()

        def finish_after_cancel(volume_id):
            task.stop = True
            return {'status': 'linked'}

        with self.app.app_context(), \
                patch('backend.features.tasks._emit_task_event'), \
                patch(
                    'backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume',
                    side_effect=finish_after_cancel,
                ):
            task.run()
            state = self._backfill_state()

        self.assertEqual(state['status'], 'cancelled')
        self.assertEqual(state['cancel_requested'], 1)
        self.assertEqual(state['processed'], 0)
        self.assertEqual(state['matched'], 0)
        self.assertEqual(state['last_terminal_volume_id'], 0)
        self.assertIsNone(state['current_volume_id'])

    def test_delayed_backfill_retries_same_volume_without_double_counting(self):
        from backend.features.tasks import MetronBackfillTask, TaskHandler

        calls = []

        def refresh(volume_id):
            calls.append(volume_id)
            if len(calls) == 1:
                raise MetronRateLimitedError(
                    'HTTP 429',
                    MetronRateLimit(burst_remaining=0, burst_reset=203),
                )
            return {'status': 'linked'}

        with self.app.app_context(), \
                patch('backend.features.tasks.time', return_value=200), \
                patch('backend.features.tasks.sleep') as sleeper, \
                patch('backend.features.tasks._emit_task_event'), \
                patch.object(TaskHandler, 'schedule_delayed', return_value=True), \
                patch('backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume', side_effect=refresh):
            MetronBackfillTask().run()
            paused = self._backfill_state()
            MetronBackfillTask().run()
            state = self._backfill_state()

        self.assertEqual(calls, [1, 1])
        sleeper.assert_not_called()
        self.assertEqual(paused['status'], 'rate_limit_paused')
        self.assertEqual(paused['processed'], 0)
        self.assertEqual(paused['last_terminal_volume_id'], 0)
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['processed'], 1)
        self.assertEqual(state['matched'], 1)
        self.assertEqual(state['failed'], 0)
        self.assertEqual(state['last_terminal_volume_id'], 1)
        self.assertIsNone(state['rate_limit_paused_until'])
        self.assertIsNone(state['resume_time'])

    def test_delayed_backfill_preserves_cumulative_exact_progress(self):
        from backend.features.tasks import MetronBackfillTask, TaskHandler

        calls = []

        def refresh(volume_id):
            calls.append(volume_id)
            if calls == [1, 2]:
                raise MetronRateLimitedError(
                    'HTTP 429',
                    MetronRateLimit(burst_remaining=0, burst_reset=203),
                )
            return {
                1: {'status': 'linked'},
                2: {'status': 'unavailable'},
                3: {'status': 'review_required'},
            }[volume_id]

        with self.app.app_context():
            db = get_db()
            db.execute("""INSERT INTO volumes(id, comicvine_id, metadata_source, metadata_id, title, root_folder)
                VALUES(2, 222, 'comicvine', '222', 'Second', 1);""")
            db.execute("""INSERT INTO volumes(id, comicvine_id, metadata_source, metadata_id, title, root_folder)
                VALUES(3, 333, 'comicvine', '333', 'Third', 1);""")
            commit()
            with patch('backend.features.tasks.time', return_value=200), \
                    patch('backend.features.tasks._emit_task_event'), \
                    patch.object(TaskHandler, 'schedule_delayed', return_value=True), \
                    patch('backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume', side_effect=refresh):
                MetronBackfillTask().run()
                paused = self._backfill_state()
                MetronBackfillTask().run()
                completed = self._backfill_state()

        self.assertEqual(calls, [1, 2, 2, 3])
        self.assertEqual(paused['status'], 'rate_limit_paused')
        self.assertEqual(paused['total'], 3)
        self.assertEqual(paused['total_estimate'], 3)
        self.assertEqual(paused['processed'], 1)
        self.assertEqual(paused['matched'], 1)
        self.assertEqual(paused['last_terminal_volume_id'], 1)
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual(completed['total'], 3)
        self.assertEqual(completed['total_estimate'], 3)
        self.assertEqual(completed['processed'], 3)
        self.assertEqual(completed['matched'], 1)
        self.assertEqual(completed['unmatched'], 1)
        self.assertEqual(completed['review_required'], 1)
        self.assertEqual(completed['failed'], 0)
        self.assertEqual(completed['skipped'], 0)
        self.assertEqual(completed['last_terminal_volume_id'], 3)

    def test_delete_backfill_cancels_delayed_resume_and_persists_terminal_state(self):
        import frontend.api as api_mod
        from backend.features import tasks

        class FakeTimer:
            def __init__(self, delay, callback, args=()):
                self.callback = callback
                self.args = args
                self.cancelled = False
                self.daemon = False

            def start(self):
                pass

            def cancel(self):
                self.cancelled = True

        settings = MagicMock()
        settings.sv.auth_password = None
        settings.sv.api_key = 'test-key'
        handler = tasks.TaskHandler()
        old_delayed = tasks.TaskHandler.delayed_tasks
        tasks.TaskHandler.delayed_tasks = {}
        try:
            with self.app.app_context():
                get_db().execute("""INSERT INTO metron_backfill_state(
                    id, status, total, total_estimate, processed, current_volume_id,
                    last_terminal_volume_id, rate_limit_paused_until, resume_time,
                    cancel_requested, started_at, updated_at)
                    VALUES(1, 'rate_limit_paused', 3, 3, 1, 2, 1, 160, 160, 0, 10, 20);""")
                commit()
                with patch.object(tasks, 'Timer', FakeTimer), patch.object(tasks, 'time', return_value=100):
                    handler.schedule_delayed(tasks.MetronBackfillTask, 160)
                timer = tasks.TaskHandler.delayed_tasks['metron_backfill']['timer']

            app = Flask(__name__)
            app.register_blueprint(api_mod.api, url_prefix='/api')
            with patch.object(api_mod, 'request', flask_request), \
                    patch.object(api_mod, 'Settings', return_value=settings), \
                    patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'):
                first = app.test_client().delete(
                    '/api/metadata/metron/backfill',
                    headers={'X-Api-Key': 'test-key'},
                )
                second = app.test_client().delete(
                    '/api/metadata/metron/backfill',
                    headers={'X-Api-Key': 'test-key'},
                )

            self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
            self.assertEqual(first.get_json()['result'], {
                'status': 'cancelled',
                'active_task_cancelled': False,
                'delayed_task_cancelled': True,
            })
            self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
            self.assertEqual(second.get_json()['result'], {
                'status': 'cancelled',
                'active_task_cancelled': False,
                'delayed_task_cancelled': False,
            })
            self.assertTrue(timer.cancelled)
            with patch.object(handler, 'add') as add:
                timer.callback(*timer.args)
            add.assert_not_called()
            with self.app.app_context():
                state = self._backfill_state()
            self.assertEqual(state['status'], 'cancelled')
            self.assertEqual(state['cancel_requested'], 1)
            self.assertIsNotNone(state['completed_at'])
            self.assertIsNotNone(state['updated_at'])
            self.assertIsNone(state['current_volume_id'])
            self.assertIsNone(state['rate_limit_paused_until'])
            self.assertIsNone(state['resume_time'])
        finally:
            tasks.TaskHandler.delayed_tasks = old_delayed

    def test_backfill_pause_releases_queue_for_unrelated_task(self):
        from backend.features.tasks import MetronBackfillTask, TaskHandler

        started = []

        class NextThread:
            def start(self):
                started.append('unrelated')

        task = MetronBackfillTask()
        handler = TaskHandler()
        old_queue = TaskHandler.queue
        TaskHandler.queue = [
            {'task': task, 'id': 1, 'status': 'running', 'queued_at': 1,
             'started_at': 2, 'thread': None},
            {'task': type('UnrelatedTask', (), {'action': 'unrelated'})(),
             'id': 2, 'status': 'queued', 'queued_at': 2,
             'started_at': None, 'thread': NextThread()},
        ]
        try:
            with patch('backend.features.tasks.time', return_value=300), \
                    patch('backend.features.tasks.sleep') as sleeper, \
                    patch('backend.features.tasks._emit_task_event'), \
                    patch.object(TaskHandler, 'schedule_delayed', return_value=True), \
                    patch('backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume',
                          side_effect=MetronPausedError('quota exhausted')), \
                    patch('backend.implementations.metron.get_rate_limit_state', return_value={'resume_at': 360}):
                handler._TaskHandler__run_task(task)
        finally:
            TaskHandler.queue = old_queue

        sleeper.assert_not_called()
        self.assertEqual(started, ['unrelated'])

    def test_backfill_does_not_retry_authentication_failures(self):
        from backend.features.tasks import MetronBackfillTask

        calls = []

        def refresh(volume_id):
            calls.append(volume_id)
            raise MetronAuthenticationError('invalid token')

        with self.app.app_context(), \
                patch('backend.features.tasks.sleep') as sleeper, \
                patch('backend.features.tasks._emit_task_event'), \
                patch('backend.features.metron_enrichment.MetronEnrichmentService.refresh_volume', side_effect=refresh):
            MetronBackfillTask().run()
            state = self._backfill_state()

        self.assertEqual(calls, [1])
        sleeper.assert_not_called()
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['processed'], 1)
        self.assertEqual(state['failed'], 1)


class MetronTestConnectionFlowTests(unittest.TestCase):
    def test_safe_test_connection_does_not_write_invalid_settings_or_disable_metron(self):
        updated = []
        class FakeSettings:
            def update(self, values):
                updated.append(values)
        class FakeClient:
            def test_connection(self):
                return {'rate_limit': {'burst_remaining': 1}}
        with patch('backend.features.metron_enrichment.Settings', return_value=FakeSettings()), \
             patch('backend.features.metron_enrichment.get_metron_client', return_value=FakeClient()):
            result = safe_test_connection()
        self.assertTrue(result['success'])
        keys = {key for values in updated for key in values}
        self.assertIn('metron_last_successful_connection', keys)
        self.assertNotIn('metron_rate_limit_status', keys)
        self.assertNotIn('metron_enabled', keys)

    def test_safe_test_connection_uses_current_draft_token_without_persisting(self):
        tokens = []
        class FakeClient:
            def test_connection(self):
                return {'rate_limit': None}
        def fake_get_client(token=None):
            tokens.append(token); return FakeClient()
        class FakeSettings:
            def update(self, values):
                self.values = values
        with patch('backend.features.metron_enrichment.Settings', return_value=FakeSettings()), \
             patch('backend.features.metron_enrichment.get_metron_client', side_effect=fake_get_client):
            result = safe_test_connection(token='DRAFT_TOKEN')
        self.assertTrue(result['success'])
        self.assertEqual(tokens, ['DRAFT_TOKEN'])


if __name__ == '__main__':
    unittest.main()
