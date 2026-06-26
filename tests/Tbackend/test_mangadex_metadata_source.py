# -*- coding: utf-8 -*-

from backend.implementations.mangadex import (
    format_mangadex_issue_rows,
    format_mangadex_volume_result,
    mangadex_surrogate_id,
)


def test_mangadex_surrogate_ids_are_negative_and_stable():
    first = mangadex_surrogate_id('f3f59f12-351a-4de7-bd51-696d0764d64e')
    second = mangadex_surrogate_id('f3f59f12-351a-4de7-bd51-696d0764d64e')
    other = mangadex_surrogate_id('f3f59f12-351a-4de7-bd51-696d0764d64e', '1')

    assert first < 0
    assert first == second
    assert other < 0
    assert other != first


def test_format_mangadex_issue_rows_uses_numbered_print_volumes():
    rows = format_mangadex_issue_rows(
        'f3f59f12-351a-4de7-bd51-696d0764d64e',
        {
            0.0: [3.0, 23.0],
            1.0: [1.0, 2.0],
            3.0: [24.0],
        },
    )

    assert [r['issue_number'] for r in rows] == ['1', '3']
    assert rows[0]['calculated_issue_number'] == 1.0
    assert rows[0]['title'] == 'Volume 1'
    assert 'chapters: 1, 2' in rows[0]['description']
    assert all(r['comicvine_id'] < 0 for r in rows)


def test_format_mangadex_volume_result_contains_source_identity_and_cover():
    manga = {
        'id': 'f3f59f12-351a-4de7-bd51-696d0764d64e',
        'attributes': {
            'title': {'en': 'Jujutsu Kaisen Modulo'},
            'altTitles': [{'ja-ro': 'Jujutsu Kaisen Modulo'}],
            'year': 2025,
            'description': {'en': 'A sequel story.'},
        },
        'relationships': [
            {
                'type': 'cover_art',
                'attributes': {'fileName': 'cover.jpg'},
            }
        ],
    }

    result = format_mangadex_volume_result(manga, {1.0: [1.0, 2.0]})

    assert result['metadata_source'] == 'mangadex'
    assert result['metadata_id'] == manga['id']
    assert result['comicvine_id'] < 0
    assert result['title'] == 'Jujutsu Kaisen Modulo'
    assert result['publisher'] == 'MangaDex'
    assert result['issue_count'] == 1
    assert result['cover_link'].endswith('/cover.jpg.256.jpg')


def test_api_manga_search_all_sources_returns_comicvine_and_mangadex(monkeypatch):
    from types import SimpleNamespace

    from flask import Flask

    import frontend.api as api_mod
    import backend.implementations.mangadex as mangadex_mod

    class FakeSettings:
        sv = SimpleNamespace(auth_password='')

    class FakeStartTypeHandlers:
        @staticmethod
        def diffuse_timer(_start_type):
            return None

    class FakeComicVine:
        async def search_volumes(self, query, section='comic'):
            assert query == 'Jujutsu Kaisen Modulo'
            assert section == 'manga'
            return [{
                'comicvine_id': 169930,
                'title': 'Jujutsu Kaisen: Modulo',
                'year': 2026,
                'volume_number': 1,
                'cover_link': '',
                'cover': None,
                'description': '',
                'site_url': 'https://comicvine.example/modulo',
                'aliases': [],
                'publisher': 'Shueisha',
                'issue_count': 3,
                'translated': False,
                'already_added': None,
                'issues': None,
                'date_added': None,
            }]

    class FakeDBResult:
        def fetchone(self):
            return None

    class FakeDB:
        def execute(self, *_args, **_kwargs):
            return FakeDBResult()

    def fake_search_mangadex_volumes(query):
        assert query == 'Jujutsu Kaisen Modulo'
        return [{
            'comicvine_id': -2262949737,
            'metadata_source': 'mangadex',
            'metadata_id': 'f3f59f12-351a-4de7-bd51-696d0764d64e',
            'title': 'Jujutsu Kaisen Modulo',
            'year': 2025,
            'volume_number': 1,
            'cover_link': '',
            'cover': None,
            'description': '',
            'site_url': 'https://mangadex.example/modulo',
            'aliases': [],
            'publisher': 'MangaDex',
            'issue_count': 2,
            'translated': True,
            'already_added': None,
            'issues': None,
            'date_added': None,
        }]

    monkeypatch.setattr(api_mod, 'Settings', lambda: FakeSettings())
    monkeypatch.setattr(api_mod, 'StartTypeHandlers', FakeStartTypeHandlers)
    monkeypatch.setattr(api_mod, 'ComicVine', FakeComicVine)
    monkeypatch.setattr(api_mod, 'get_db', lambda: FakeDB())
    monkeypatch.setattr(mangadex_mod, 'search_mangadex_volumes', fake_search_mangadex_volumes)

    app = Flask(__name__)
    app.register_blueprint(api_mod.api, url_prefix='/api')

    response = app.test_client().get(
        '/api/volumes/search',
        query_string={
            'query': 'Jujutsu Kaisen Modulo',
            'section': 'manga',
            'metadata_source': 'all',
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['error'] is None
    sources = [r['metadata_source'] for r in payload['result']]
    assert sources == ['comicvine', 'mangadex']
    assert payload['result'][1]['metadata_id'] == 'f3f59f12-351a-4de7-bd51-696d0764d64e'
