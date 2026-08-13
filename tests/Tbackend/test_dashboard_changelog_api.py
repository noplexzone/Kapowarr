
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod


class DashboardChangelogApiTests(unittest.TestCase):
    def _client(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        return app.test_client()

    def _auth_context(self):
        settings = MagicMock()
        settings.sv.auth_password = None
        settings.sv.api_key = 'test-api-key'
        patches = (
            patch.object(api_mod, 'request', flask_request),
            patch.object(api_mod, 'Settings', return_value=settings),
            patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'),
        )
        class Context:
            def __enter__(_self):
                for p in patches:
                    p.__enter__()
            def __exit__(_self, exc_type, exc, tb):
                for p in reversed(patches):
                    p.__exit__(exc_type, exc, tb)
        return Context()

    def test_dashboard_summary_aggregates_stable_kpis(self):
        tasks = [
            {'action': 'auto_search'},
            {'action': 'refresh_and_scan'},
            {'action': 'search_all'},
        ]
        with self._auth_context(), \
            patch.object(api_mod.Library, 'get_stats', side_effect=[
                {'missing_monitored': 4, 'upcoming_monitored': 2, 'mismatches': 1, 'released_issues': 80, 'downloaded_released_issues': 60},
                {'missing_monitored': 6, 'upcoming_monitored': 3, 'mismatches': 2, 'released_issues': 20, 'downloaded_released_issues': 15},
            ]) as stats, \
            patch.object(api_mod, 'TaskHandler') as task_handler, \
            patch.object(api_mod, 'DownloadHandler') as download_handler, \
            patch.object(api_mod, 'get_download_history_count', return_value=7):
            task_handler.return_value.get_all.return_value = tasks
            download_handler.return_value.get_all.return_value = [{'id': 1}, {'id': 2}]
            response = self._client().get('/api/dashboard/summary')

        self.assertEqual(response.status_code, 200)
        result = response.get_json()['result']
        self.assertEqual(result['library']['released_issues'], 100)
        self.assertEqual(result['library']['downloaded_released_issues'], 75)
        self.assertEqual(result['library']['completion_percentage'], 75.0)
        self.assertEqual(result['library']['missing_monitored'], 10)
        self.assertEqual(result['library']['upcoming_monitored'], 5)
        self.assertEqual(result['library']['mismatches'], 3)
        self.assertEqual(result['operations'], {'active_downloads': 2, 'failed_downloads': 7, 'active_searches': 2})
        self.assertEqual([call.args[0] for call in stats.call_args_list], ['comic', 'manga'])

    def test_changelog_parses_versions_dates_unreleased_and_sections(self):
        api_mod._read_packaged_changelog.cache_clear()
        with tempfile.TemporaryDirectory() as tmp:
            changelog = Path(tmp) / 'CHANGELOG.md'
            changelog.write_text(
                '# Changelog\n\n'
                '## [Unreleased]\n\n'
                '### Added\n\n'
                '- Future **feature** with `code`.\n\n'
                '## [1.6.0] - 2026-08-12\n\n'
                '### Fixed\n\n'
                '- Fixed [safe link](https://example.invalid).\n'
            )
            with self._auth_context(), \
                patch.object(api_mod, 'folder_path', side_effect=lambda name='': str(Path(tmp) / name) if name else tmp), \
                patch.object(api_mod, 'get_about_data', return_value={'version': '1.6.0'}):
                response = self._client().get('/api/changelog')

        api_mod._read_packaged_changelog.cache_clear()
        self.assertEqual(response.status_code, 200)
        result = response.get_json()['result']
        self.assertIsNone(result['error'])
        self.assertEqual(result['current_version'], '1.6.0')
        self.assertEqual(result['entries'][0]['version'], 'Unreleased')
        self.assertEqual(result['entries'][1]['date'], '2026-08-12')
        self.assertEqual(result['entries'][1]['sections'][0]['title'], 'Fixed')
        self.assertIn('safe link', result['entries'][1]['sections'][0]['items'][0])

    def test_changelog_handles_missing_file_gracefully(self):
        api_mod._read_packaged_changelog.cache_clear()
        with tempfile.TemporaryDirectory() as tmp, self._auth_context(), \
            patch.object(api_mod, 'folder_path', side_effect=lambda name='': str(Path(tmp) / name) if name else tmp), \
            patch.object(api_mod, 'get_about_data', return_value={'version': 'dev'}):
            response = self._client().get('/api/changelog')
        api_mod._read_packaged_changelog.cache_clear()
        result = response.get_json()['result']
        self.assertEqual(result['entries'], [])
        self.assertIn('could not be read', result['error'])

    def test_changelog_handles_malformed_file_gracefully(self):
        api_mod._read_packaged_changelog.cache_clear()
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'CHANGELOG.md').write_text('# no version headings\n- loose item\n')
            with self._auth_context(), \
                patch.object(api_mod, 'folder_path', side_effect=lambda name='': str(Path(tmp) / name) if name else tmp), \
                patch.object(api_mod, 'get_about_data', return_value={'version': 'dev'}):
                response = self._client().get('/api/changelog')
        api_mod._read_packaged_changelog.cache_clear()
        result = response.get_json()['result']
        self.assertEqual(result['entries'], [])
        self.assertIn('No version entries', result['error'])


if __name__ == '__main__':
    unittest.main()
