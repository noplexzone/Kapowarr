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
