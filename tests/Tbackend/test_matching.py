from typing import cast
from unittest.mock import patch

from backend.base.definitions import (IssueData, SearchResultData, SpecialVersion,
                                      VolumeData)
from backend.base.file_extraction import extract_filename_data
from backend.implementations.matching import check_search_result_match, match_title


_BUG_TITLE = 'VIZ.Media-Jujutsu.Kaisen.Vol.02.Fearsome.Womb.2020.Hybrid.Comic.eBook-BitBook'


def test_match_title_accepts_known_publisher_prefixes():
    assert match_title('Jujutsu Kaisen', 'VIZ.Media Jujutsu.Kaisen')
    assert match_title('Jujutsu Kaisen', 'VIZ Media Jujutsu Kaisen')


def test_match_title_publisher_prefix_is_not_arbitrary_contains_match():
    assert not match_title('Batman', 'VIZ.Media Jujutsu.Kaisen')
    assert not match_title('Jujutsu Kaisen', 'Some Publisher Jujutsu Kaisen')


def _result(title: str) -> SearchResultData:
    return cast(SearchResultData, {
        **extract_filename_data(title),
        'link': 'https://example.invalid/jujutsu-kaisen-vol',
        'display_title': title,
        'source': 'test',
    })


def _volume(special_version: SpecialVersion = SpecialVersion.NORMAL) -> VolumeData:
    return VolumeData(
        id=1,
        comicvine_id=1,
        title='Jujutsu Kaisen',
        alt_title=None,
        year=2019,
        volume_number=1,
        description='',
        site_url='',
        publisher='VIZ Media',
        monitored=True,
        monitor_new_issues=True,
        root_folder=1,
        folder='',
        custom_folder=False,
        special_version=special_version,
        special_version_locked=False,
        last_cv_fetch=0,
    )


def _issue(number: float, title: str) -> IssueData:
    return IssueData(
        id=int(number),
        volume_id=1,
        comicvine_id=int(number),
        issue_number=str(int(number)),
        calculated_issue_number=number,
        title=title,
        date='2020-01-01',
        description='',
        monitored=True,
        files=[],
    )


def test_viz_media_volume_title_matches_volume_as_issue_search():
    with patch('backend.implementations.matching.blocklist_contains', return_value=False):
        match = check_search_result_match(
            _result(_BUG_TITLE),
            _volume(SpecialVersion.VOLUME_AS_ISSUE),
            [_issue(2.0, 'Fearsome Womb')],
            {2.0: 2020},
            calculated_issue_number=2.0,
        )

    assert match == {'match': True, 'match_issue': None}


def test_viz_media_volume_title_matches_normal_manga_issue_search():
    title = 'VIZ.Media-Jujutsu.Kaisen.Vol.06.Black.Flash.2020.Hybrid.Comic.eBook-BitBook'

    with patch('backend.implementations.matching.blocklist_contains', return_value=False):
        match = check_search_result_match(
            _result(title),
            _volume(),
            [_issue(6.0, 'Black Flash')],
            {6.0: 2020},
            calculated_issue_number=6.0,
        )

    assert match == {'match': True, 'match_issue': None}
