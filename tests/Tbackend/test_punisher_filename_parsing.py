import unittest

from backend.base.file_extraction import extract_filename_data
from backend.implementations.file_matching import _filename_issue_range


class PunisherFilenameParsingTests(unittest.TestCase):
    def test_first_explicit_hash_issue_wins_over_story_part_number(self):
        cases = {
            'War Zone #12 - Psychoville, U.S.A. #01.cbr': 12.0,
            'War Zone #31 - River of Blood #01.cbr': 31.0,
            'War Zone #41 - Countdown #02.cbr': 41.0,
            'War Zone #21 - 2 Mean 2 Die!.cbr': 21.0,
        }
        for filename, expected in cases.items():
            with self.subTest(filename=filename):
                self.assertEqual(
                    extract_filename_data(filename)['issue_number'], expected
                )

    def test_title_and_annual_hyphens_are_not_issue_ranges(self):
        filenames = (
            'War Zone #21 - 2 Mean 2 Die!.cbr',
            'The Punisher - War Zone - Annual 01 - 1993.cbr',
            'The Punisher - War Zone - Annual 02 - 1994.cbr',
        )
        for filename in filenames:
            with self.subTest(filename=filename):
                self.assertIsNone(_filename_issue_range(filename))

    def test_genuine_issue_range_remains_detected(self):
        filenames = (
            'The Punisher - War Zone 001 - 041 (1992).cbz',
            'The Punisher - War Zone 001-041 Digital.cbz',
            'The Punisher - War Zone Issues 001-041.cbz',
        )
        for filename in filenames:
            with self.subTest(filename=filename):
                self.assertEqual(
                    _filename_issue_range(filename), (1.0, 41.0)
                )


if __name__ == '__main__':
    unittest.main()
