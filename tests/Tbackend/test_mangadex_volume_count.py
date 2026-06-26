# -*- coding: utf-8 -*-

from backend.implementations.mangadex import (
    _reported_volume_count,
    format_mangadex_issue_rows,
)


def test_reported_volume_count_counts_distinct_aggregate_entries_including_zero():
    mapping = {float(n): [float(n)] for n in range(0, 31)}

    assert _reported_volume_count({"lastVolume": "30"}, mapping) == 31


def test_mangadex_issue_rows_include_volume_zero():
    rows = format_mangadex_issue_rows("manga-id", {0.0: [0.0], 1.0: [1.0]})

    assert [row["issue_number"] for row in rows] == ["0", "1"]
