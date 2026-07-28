"""Regression tests for user-supplied interactive search queries."""

import unittest
from unittest.mock import MagicMock, patch


class ManualSearchCustomQueryTest(unittest.TestCase):
    def test_suwayomi_exact_query_preserves_year_and_volume_suffixes(self):
        from backend.features.search import SearchSuwayomi

        exact = SearchSuwayomi('Teen Titans (2003) Vol. 3', exact_query=True)
        generated = SearchSuwayomi('Teen Titans (2003) Vol. 3')

        self.assertEqual(exact._series_title(), 'Teen Titans (2003) Vol. 3')
        self.assertEqual(generated._series_title(), 'Teen Titans')

    def test_custom_query_is_searched_exactly_once_without_metadata_formats(self):
        from backend.base.definitions import SpecialVersion, VolumeData
        from backend.features.search import manual_search

        volume_data = VolumeData(
            id=1,
            comicvine_id=12345,
            title='Teen Titans',
            alt_title='The Teen Titans',
            year=2003,
            volume_number=1,
            description='',
            site_url='',
            publisher='DC Comics',
            monitored=True,
            monitor_new_issues=True,
            root_folder=1,
            folder='',
            custom_folder=False,
            special_version=SpecialVersion.NORMAL,
            special_version_locked=False,
            last_cv_fetch=0,
        )
        raw_result = {
            'link': 'https://getcomics.org/teen-titans-2003/',
            'display_title': 'Teen Titans (2003) Vol. 3',
            'source': 'GetComics',
            'series': 'Teen Titans',
            'year': 2003,
            'volume_number': 3,
            'special_version': None,
            'issue_number': (1.0, 47.0),
            'annual': False,
        }
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = volume_data
        mock_volume.get_issues.return_value = []
        searched_queries = []

        async def fake_search_multiple_queries(
            *queries, volume_data=None, exact_query=False
        ):
            searched_queries.append((queries, volume_data, exact_query))
            return [raw_result]

        with patch('backend.features.search.Volume', return_value=mock_volume), \
             patch(
                 'backend.features.search.search_multiple_queries',
                 side_effect=fake_search_multiple_queries,
             ), \
             patch(
                 'backend.features.search.check_search_result_match',
                 return_value={'match': False, 'match_issue': 'volume mismatch'},
             ):
            results = manual_search(1, custom_query='  Teen Titans 2003  ')

        self.assertEqual(
            searched_queries,
            [(('Teen Titans 2003',), volume_data, True)],
        )
        self.assertEqual(results[0]['link'], raw_result['link'])


    def test_whitespace_query_retains_generated_search_behavior(self):
        from backend.base.definitions import SpecialVersion
        from backend.features.search import manual_search

        volume_data = MagicMock()
        volume_data.title = 'Teen Titans'
        volume_data.alt_title = 'The Teen Titans'
        volume_data.year = 2003
        volume_data.volume_number = 1
        volume_data.publisher = 'DC Comics'
        volume_data.special_version = SpecialVersion.NORMAL
        mock_volume = MagicMock()
        mock_volume.get_data.return_value = volume_data
        mock_volume.get_issues.return_value = []
        searched_queries = []

        async def fake_search_multiple_queries(
            *queries, volume_data=None, exact_query=False
        ):
            searched_queries.append((queries, exact_query))
            return []

        with patch('backend.features.search.Volume', return_value=mock_volume), \
             patch(
                 'backend.features.search.search_multiple_queries',
                 side_effect=fake_search_multiple_queries,
             ):
            manual_search(1, custom_query='   ')

        self.assertEqual(len(searched_queries), 2)
        self.assertTrue(all(queries for queries, _ in searched_queries))
        self.assertTrue(all(not exact for _, exact in searched_queries))
        self.assertTrue(any('Teen Titans' in query for query in searched_queries[0][0]))
        self.assertTrue(any('The Teen Titans' in query for query in searched_queries[1][0]))


class ManualSearchApiQueryTest(unittest.TestCase):
    def test_volume_manual_search_forwards_query_parameter(self):
        from flask import Flask, request as flask_request
        import frontend.api as api_mod

        fake_settings = MagicMock()
        fake_settings.sv.auth_password = None
        with patch.object(api_mod, 'request', flask_request), \
             patch.object(api_mod, 'Settings', return_value=fake_settings), \
             patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'), \
             patch.object(api_mod.Library, 'get_volume'), \
             patch.object(api_mod, 'manual_search', return_value=[]) as search:
            app = Flask(__name__)
            app.register_blueprint(api_mod.api, url_prefix='/api')
            response = app.test_client().get(
                '/api/volumes/1/manualsearch',
                query_string={'query': 'Teen Titans 2003'},
            )

        self.assertEqual(response.status_code, 200)
        search.assert_called_once_with(1, custom_query='Teen Titans 2003')

    def test_issue_manual_search_forwards_query_parameter(self):
        from flask import Flask, request as flask_request
        import frontend.api as api_mod

        fake_settings = MagicMock()
        fake_settings.sv.auth_password = None
        from types import SimpleNamespace

        issue = MagicMock()
        issue.get_data.return_value = SimpleNamespace(volume_id=1)
        with patch.object(api_mod, 'request', flask_request), \
             patch.object(api_mod, 'Settings', return_value=fake_settings), \
             patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'), \
             patch.object(api_mod.Library, 'get_issue', return_value=issue), \
             patch.object(api_mod, 'manual_search', return_value=[]) as search:
            app = Flask(__name__)
            app.register_blueprint(api_mod.api, url_prefix='/api')
            response = app.test_client().get(
                '/api/issues/7/manualsearch',
                query_string={'query': 'Teen Titans 2003 #1'},
            )

        self.assertEqual(response.status_code, 200)
        search.assert_called_once_with(1, 7, custom_query='Teen Titans 2003 #1')


if __name__ == '__main__':
    unittest.main()
