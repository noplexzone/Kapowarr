import sqlite3
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod


CREATE_SQL = """
CREATE TABLE saved_filters(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL CHECK(section IN ('comic', 'manga')),
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(section, name)
);
"""


class SavedFiltersApiTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript(CREATE_SQL)

    def tearDown(self):
        self.db.close()

    def _client(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        return app.test_client()

    def _auth_patches(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.sv.api_key = 'test-api-key'
        return (
            patch.object(api_mod, 'request', flask_request),
            patch.object(api_mod, 'Settings', return_value=settings),
            patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'),
            patch.object(api_mod, 'get_db', return_value=self.db.cursor()),
        )

    def test_saved_filters_crud_is_section_scoped(self):
        with self._auth_context():
            client = self._client()
            created = client.post('/api/savedfilters', json={
                'section': 'comic',
                'name': 'Missing comics',
                'query': {'filter': 'wanted', 'sort': 'wanted', 'view': 'posters'},
            }, headers={'X-Api-Key': 'test-api-key'})
            self.assertEqual(created.status_code, 201)
            created_result = created.get_json()['result']
            self.assertEqual(created_result['section'], 'comic')
            self.assertEqual(created_result['query']['filter'], 'wanted')

            manga = client.post('/api/savedfilters', json={
                'section': 'manga',
                'name': 'Missing comics',
                'query': {'filter': 'wanted'},
            }, headers={'X-Api-Key': 'test-api-key'})
            self.assertEqual(manga.status_code, 201)

            comic_list = client.get('/api/savedfilters?section=comic')
            manga_list = client.get('/api/savedfilters?section=manga')
            self.assertEqual([f['name'] for f in comic_list.get_json()['result']], ['Missing comics'])
            self.assertEqual([f['section'] for f in comic_list.get_json()['result']], ['comic'])
            self.assertEqual([f['section'] for f in manga_list.get_json()['result']], ['manga'])

            updated = client.put(f"/api/savedfilters/{created_result['id']}", json={
                'name': 'Unread comics',
                'query': {'filter': 'wanted', 'search': 'Saga'},
            }, headers={'X-Api-Key': 'test-api-key'})
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.get_json()['result']['name'], 'Unread comics')
            self.assertEqual(updated.get_json()['result']['query']['search'], 'Saga')

            deleted = client.delete(f"/api/savedfilters/{created_result['id']}", headers={'X-Api-Key': 'test-api-key'})
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(client.get('/api/savedfilters?section=comic').get_json()['result'], [])

    def test_saved_filters_reject_duplicate_names_in_same_section(self):
        with self._auth_context():
            client = self._client()
            payload = {'section': 'comic', 'name': 'Missing', 'query': {'filter': 'wanted'}}
            self.assertEqual(client.post('/api/savedfilters', json=payload, headers={'X-Api-Key': 'test-api-key'}).status_code, 201)
            duplicate = client.post('/api/savedfilters', json=payload, headers={'X-Api-Key': 'test-api-key'})
            self.assertEqual(duplicate.status_code, 400)
            self.assertEqual(duplicate.get_json()['error'], 'InvalidKeyValue')

    def test_saved_filters_reject_invalid_section_and_query_shape(self):
        with self._auth_context():
            client = self._client()
            bad_section = client.get('/api/savedfilters?section=all')
            bad_query = client.post('/api/savedfilters', json={
                'section': 'comic', 'name': 'Bad', 'query': ['wanted'],
            }, headers={'X-Api-Key': 'test-api-key'})
            self.assertEqual(bad_section.status_code, 400)
            self.assertEqual(bad_query.status_code, 400)

    def _auth_context(self):
        patches = self._auth_patches()
        class Context:
            def __enter__(_self):
                for p in patches:
                    p.__enter__()
            def __exit__(_self, exc_type, exc, tb):
                for p in reversed(patches):
                    p.__exit__(exc_type, exc, tb)
        return Context()


if __name__ == '__main__':
    unittest.main()
