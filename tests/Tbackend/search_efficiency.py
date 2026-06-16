"""Tests for auto_search broad-result short-circuit logic.

When the volume-level search returns a large number of results that are all
unmatched (broad/irrelevant), the per-issue fallback loop should be skipped
entirely to avoid wasting time and bandwidth on equally-irrelevant queries.
"""

import unittest

from backend.base.definitions import SpecialVersion
from backend.features import search as search_module


def _make_unmatched_results(n):
    return [
        {
            'link': f'https://example.com/{i}',
            'display_title': f'Irrelevant Result {i}',
            'source': 'TestSource',
            'series': 'Some Other Series',
            'year': 2019,
            'volume_number': None,
            'special_version': None,
            'issue_number': float(i + 1),
            'annual': False,
            'match': False,
        }
        for i in range(n)
    ]


class _FakeIssue:
    id = 1
    calculated_issue_number = 1.0
    date = '2020-01-01'
    issue_number = '1'
    monitored = True

    def get_data(self):
        return self

    def get_files(self):
        return []


class _FakeVolumeData:
    monitored = True
    special_version = SpecialVersion.NORMAL
    year = 2020
    volume_number = 1
    title = 'Test Series'
    alt_title = None


class _FakeVolume:
    vd = _FakeVolumeData()

    def get_data(self):
        return _FakeVolumeData()

    def get_issues(self, _skip_files=False):
        return [_FakeIssue()]

    def get_open_issues(self):
        return [(1, 1.0)]

    def get_issue(self, issue_id):
        return _FakeIssue()


class BroadResultSkipTests(unittest.TestCase):
    """auto_search skips per-issue fallbacks when volume-level search is too broad."""

    def _run_auto_search_with_n_results(self, n_results):
        """Run auto_search(volume_id=1) mocking manual_search to return n_results."""
        original_manual_search = search_module.manual_search
        original_volume = search_module.Volume
        original_Settings = search_module.Settings

        calls = []  # (volume_id, issue_id) per manual_search call

        def fake_manual_search(volume_id, issue_id=None):
            calls.append((volume_id, issue_id))
            return _make_unmatched_results(n_results)

        class _FakeSV:
            auto_search_broad_result_threshold = 50

        class _FakeSettings:
            sv = _FakeSV()

        try:
            search_module.manual_search = fake_manual_search
            search_module.Volume = lambda vid: _FakeVolume()
            search_module.Settings = lambda: _FakeSettings()
            result = search_module.auto_search(1)
        finally:
            search_module.manual_search = original_manual_search
            search_module.Volume = original_volume
            search_module.Settings = original_Settings

        return result, calls

    def test_broad_volume_results_skip_per_issue_fallback(self):
        """Volume search returning >= threshold unmatched results → no fallback."""
        # 60 results >> threshold; per-issue fallback must be skipped
        result, calls = self._run_auto_search_with_n_results(60)

        self.assertEqual(result, [])
        # Only the volume-level call (issue_id=None) should have happened
        self.assertEqual(len(calls), 1)
        self.assertIsNone(calls[0][1], 'Expected volume-level call (issue_id=None)')

    def test_small_result_set_keeps_per_issue_fallback(self):
        """Volume search with a small result set → per-issue fallback still runs."""
        # 5 results << threshold; per-issue fallback must run for uncovered issue
        result, calls = self._run_auto_search_with_n_results(5)

        self.assertEqual(result, [])
        # Should have volume-level call + at least one per-issue call
        issue_calls = [c for c in calls if c[1] is not None]
        self.assertGreater(
            len(issue_calls), 0,
            'Expected per-issue fallback calls but none occurred',
        )

    def test_zero_results_keeps_per_issue_fallback(self):
        """Volume search with zero results → per-issue fallback still runs."""
        result, calls = self._run_auto_search_with_n_results(0)

        self.assertEqual(result, [])
        issue_calls = [c for c in calls if c[1] is not None]
        self.assertGreater(
            len(issue_calls), 0,
            'Expected per-issue fallback calls but none occurred with 0 results',
        )

    def test_broad_results_with_some_matches_still_run_per_issue(self):
        """If some volume-level results DO match, per-issue fallback runs for uncovered issues."""
        original_manual_search = search_module.manual_search
        original_volume = search_module.Volume

        calls = []

        def fake_manual_search(volume_id, issue_id=None):
            calls.append((volume_id, issue_id))
            results = _make_unmatched_results(60)
            # Add one matching result that covers issue #99 (not the open issue #1)
            results.append({
                'link': 'https://example.com/matched',
                'display_title': 'Matched Result',
                'source': 'TestSource',
                'series': 'Test Series',
                'year': 2020,
                'volume_number': 1,
                'special_version': None,
                'issue_number': 99.0,
                'annual': False,
                'match': True,
            })
            return results

        try:
            search_module.manual_search = fake_manual_search
            search_module.Volume = lambda vid: _FakeVolume()
            search_module.auto_search(1)
        finally:
            search_module.manual_search = original_manual_search
            search_module.Volume = original_volume

        # Per-issue fallback should run for issue #1 (not covered by issue #99)
        issue_calls = [c for c in calls if c[1] is not None]
        self.assertGreater(
            len(issue_calls), 0,
            'Expected per-issue fallback for uncovered issue #1',
        )


if __name__ == '__main__':
    unittest.main()
