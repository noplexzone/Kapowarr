# -*- coding: utf-8 -*-
"""Comic archive reader — extracts pages from CBZ, CBR, and PDF files."""

from __future__ import annotations

import os
import shutil
import tempfile
from os.path import basename, exists, getmtime, join, splitext
from typing import List, Optional, Tuple
from zipfile import ZipFile

from backend.base.helpers import run_rar
from backend.base.logging import LOGGER

# Supported image extensions inside archives
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}

# Temp cache directory for extracted pages
CACHE_ROOT = join(tempfile.gettempdir(), 'kapowarr_reader_cache')


def _get_cache_dir(filepath: str) -> str:
    """Get a cache directory keyed by filepath and mtime."""
    mtime = str(int(getmtime(filepath)))
    safe_name = filepath.replace('/', '_').replace('\\', '_').lstrip('_')
    return join(CACHE_ROOT, f"{safe_name}_{mtime}")


def _extract_cbz(filepath: str, cache_dir: str) -> List[str]:
    """Extract all images from a CBZ to cache_dir. Returns sorted image paths."""
    os.makedirs(cache_dir, exist_ok=True)
    image_paths: List[str] = []

    with ZipFile(filepath, 'r') as zf:
        for name in sorted(zf.namelist()):
            ext = splitext(name)[1].lower()
            if ext not in IMAGE_EXTS:
                continue
            if basename(name).startswith('._') or '__MACOSX' in name:
                continue
            dest = join(cache_dir, basename(name))
            if not exists(dest):
                zf.extract(name, cache_dir)
                extracted_path = join(cache_dir, name)
                if extracted_path != dest:
                    shutil.move(extracted_path, dest)
            image_paths.append(dest)

    return image_paths


def _extract_cbr(filepath: str, cache_dir: str) -> List[str]:
    """Extract all images from a CBR to cache_dir using run_rar."""
    os.makedirs(cache_dir, exist_ok=True)
    image_paths: List[str] = []

    result = run_rar(['lb', filepath])
    if result.returncode != 0:
        raise RuntimeError(f"rar lb failed: {result.stderr}")

    names = [n.strip() for n in result.stdout.splitlines() if n.strip()]
    image_names = sorted(
        n for n in names
        if splitext(n)[1].lower() in IMAGE_EXTS
        and not basename(n).startswith('._')
        and '__MACOSX' not in n
    )

    for name in image_names:
        dest = join(cache_dir, basename(name))
        if exists(dest):
            image_paths.append(dest)
            continue

        # Extract single file to cache_dir using rar x
        result = run_rar(['x', '-o+', f'-y', filepath, name, cache_dir])
        if result.returncode != 0:
            LOGGER.warning(f"Failed to extract {name} from {filepath}")
            continue

        if exists(dest):
            image_paths.append(dest)
        else:
            # rar may have preserved subdirectory structure
            extracted = join(cache_dir, name)
            if exists(extracted):
                shutil.move(extracted, dest)
                image_paths.append(dest)

    return image_paths


def get_page_count(filepath: str) -> int:
    """Get the number of readable pages in a comic file."""
    ext = splitext(filepath)[1].lower()

    if ext in ('.cbz', '.zip'):
        return _count_cbz_pages(filepath)
    elif ext in ('.cbr', '.rar'):
        return _count_cbr_pages(filepath)
    elif ext == '.pdf':
        return _count_pdf_pages(filepath)
    else:
        raise ValueError(f"Unsupported format: {ext}")


def _count_cbz_pages(filepath: str) -> int:
    with ZipFile(filepath, 'r') as zf:
        return sum(
            1 for name in zf.namelist()
            if splitext(name)[1].lower() in IMAGE_EXTS
            and not basename(name).startswith('._')
            and '__MACOSX' not in name
        )


def _count_cbr_pages(filepath: str) -> int:
    result = run_rar(['lb', filepath])
    if result.returncode != 0:
        return 0
    return sum(
        1 for n in result.stdout.splitlines()
        if n.strip()
        and splitext(n.strip())[1].lower() in IMAGE_EXTS
        and not basename(n.strip()).startswith('._')
        and '__MACOSX' not in n
    )


def _count_pdf_pages(filepath: str) -> int:
    try:
        from pypdf import PdfReader
        reader = PdfReader(filepath)
        return len(reader.pages)
    except ImportError:
        LOGGER.warning("pypdf not installed, cannot count PDF pages")
        return 1


def get_page(filepath: str, page_num: int) -> Tuple[bytes, str]:
    """Get page N (0-indexed) as image bytes and mimetype.

    Returns:
        (image_bytes, mimetype) — e.g. (b'...', 'image/jpeg')
    """
    cache_dir = _get_cache_dir(filepath)
    ext = splitext(filepath)[1].lower()

    if ext in ('.cbz', '.zip'):
        image_paths = _extract_cbz(filepath, cache_dir)
    elif ext in ('.cbr', '.rar'):
        image_paths = _extract_cbr(filepath, cache_dir)
    else:
        raise ValueError(f"Unsupported format for page extraction: {ext}")

    if page_num < 0 or page_num >= len(image_paths):
        raise IndexError(
            f"Page {page_num} out of range (0-{len(image_paths)-1})"
        )

    path = image_paths[page_num]

    page_ext = splitext(path)[1].lower()
    mimetype_map = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.gif': 'image/gif',
    }
    mimetype = mimetype_map.get(page_ext, 'image/jpeg')

    with open(path, 'rb') as f:
        return f.read(), mimetype


def serve_pdf_file(filepath: str) -> Tuple[bytes, str, str]:
    """Return PDF file bytes, mimetype, and filename.

    Returns:
        (pdf_bytes, 'application/pdf', filename)
    """
    with open(filepath, 'rb') as f:
        return f.read(), 'application/pdf', basename(filepath)


def clear_cache(filepath: Optional[str] = None) -> None:
    """Clear the extraction cache."""
    if filepath:
        cache_dir = _get_cache_dir(filepath)
        if exists(cache_dir):
            shutil.rmtree(cache_dir, ignore_errors=True)
    else:
        if exists(CACHE_ROOT):
            shutil.rmtree(CACHE_ROOT, ignore_errors=True)
