"""Regression tests for Suwayomi manga-volume bundling.

Strategy: Suwayomi ChapterType does NOT expose volumeNumber, so bundling is
driven by parsing chapter ranges from the issue description, not by querying
volumeNumber from Suwayomi.

Covered scenarios:
1. _parse_chapter_range_from_description: various description patterns.
2. manual_search injects a bundled suwayomi:M:c1,c2,... result for a
   VOLUME_AS_ISSUE issue when the description names the chapters and Suwayomi
   has individual chapter results for all of them.
3. parse_suwayomi_volume_link routing: single vs. multi-chapter link detection.
4. _try_bundle_suwayomi_chapters silently skips pre-bundled links.
"""

import unittest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# _parse_chapter_range_from_description
# ---------------------------------------------------------------------------

class ParseChapterRangeFromDescriptionTest(unittest.TestCase):
    """Verify chapter-range extraction from issue description strings."""

    def _parse(self, desc):
        from backend.features.search import _parse_chapter_range_from_description
        return _parse_chapter_range_from_description(desc)

    def test_ellipsis_range(self):
        """'Chapter 1 ... Chapter 7' yields [1.0, 2.0, ..., 7.0]."""
        result = self._parse('Ryomen Sukuna. Chapter 1 ... Chapter 7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_dash_range(self):
        """'Chapters 1-7' yields the same range."""
        result = self._parse('Chapters 1-7 collected in this volume.')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_individual_mentions(self):
        """Individual 'Chapter N' occurrences are collected and sorted."""
        desc = 'Chapter 1: Ryomen Sukuna. Chapter 2: For Myself. Chapter 3: Girl of Steel.'
        result = self._parse(desc)
        self.assertEqual(result, [1.0, 2.0, 3.0])

    def test_empty_description_returns_empty(self):
        result = self._parse('')
        self.assertEqual(result, [])

    def test_no_chapter_mentions_returns_empty(self):
        result = self._parse('An exciting volume of Jujutsu Kaisen.')
        self.assertEqual(result, [])

    def test_to_keyword_range(self):
        """'Chapter 1 to Chapter 7' also yields the range."""
        result = self._parse('Chapter 1 to Chapter 7')
        self.assertEqual(result, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_bracketed_numbers(self):
        """'[ 80 ] Chapter Title' format extracts chapter numbers from brackets."""
        desc = '<ul><li>[ 80 ] Dog Feelings</li><li>[ 81 ] Paw</li><li>[ 82 ] Breakfast</li></ul>'
        result = self._parse(desc)
        self.assertEqual(result, [80.0, 81.0, 82.0])

    def test_chapter_bracketed_numbers(self):
        """'Chapter [165] Title' format extracts the bracketed number."""
        desc = '<li>Chapter [165] Everyday Scenery</li><li>Chapter [166] Rain</li>'
        result = self._parse(desc)
        self.assertEqual(result, [165.0, 166.0])


# ---------------------------------------------------------------------------
# manual_search injects bundled result for manga issue searches
# ---------------------------------------------------------------------------

def _make_volume_data(special_version_marker='volume-as-issue', publisher='VIZ Media'):
    from backend.base.definitions import SpecialVersion, VolumeData
    special_version = (
        SpecialVersion.NORMAL
        if special_version_marker == 'normal'
        else SpecialVersion.VOLUME_AS_ISSUE
    )
    return VolumeData(
        id=1, comicvine_id=12345,
        title='Jujutsu Kaisen', alt_title=None,
        year=2019, volume_number=1,
        description='', site_url='',
        publisher=publisher,
        monitored=True, monitor_new_issues=True,
        root_folder=1, folder='', custom_folder=False,
        special_version=special_version,
        special_version_locked=False, last_cv_fetch=0,
    )


def _make_issue_data(description: str = '', issue_num: float = 1.0):
    from backend.base.definitions import IssueData
    return IssueData(
        id=10, volume_id=1, comicvine_id=99999,
        issue_number='1', calculated_issue_number=issue_num,
        title='Volume 1', date='2019-03-04',
        description=description, monitored=True, files=[],
    )


def _single_chapter_results(manga_id: int = 1756, ch_range=range(1, 8)):
    """Return individual Suwayomi chapter search results for chapters in ch_range."""
    results = []
    for i in ch_range:
        results.append({
            'link': f'suwayomi:{manga_id}:{10000 + i}',
            'display_title': f'Jujutsu Kaisen - Ch. {i}',
            'source': 'Suwayomi',
            'series': 'Jujutsu Kaisen',
            'year': None,
            'volume_number': None,
            'special_version': None,
            'issue_number': float(i),
            'annual': False,
        })
    return results


def _run_manual_search(
    issue_description: str,
    raw_results=None,
    special_version_marker='volume-as-issue',
    publisher='VIZ Media',
    issue_num: float = 1.0,
):
    """Run manual_search(1, 10) with mocked Volume and search_multiple_queries."""
    from backend.features.search import manual_search

    if raw_results is None:
        raw_results = _single_chapter_results()

    volume_data = _make_volume_data(special_version_marker, publisher)
    issue_data = _make_issue_data(description=issue_description, issue_num=issue_num)

    mock_issue = MagicMock()
    mock_issue.get_data.return_value = issue_data

    mock_volume = MagicMock()
    mock_volume.get_data.return_value = volume_data
    mock_volume.get_issues.return_value = []
    mock_volume.get_issue.return_value = mock_issue

    def fake_check_match(result, *args, **kwargs):
        return {'match': True, 'match_issue': None}

    with patch('backend.features.search.Volume', return_value=mock_volume), \
         patch('backend.features.search.run', return_value=raw_results), \
         patch('backend.features.search.get_mangadex_volume_chapter_map',
               return_value=None), \
         patch('backend.features.search.check_search_result_match',
               side_effect=fake_check_match):
        return manual_search(1, 10)


class ManualSearchVAIBundleTest(unittest.TestCase):
    """manual_search must inject a bundled Suwayomi link for VOLUME_AS_ISSUE + issue_id
    when the issue description names the chapter range and Suwayomi has them all."""

    def test_bundled_link_present_when_description_has_range(self):
        """Results must include at least one bundled suwayomi:M:c1,c2,... link."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertGreaterEqual(
            len(bundled), 1,
            'Expected at least one bundled Suwayomi result',
        )

    def test_bundled_link_present_for_normal_manga_volume(self):
        """Live JJK imports may be SpecialVersion.NORMAL, not VOLUME_AS_ISSUE."""
        results = _run_manual_search(
            'Chapter 1 ... Chapter 7',
            special_version_marker='normal',
        )
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)

    def test_bundled_link_present_with_irrelevant_non_suwayomi_results(self):
        """Irrelevant NZB/GetComics hits must not suppress Suwayomi bundling."""
        raw = _single_chapter_results() + [{
            'link': 'https://example.invalid/not-a-match.nzb',
            'display_title': 'Jujutsu Kaisen Vol 26',
            'source': 'NZBGeek',
            'series': 'Jujutsu Kaisen',
            'year': 2025,
            'volume_number': 26,
            'special_version': None,
            'issue_number': None,
            'annual': False,
        }]
        results = _run_manual_search('Chapter 1 ... Chapter 7', raw_results=raw)
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)

    def test_non_manga_publisher_does_not_bundle(self):
        """Chapter-list descriptions in non-manga comics should not trigger Suwayomi bundling."""
        results = _run_manual_search(
            'Chapter 1 ... Chapter 7',
            publisher='Marvel',
        )
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 0)

    def test_bundled_link_covers_all_seven_chapters(self):
        """The bundled link must embed all 7 chapter IDs for chapters 1–7."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        _, _, ids_str = bundled[0]['link'].split(':', 2)
        ids = [int(x) for x in ids_str.split(',')]
        self.assertEqual(len(ids), 7, f'Expected 7 IDs, got {ids}')

    def test_bundled_result_issue_number_matches_issue(self):
        """bundled result issue_number must equal the issue's calculated_issue_number."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertEqual(bundled[0]['issue_number'], 1.0)

    def test_bundled_result_volume_number_set(self):
        """bundled result volume_number must equal the volume's volume_number."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertEqual(bundled[0]['volume_number'], 1)

    def test_no_bundle_when_description_has_no_chapter_range(self):
        """Without chapter info in description no bundled result is added."""
        results = _run_manual_search('An exciting volume of Jujutsu Kaisen.')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 0)

    def test_no_bundle_when_chapters_are_incomplete(self):
        """Only chapters 1–5 present but description says 1–7 → no bundle."""
        raw = _single_chapter_results(ch_range=range(1, 6))
        results = _run_manual_search('Chapter 1 ... Chapter 7', raw_results=raw)
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 0)

    def test_covered_chapters_absent_from_final_results(self):
        """Individual Suwayomi chapters covered by the bundle must not appear at all."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        single = [
            r for r in results
            if r.get('link', '').startswith('suwayomi:')
            and ',' not in r.get('link', '')
        ]
        self.assertEqual(
            len(single), 0,
            'Covered individual chapter results should be absent when a bundle exists',
        )

    def test_covered_chapters_are_not_in_results(self):
        """Covered individual chapters must be removed, not merely marked non-match."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        covered = [
            r for r in results
            if r.get('link', '').startswith('suwayomi:')
            and ',' not in r.get('link', '')
        ]
        self.assertEqual(len(covered), 0, 'Expected 0 individual chapter results')

    def test_bundle_itself_is_match(self):
        """The injected bundle result must still be a match (mock returns match=True)."""
        results = _run_manual_search('Chapter 1 ... Chapter 7')
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertTrue(bundled[0].get('match'))

    def test_bundle_display_title_uses_issue_number_as_vol_number(self):
        """Bundle display_title for issue 11 must say Vol. 11, not Vol. 1 (series vol)."""
        raw = _single_chapter_results(ch_range=range(89, 98))
        results = _run_manual_search(
            'Chapters 89-97',
            raw_results=raw,
            issue_num=11.0,
        )
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1, 'Expected exactly one bundled result')
        title = bundled[0].get('display_title', '')
        self.assertIn(
            'Vol. 11', title,
            f'display_title should contain "Vol. 11" for issue 11, got: {title!r}',
        )
        self.assertNotIn(
            'Vol. 1 ', title,
            f'display_title must not use series volume_number 1, got: {title!r}',
        )

    def test_bundle_volume_number_metadata_uses_series_volume_for_matching(self):
        """Bundle volume_number must equal series volume_number (1) for matching,
        even when the display title shows the tankobon number (11)."""
        raw = _single_chapter_results(ch_range=range(89, 98))
        results = _run_manual_search(
            'Chapters 89-97',
            raw_results=raw,
            issue_num=11.0,
        )
        bundled = [r for r in results if ',' in r.get('link', '')]
        self.assertEqual(len(bundled), 1)
        self.assertEqual(
            bundled[0].get('volume_number'), 1,
            'volume_number metadata must be series volume (1) for matching, not issue number',
        )

    def test_unrelated_individual_suwayomi_chapters_absent_when_bundle_exists(self):
        """All individual Suwayomi chapter links must be removed when a bundle exists,
        including chapters not covered by the bundle (e.g. Ch. 11 alongside ch. 89-97)."""
        raw = _single_chapter_results(ch_range=range(89, 98))
        # Add an unrelated individual chapter link (Ch. 11)
        raw.append({
            'link': 'suwayomi:1756:10011',
            'display_title': 'Jujutsu Kaisen - Ch. 11',
            'source': 'Suwayomi',
            'series': 'Jujutsu Kaisen',
            'year': None,
            'volume_number': None,
            'special_version': None,
            'issue_number': 11.0,
            'annual': False,
        })
        results = _run_manual_search(
            'Chapters 89-97',
            raw_results=raw,
            issue_num=11.0,
        )
        single = [
            r for r in results
            if r.get('link', '').startswith('suwayomi:')
            and ',' not in r.get('link', '')
        ]
        self.assertEqual(
            len(single), 0,
            f'Expected no individual Suwayomi results when bundle exists, found: {[r["link"] for r in single]}',
        )




class SearchSuwayomiSourcePriorityTest(unittest.TestCase):
    """Multiple in-library manga with the same title must be ordered by configured source priority."""

    def test_search_results_follow_configured_suwayomi_source_priority(self):
        from backend.features.search import SearchSuwayomi

        class FakeClient:
            def is_configured(self):
                return True

            def get_library_manga(self):
                return [
                    {'id': 200, 'title': 'Jujutsu Kaisen', 'source': {'id': 'secondary', 'name': 'Secondary'}},
                    {'id': 100, 'title': 'Jujutsu Kaisen', 'source': {'id': 'preferred', 'name': 'Preferred'}},
                ]

            def get_chapters(self, manga_id):
                return [
                    {'id': manga_id + 1, 'chapterNumber': 1.0},
                    {'id': manga_id + 2, 'chapterNumber': 2.0},
                ]

        class FakeSettings:
            sv = type('SV', (), {'suwayomi_source_ids': ['preferred', 'secondary']})()

        search = SearchSuwayomi.__new__(SearchSuwayomi)
        search.query = 'Jujutsu Kaisen Vol. 1'

        with patch('backend.features.search.SuwayomiClient', return_value=FakeClient()), \
             patch('backend.internals.settings.Settings', return_value=FakeSettings()):
            results = search._search_sync()

        self.assertTrue(results[0]['link'].startswith('suwayomi:100:'))
        self.assertTrue(results[1]['link'].startswith('suwayomi:100:'))
        self.assertTrue(results[2]['link'].startswith('suwayomi:200:'))

# ---------------------------------------------------------------------------
# parse_suwayomi_volume_link routing: single vs. multi-chapter
# ---------------------------------------------------------------------------

class DownloadQueueSuwayomiRoutingTest(unittest.TestCase):
    """Regression: multi-chapter suwayomi link must create SuwayomiVolumeDownload."""

    def test_single_id_link_not_treated_as_volume(self):
        from backend.implementations.suwayomi import parse_suwayomi_volume_link
        link = 'suwayomi:1756:10270'
        try:
            _, ch_ids = parse_suwayomi_volume_link(link)
            is_volume = len(ch_ids) > 1
        except Exception:
            is_volume = False
        self.assertFalse(is_volume)

    def test_multi_id_link_treated_as_volume(self):
        from backend.implementations.suwayomi import parse_suwayomi_volume_link
        link = 'suwayomi:1756:10270,10271,10272,10273,10274,10275,10276'
        _, ch_ids = parse_suwayomi_volume_link(link)
        self.assertGreater(len(ch_ids), 1)


# ---------------------------------------------------------------------------
# _try_bundle_suwayomi_chapters: bundled links are silently skipped
# ---------------------------------------------------------------------------

class TryBundleIgnoresBundledLinksTest(unittest.TestCase):
    """Pre-bundled suwayomi:M:c1,c2 links in all_results must be skipped by
    _try_bundle_suwayomi_chapters (it only handles single-chapter links)."""

    def test_bundled_links_do_not_crash_try_bundle(self):
        from backend.features.search import _try_bundle_suwayomi_chapters
        from backend.base.definitions import SpecialVersion, VolumeData

        vol_data = VolumeData(
            id=1, comicvine_id=1,
            title='Jujutsu Kaisen', alt_title=None,
            year=2019, volume_number=1,
            description='', site_url='',
            publisher='VIZ Media',
            monitored=True, monitor_new_issues=True,
            root_folder=1, folder='', custom_folder=False,
            special_version=SpecialVersion.TPB,
            special_version_locked=False, last_cv_fetch=0,
        )

        all_results = [
            {
                'link': 'suwayomi:1756:10270,10271,10272',
                'issue_number': 1.0,
                'series': 'Jujutsu Kaisen',
                'source': 'Suwayomi',
                'year': None,
                'volume_number': 1,
                'special_version': None,
                'annual': False,
            }
        ]
        searchable_issues = [(1, 1.0)]

        result = _try_bundle_suwayomi_chapters(all_results, searchable_issues, vol_data)
        self.assertIsNone(result)


# ---------------------------------------------------------------------------
# create_pdf_from_chapters: cover image prepending
# Tests use sys.modules stubs so they run without the full app's dependencies.
# ---------------------------------------------------------------------------

def _suwayomi_module():
    """Import backend.implementations.suwayomi with missing deps stubbed out."""
    import sys, importlib
    stubs = {}
    for mod in ('requests', 'requests.exceptions'):
        if mod not in sys.modules:
            fake = MagicMock()
            if mod == 'requests.exceptions':
                fake.RequestException = Exception
            stubs[mod] = fake
    if stubs:
        with patch.dict(sys.modules, stubs):
            return importlib.import_module('backend.implementations.suwayomi')
    return importlib.import_module('backend.implementations.suwayomi')


def _minimal_png():
    """Return a 1×1 white PNG (valid image for img2pdf)."""
    import base64
    return base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAD'
        'hQGAWjR9awAAAABJRU5ErkJggg=='
    )


class CreatePdfFromChaptersCoverTest(unittest.TestCase):
    """SuwayomiClient.create_pdf_from_chapters must prepend cover as page 1."""

    def _make_client_and_mod(self):
        mod = _suwayomi_module()
        client = mod.SuwayomiClient.__new__(mod.SuwayomiClient)
        return client, mod

    def _run_create_pdf(self, chapters, cover_image, page_data=None):
        """Run create_pdf_from_chapters with fully-mocked img2pdf/pypdf.

        Returns (batches, result) where batches is a list of lists of temp
        paths passed to img2pdf.convert in each batch call.
        """
        import sys, io, tempfile, os
        from threading import Event

        client, mod = self._make_client_and_mod()
        page_png = page_data if page_data is not None else _minimal_png()
        client.get_page_image = lambda *a: page_png

        stop = Event()
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as out:
            out_path = out.name

        try:
            batches = []
            fake_img2pdf = MagicMock()

            def capture_convert(batch):
                batches.append(list(batch))
                # Return a minimal valid-enough bytes blob.
                return b'%PDF-1.4 stub'

            fake_img2pdf.convert.side_effect = capture_convert

            fake_pypdf = MagicMock()
            fake_writer = MagicMock()
            fake_reader = MagicMock()
            fake_reader.pages = []
            fake_pypdf.PdfWriter.return_value = fake_writer
            fake_pypdf.PdfReader.return_value = fake_reader
            fake_writer.write = lambda f: f.write(b'%PDF-1.4 stub')

            with patch.dict(sys.modules, {'img2pdf': fake_img2pdf, 'pypdf': fake_pypdf}):
                result = client.create_pdf_from_chapters(
                    manga_id=1,
                    chapters=chapters,
                    dest_path=out_path,
                    stop_event=stop,
                    cover_image=cover_image,
                )
        finally:
            try:
                os.unlink(out_path)
            except OSError:
                pass

        return batches, result

    def test_cover_prepended_as_first_page(self):
        """When cover_image provided, its temp file must be the first path assembled."""
        cover_png = _minimal_png()
        batches, _ = self._run_create_pdf(
            chapters=[(1, 2)],
            cover_image=cover_png,
        )
        all_paths = [p for batch in batches for p in batch]
        self.assertGreaterEqual(len(all_paths), 3,
            f'Expected cover + 2 chapter pages, got {len(all_paths)} paths')
        self.assertTrue(
            all_paths[0].endswith('.png'),
            f'First assembled path must be the cover PNG, got {all_paths[0]}',
        )

    def test_cover_write_failure_does_not_abort_assembly(self):
        """If the cover temp write fails, chapter pages are still assembled."""
        import sys, io, tempfile, os
        from threading import Event

        client, mod = self._make_client_and_mod()
        page_png = _minimal_png()
        client.get_page_image = lambda *a: page_png

        stop = Event()
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as out:
            out_path = out.name

        real_ntf = tempfile.NamedTemporaryFile
        call_n = {'v': 0}

        def ntf_failing_first(**kw):
            call_n['v'] += 1
            if call_n['v'] == 1:
                raise OSError('simulated disk full')
            return real_ntf(**kw)

        try:
            convert_calls = []
            fake_img2pdf = MagicMock()
            fake_img2pdf.convert.side_effect = lambda b: convert_calls.append(list(b)) or b'%PDF stub'

            fake_pypdf = MagicMock()
            fake_writer = MagicMock()
            fake_reader = MagicMock()
            fake_reader.pages = []
            fake_pypdf.PdfWriter.return_value = fake_writer
            fake_pypdf.PdfReader.return_value = fake_reader
            fake_writer.write = lambda f: f.write(b'%PDF stub')

            with patch.dict(sys.modules, {'img2pdf': fake_img2pdf, 'pypdf': fake_pypdf}), \
                 patch('tempfile.NamedTemporaryFile', side_effect=ntf_failing_first):
                client.create_pdf_from_chapters(
                    manga_id=1,
                    chapters=[(1, 1)],
                    dest_path=out_path,
                    stop_event=stop,
                    cover_image=_minimal_png(),
                )

            self.assertTrue(
                fake_img2pdf.convert.called,
                'img2pdf.convert must be called even when cover write fails',
            )
        finally:
            try:
                os.unlink(out_path)
            except OSError:
                pass

    def test_no_cover_image_assembles_only_chapter_pages(self):
        """Without cover_image, only chapter page temps are assembled."""
        batches, _ = self._run_create_pdf(
            chapters=[(1, 2)],
            cover_image=None,
        )
        all_paths = [p for batch in batches for p in batch]
        self.assertEqual(len(all_paths), 2,
            f'Without cover exactly 2 chapter pages should be assembled, got {len(all_paths)}')


if __name__ == '__main__':
    unittest.main()
