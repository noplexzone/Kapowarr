"""Regression tests for extract_files_from_folder archive-part leakage.

Bug: When postprocessing a download folder with no filter-matching files,
extract_files_from_folder fell back to moving *all* scannable files into the
library.  For NZB downloads this included multipart RAR packaging artefacts
(.part1.rar, .part2.rar, .zip wrappers) even when a direct comic payload
(PDF/CBZ/CBR/…) was already present in the same folder.

Fix: in the filter-miss fallback, prefer files with non-archive comic
extensions (.pdf, .cbz, .cbr, .epub, …).  Only fall back to ALL files when no
such direct payload is found, preserving existing behaviour for downloads
delivered as a plain .zip or .rar.
"""

import sys
import unittest
from os.path import join
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Minimal sys.modules patching – mirrors the pattern in test_fix_year_crash.py
# ---------------------------------------------------------------------------

def _patch_externals():
    urllib3_mock = MagicMock()
    urllib3_mock.__version__ = '1.26.0'
    requests_exceptions = MagicMock()
    requests_exceptions.RequestException = Exception
    requests_mock = MagicMock()
    requests_mock.exceptions = requests_exceptions
    requests_mock.RequestException = Exception

    patches = {
        'aiohttp': MagicMock(),
        'bencoding': MagicMock(),
        'multidict': MagicMock(),
        'yarl': MagicMock(),
        'requests': requests_mock,
        'requests.adapters': MagicMock(),
        'requests.structures': MagicMock(),
        'requests.exceptions': requests_exceptions,
        'urllib3': urllib3_mock,
        'backend.internals.db': MagicMock(),
        'backend.internals.db_models': MagicMock(),
        'backend.internals.settings': MagicMock(),
        'backend.implementations.file_matching': MagicMock(),
        'backend.implementations.matching': MagicMock(),
        'backend.implementations.naming': MagicMock(),
        'backend.implementations.volumes': MagicMock(),
        'backend.implementations.blocklist': MagicMock(),
    }
    for mod, stub in patches.items():
        sys.modules.setdefault(mod, stub)


_patch_externals()

# Only import the one function under test to keep setup light.
from backend.implementations.converters import extract_files_from_folder  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SOURCE = '/app/temp_downloads/Jujutsu Kaisen 000 (2019)'
_VOLUME_FOLDER = '/manga/Jujutsu Kaisen (2019)'
_VOLUME_ID = 42


def _make_volume_mock(volume_folder=_VOLUME_FOLDER):
    """Return a Volume mock with the minimum attributes used by extract_files_from_folder."""
    vd = MagicMock()
    vd.folder = volume_folder
    vd.year = 2019
    vd.title = 'Jujutsu Kaisen'

    vol = MagicMock()
    vol.get_data.return_value = vd
    vol.get_issues.return_value = []
    vol.get_ending_year.return_value = None
    return vol


def _files(*names, base=_SOURCE):
    return [join(base, n) for n in names]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class ExtractFilesFromFolderFallbackTests(unittest.TestCase):
    """extract_files_from_folder must not move archive packaging artefacts when
    a direct comic payload (PDF/CBZ/CBR/…) is present."""

    def _run(self, folder_files, filter_side_effect=None):
        """Invoke extract_files_from_folder with controlled dependencies.

        Returns the list of destination paths passed to rename_file.
        """
        if filter_side_effect is None:
            # Default: no files match the volume filter (simulates the bug scenario)
            filter_side_effect = [False] * len(folder_files)

        renamed_to = []

        with (
            patch('backend.implementations.converters.list_files',
                  return_value=folder_files),
            patch('backend.implementations.converters.Volume',
                  return_value=_make_volume_mock()),
            patch('backend.implementations.converters.extract_filename_data',
                  return_value={}),
            patch('backend.implementations.converters.folder_extraction_filter',
                  side_effect=filter_side_effect),
            patch('backend.implementations.converters.set_detected_extension',
                  side_effect=lambda f: f),
            patch('backend.implementations.converters.rename_file',
                  side_effect=lambda src, dst: renamed_to.append(dst)),
            patch('backend.implementations.converters.delete_file_folder'),
            patch('backend.implementations.converters.LOGGER'),
        ):
            result = extract_files_from_folder(_SOURCE, _VOLUME_ID)

        return result, renamed_to

    # -- regression: the original bug ----------------------------------------

    def test_pdf_is_kept_and_rar_parts_are_not_moved(self):
        """Bug scenario: PDF + multipart RAR packaging in same folder.

        Before the fix, all files (including .part1.rar) were moved.
        After the fix, only the PDF should be imported.
        """
        files = _files(
            'bb56h8e.part1.rar',
            'bb56h8e.part2.rar',
            'bb56h8eb.zip',
            'bb-jujutsu.kaisen.0.blinding.dark.pdf',
        )
        result, renamed_to = self._run(files)

        # Only the PDF must reach the library folder
        self.assertEqual(len(renamed_to), 1,
                         f"Expected 1 file moved, got {len(renamed_to)}: {renamed_to}")
        self.assertTrue(
            renamed_to[0].endswith('.pdf'),
            f"Expected a .pdf destination, got: {renamed_to[0]}"
        )

    def test_cbz_is_kept_and_rar_parts_are_not_moved(self):
        """CBZ payload alongside RAR packaging parts."""
        files = _files(
            'bb56h8e.part1.rar',
            'jjk-0.cbz',
        )
        result, renamed_to = self._run(files)

        self.assertEqual(len(renamed_to), 1)
        self.assertTrue(renamed_to[0].endswith('.cbz'))

    def test_multiple_direct_comics_all_moved(self):
        """If there are multiple direct comic files, all of them should be moved."""
        files = _files(
            'bb56h8e.part1.rar',
            'jjk-vol1.pdf',
            'jjk-vol2.cbz',
        )
        result, renamed_to = self._run(files)

        self.assertEqual(len(renamed_to), 2)
        exts = {p.rsplit('.', 1)[-1] for p in renamed_to}
        self.assertEqual(exts, {'pdf', 'cbz'})

    def test_mixed_case_pdf_is_preferred_over_rar_part(self):
        """Direct comic detection is case-insensitive."""
        files = _files(
            'bb56h8e.part1.rar',
            'bb-jujutsu.kaisen.0.blinding.dark.Pdf',
        )
        result, renamed_to = self._run(files)

        self.assertEqual(len(renamed_to), 1)
        self.assertTrue(renamed_to[0].endswith('.Pdf'))

    # -- preservation: only archives present ---------------------------------

    def test_only_raw_archives_falls_back_to_all(self):
        """When no direct comic payload exists, fall back to all files (preserving
        existing behaviour for downloads delivered as a plain zip/rar).
        """
        files = _files(
            'bb56h8e.part1.rar',
            'bb56h8e.part2.rar',
            'bb56h8eb.zip',
        )
        result, renamed_to = self._run(files)

        # All three must be moved since there is no direct comic to prefer.
        self.assertEqual(len(renamed_to), 3,
                         f"Expected all 3 files moved, got {len(renamed_to)}: {renamed_to}")

    def test_single_rar_as_only_payload_is_moved(self):
        """A single .rar (comics-in-a-rar delivery) must still be imported."""
        files = _files('comic.rar')
        result, renamed_to = self._run(files)

        self.assertEqual(len(renamed_to), 1)
        self.assertTrue(renamed_to[0].endswith('.rar'))

    # -- normal path: filter matches some files ------------------------------

    def test_filter_match_overrides_fallback(self):
        """When the volume filter matches files, the fallback is not used at all;
        the matched files are imported and unmatched ones are not.
        """
        files = _files(
            'jjk-0.cbz',      # matches filter
            'bb56h8e.part1.rar',  # does not match
        )
        # First file matches (True), second does not (False)
        result, renamed_to = self._run(files, filter_side_effect=[True, False])

        self.assertEqual(len(renamed_to), 1)
        self.assertTrue(renamed_to[0].endswith('.cbz'))

    # -- edge: epub and mobi are direct comics --------------------------------

    def test_epub_preferred_over_raw_zip(self):
        files = _files('comic.epub', 'packaging.zip')
        result, renamed_to = self._run(files)

        self.assertEqual(len(renamed_to), 1)
        self.assertTrue(renamed_to[0].endswith('.epub'))

    def test_cbr_preferred_over_zip(self):
        files = _files('comic.cbr', 'packaging.zip')
        result, renamed_to = self._run(files)

        self.assertEqual(len(renamed_to), 1)
        self.assertTrue(renamed_to[0].endswith('.cbr'))


if __name__ == '__main__':
    unittest.main()
