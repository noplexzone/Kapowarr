import unittest
from unittest.mock import patch

from backend.base.definitions import LibraryFilter, LibrarySorting
from backend.implementations.volumes import Library


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchalldict(self):
        return [dict(row) for row in self.rows]


class _DB:
    def __init__(self, batches):
        self.batches = list(batches)
        self.calls = []

    def execute(self, query, params=()):
        self.calls.append((query, params))
        return _Result(self.batches.pop(0))


class VolumePaginationTests(unittest.TestCase):
    def test_page_uses_bounded_sql_and_returns_truthful_total(self):
        db = _DB([[{'id': 121, 'title': 'Saga', '_total_count': 1167}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows, total = Library.get_public_volumes_page(
                LibrarySorting.TITLE,
                LibraryFilter.MONITORED,
                'comic',
                page=2,
                page_size=60,
            )

        self.assertEqual(total, 1167)
        self.assertEqual(rows, [{'id': 121, 'title': 'Saga'}])
        query, params = db.calls[0]
        self.assertIn('COUNT(*) OVER () AS _total_count', query)
        self.assertIn('LIMIT ? OFFSET ?', query)
        self.assertEqual(params, ('comic', 60, 120))

    def test_empty_out_of_range_page_still_reports_total(self):
        db = _DB([[], [{'_total_count': 87}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows, total = Library.get_public_volumes_page(
                section='manga', page=9, page_size=60
            )

        self.assertEqual(rows, [])
        self.assertEqual(total, 87)
        self.assertEqual(db.calls[1][1], ('manga', 1, 0))

    def test_section_and_page_bounds_fail_closed(self):
        with self.assertRaises(ValueError):
            Library.get_public_volumes_page(section='comic\' OR 1=1 --')
        with self.assertRaises(ValueError):
            Library.get_public_volumes_page(page=-1)
        with self.assertRaises(ValueError):
            Library.get_public_volumes_page(page_size=0)

    def test_legacy_list_contract_does_not_leak_total_metadata(self):
        db = _DB([[{'id': 1, '_total_count': 2}, {'id': 2, '_total_count': 2}]])
        with patch('backend.implementations.volumes.get_db', return_value=db):
            rows = Library.get_public_volumes()
        self.assertEqual(rows, [{'id': 1}, {'id': 2}])
        self.assertNotIn('LIMIT ? OFFSET ?', db.calls[0][0])


if __name__ == '__main__':
    unittest.main()
