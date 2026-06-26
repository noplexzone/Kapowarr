# -*- coding: utf-8 -*-

from backend.implementations.mangadex import (
    _reported_volume_count,
    format_mangadex_issue_rows,
    format_mangadex_volume_folder_name,
    format_mangadex_volume_result,
    mangadex_surrogate_id,
)


def test_format_mangadex_volume_folder_name_wraps_year_in_parentheses():
    assert format_mangadex_volume_folder_name('Jujutsu Kaisen', 2018) == 'Jujutsu Kaisen (2018)'
    assert format_mangadex_volume_folder_name('Jujutsu Kaisen', None) == 'Jujutsu Kaisen'


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

    assert [r['issue_number'] for r in rows] == ['0', '1', '3']
    assert rows[0]['calculated_issue_number'] == 0.0
    assert rows[0]['title'] == 'Volume 0'
    assert 'chapters: 3, 23' in rows[0]['description']
    assert rows[1]['calculated_issue_number'] == 1.0
    assert rows[1]['title'] == 'Volume 1'
    assert 'chapters: 1, 2' in rows[1]['description']
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
    assert result['metadata_language'] == 'en'
    assert result['available_languages'] == []
    assert result['metadata_id'] == manga['id']
    assert result['comicvine_id'] < 0
    assert result['title'] == 'Jujutsu Kaisen Modulo'
    assert result['publisher'] == 'MangaDex'
    assert result['issue_count'] == 1
    assert result['cover_link'].endswith('/cover.jpg.256.jpg')



def test_format_mangadex_volume_result_prefers_first_numbered_cover():
    manga = {
        'id': 'f3f59f12-351a-4de7-bd51-696d0764d64e',
        'attributes': {
            'title': {'ja-ro': 'Jujutsu Kaisen Modulo'},
            'availableTranslatedLanguages': ['fr', 'en'],
            'year': 2025,
        },
        'relationships': [
            {
                'type': 'cover_art',
                'attributes': {'fileName': 'relationship-volume-3.jpg'},
            }
        ],
    }
    covers = [
        {'attributes': {'volume': '3', 'fileName': 'volume-3.jpg'}},
        {'attributes': {'volume': '1', 'fileName': 'volume-1.jpg'}},
        {'attributes': {'volume': '2', 'fileName': 'volume-2.jpg'}},
    ]

    result = format_mangadex_volume_result(manga, {1.0: [1.0]}, covers=covers)

    assert result['metadata_language'] == 'en'
    assert result['available_languages'] == ['en', 'fr']
    assert result['cover_link'].endswith('/volume-1.jpg.256.jpg')


def test_reported_volume_count_counts_physical_range_including_volume_zero():
    assert _reported_volume_count({'lastVolume': '30'}, {0.0: [0.0], 1.0: [1.0], 30.0: [271.0]}) == 31
    assert _reported_volume_count({'lastVolume': '30'}, {1.0: [1.0], 30.0: [271.0]}) == 30
    assert _reported_volume_count({'lastVolume': None}, {1.0: [1.0], 3.0: [10.0]}) == 2


def test_format_mangadex_volume_result_counts_related_volume_zero_prequel():
    manga = {
        'id': 'c52b2ce3-7f95-469c-96b0-479524fb7a1a',
        'attributes': {
            'title': {'en': 'Jujutsu Kaisen'},
            'year': 2018,
            'lastVolume': '30',
        },
        'relationships': [
            {
                'type': 'manga',
                'related': 'prequel',
                'attributes': {
                    'title': {'ja-ro': 'Jujutsu Kaisen 0'},
                    'lastVolume': '0',
                },
            }
        ],
    }

    result = format_mangadex_volume_result(manga, {1.0: [1.0], 30.0: [271.0]})
    rows = format_mangadex_issue_rows(
        manga['id'],
        {1.0: [1.0], 30.0: [271.0]},
        manga['attributes'],
        include_volume_zero=True,
    )

    assert result['issue_count'] == 31
    assert [rows[0]['issue_number'], rows[-1]['issue_number']] == ['0', '30']
    assert len(rows) == 31




def _install_search_route_fakes(monkeypatch, comicvine_results=None):
    from types import SimpleNamespace

    import frontend.api as api_mod
    import backend.implementations.mangadex as mangadex_mod

    if comicvine_results is None:
        comicvine_results = [{
            'comicvine_id': 12345,
            'title': 'Jujutsu Kaisen',
            'year': 2018,
            'volume_number': 1,
            'cover': b'ignored',
            'cover_link': 'https://comicvine.example/jjk.jpg',
            'description': '',
            'site_url': 'https://comicvine.example/jjk',
            'aliases': [],
            'publisher': 'Viz',
            'issue_count': 30,
            'translated': True,
            'already_added': None,
            'issues': None,
            'date_added': None,
        }]

    class FakeSettings:
        sv = SimpleNamespace(auth_password='')

    class FakeStartTypeHandlers:
        @staticmethod
        def diffuse_timer(_start_type):
            return None

    class FakeComicVine:
        async def search_volumes(self, query, section='comic'):
            assert query == 'Jujutsu Kaisen'
            assert section == 'manga'
            return [dict(r) for r in comicvine_results]

    class FakeDBResult:
        def fetchone(self):
            return None

    class FakeDB:
        def execute(self, *_args, **_kwargs):
            return FakeDBResult()

    def fake_search_mangadex_volumes(query):
        assert query == 'Jujutsu Kaisen'
        return [{
            'comicvine_id': -2262949737,
            'metadata_source': 'mangadex',
            'metadata_id': 'f3f59f12-351a-4de7-bd51-696d0764d64e',
            'metadata_language': 'en',
            'available_languages': ['en', 'fr'],
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
    return api_mod


def test_api_manga_search_defaults_to_comicvine(monkeypatch):
    from flask import Flask

    api_mod = _install_search_route_fakes(monkeypatch)
    app = Flask(__name__)
    app.register_blueprint(api_mod.api, url_prefix='/api')

    response = app.test_client().get(
        '/api/volumes/search',
        query_string={
            'query': 'Jujutsu Kaisen',
            'section': 'manga',
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['error'] is None
    assert [r['metadata_source'] for r in payload['result']] == ['comicvine']
    assert payload['result'][0]['comicvine_id'] == 12345


def test_api_manga_search_all_prefers_comicvine_when_available(monkeypatch):
    from flask import Flask

    api_mod = _install_search_route_fakes(monkeypatch)
    app = Flask(__name__)
    app.register_blueprint(api_mod.api, url_prefix='/api')

    response = app.test_client().get(
        '/api/volumes/search',
        query_string={
            'query': 'Jujutsu Kaisen',
            'section': 'manga',
            'metadata_source': 'all',
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['error'] is None
    assert [r['metadata_source'] for r in payload['result']] == ['comicvine']
    assert payload['result'][0]['comicvine_id'] == 12345


def test_api_manga_search_all_falls_back_to_mangadex_when_comicvine_missing(monkeypatch):
    from flask import Flask

    api_mod = _install_search_route_fakes(monkeypatch, comicvine_results=[])
    app = Flask(__name__)
    app.register_blueprint(api_mod.api, url_prefix='/api')

    response = app.test_client().get(
        '/api/volumes/search',
        query_string={
            'query': 'Jujutsu Kaisen',
            'section': 'manga',
            'metadata_source': 'all',
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['error'] is None
    assert [r['metadata_source'] for r in payload['result']] == ['mangadex']
    assert payload['result'][0]['metadata_id'] == 'f3f59f12-351a-4de7-bd51-696d0764d64e'
