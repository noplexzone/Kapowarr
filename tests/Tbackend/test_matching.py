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


def test_viz_media_volume_title_matches_volume_as_issue_search():
    result = cast(SearchResultData, {
        **extract_filename_data(_BUG_TITLE),
        'link': 'https://example.invalid/jujutsu-kaisen-vol-02',
        'display_title': _BUG_TITLE,
        'source': 'test',
    })
    volume_data = VolumeData(
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
        special_version=SpecialVersion.VOLUME_AS_ISSUE,
        special_version_locked=False,
        last_cv_fetch=0,
    )
    issue = IssueData(
        id=2,
        volume_id=1,
        comicvine_id=2,
        issue_number='2',
        calculated_issue_number=2.0,
        title='Fearsome Womb',
        date='2020-01-01',
        description='',
        monitored=True,
        files=[],
    )

    with patch('backend.implementations.matching.blocklist_contains', return_value=False):
        match = check_search_result_match(
            result,
            volume_data,
            [issue],
            {2.0: 2020},
            calculated_issue_number=2.0,
        )

    assert match == {'match': True, 'match_issue': None}
