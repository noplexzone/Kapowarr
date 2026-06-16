# -*- coding: utf-8 -*-
"""Tests for backend/features/reader.py — comic archive page extraction."""

import os
import tempfile
from os.path import join
from zipfile import ZipFile

import pytest

from backend.features.reader import (
    clear_cache,
    get_page,
    get_page_count,
    _count_cbz_pages,
    _extract_cbz,
)


# ── Helpers ────────────────────────────────────────────────────


def _create_cbz(filepath: str, image_names: list) -> None:
    """Create a CBZ with empty placeholder images."""
    with ZipFile(filepath, 'w') as zf:
        for name in image_names:
            # Write minimal valid image bytes (1x1 PNG)
            minimal_png = (
                b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'
                b'\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02'
                b'\x00\x00\x00\x90wS\xde\x00\x00\x00\x0c'
                b'IDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05'
                b'\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
            )
            zf.writestr(name, minimal_png)


# ── CBZ Tests ──────────────────────────────────────────────────


def test_cbz_page_count():
    """Verify page count for a CBZ with 3 images."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, ['page01.jpg', 'page02.png', 'page03.webp'])

        assert get_page_count(cbz_path) == 3


def test_cbz_page_count_skips_non_images():
    """Verify non-image files and hidden files are excluded from count."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, [
            'page01.jpg',
            'readme.txt',
            '._hidden.jpg',
            'page02.png',
        ])

        assert get_page_count(cbz_path) == 2


def test_cbz_page_count_skips_macosx():
    """Verify __MACOSX resource fork files are excluded."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, [
            '__MACOSX/page01.jpg',
            'page01.jpg',
        ])

        assert get_page_count(cbz_path) == 1


def test_cbz_extract_and_get_page():
    """Verify we can extract a specific page from a CBZ."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, ['page01.jpg', 'page02.png'])

        # Get page 0
        image_bytes, mimetype = get_page(cbz_path, 0)
        assert mimetype == 'image/jpeg'
        assert len(image_bytes) > 0

        # Get page 1
        image_bytes, mimetype = get_page(cbz_path, 1)
        assert mimetype == 'image/png'
        assert len(image_bytes) > 0


def test_cbz_page_out_of_range():
    """Verify requesting a non-existent page raises IndexError."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, ['page01.jpg'])

        with pytest.raises(IndexError):
            get_page(cbz_path, 99)

        with pytest.raises(IndexError):
            get_page(cbz_path, -1)


def test_cbz_mimetype_detection():
    """Verify correct mimetypes for different image extensions."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, ['page01.webp'])

        _, mimetype = get_page(cbz_path, 0)
        assert mimetype == 'image/webp'


def test_empty_cbz():
    """Verify empty CBZ (no images) returns zero pages."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, [])

        assert get_page_count(cbz_path) == 0


# ── Cache Tests ─────────────────────────────────────────────────


def test_cache_clearing():
    """Verify cache dirs can be cleared."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        _create_cbz(cbz_path, ['page01.jpg', 'page02.jpg'])

        # Extract pages (populates cache)
        get_page(cbz_path, 0)
        get_page(cbz_path, 1)

        # Clear specific cache
        clear_cache(cbz_path)
        # Should not raise

        # Clear all caches
        clear_cache()
        # Should not raise


# ── Unsupported Format Tests ────────────────────────────────────


def test_unsupported_format_count():
    """Verify get_page_count raises on unsupported extension."""
    with tempfile.TemporaryDirectory() as tmpdir:
        text_path = join(tmpdir, 'test.txt')
        with open(text_path, 'w') as f:
            f.write('hello')

        with pytest.raises(ValueError):
            get_page_count(text_path)


def test_unsupported_format_extract():
    """Verify get_page raises on unsupported extension."""
    with tempfile.TemporaryDirectory() as tmpdir:
        text_path = join(tmpdir, 'test.txt')
        with open(text_path, 'w') as f:
            f.write('hello')

        with pytest.raises(ValueError):
            get_page(text_path, 0)


# ── Page Order Tests ────────────────────────────────────────────


def test_cbz_page_order():
    """Verify pages are extracted in sorted order (not archive order)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        cbz_path = join(tmpdir, 'test.cbz')
        # Create in reverse order; they should come out sorted by name
        _create_cbz(cbz_path, ['003.jpg', '001.jpg', '002.jpg'])

        image_paths = _extract_cbz(cbz_path, join(tmpdir, 'cache'))

        # Should be sorted alphabetically
        assert len(image_paths) == 3
        assert image_paths[0].endswith('001.jpg')
        assert image_paths[1].endswith('002.jpg')
        assert image_paths[2].endswith('003.jpg')
