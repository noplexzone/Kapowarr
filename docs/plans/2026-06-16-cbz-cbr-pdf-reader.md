# Built-in CBZ/CBR/PDF Reader — Implementation Plan

> **For Hermes:** Use claude-code skill to delegate this entire plan to Claude Code for execution.

**Goal:** Add an in-app comic reader so users can view CBZ, CBR, and PDF files directly in Kapowarr to verify file-to-issue matching and read their comics without leaving the app.

**Architecture:** Backend extracts individual pages from comic archives (CBZ/CBR) on demand via a new Flask API, caching extracted pages in a temp dir. PDFs are served directly to the browser's native PDF viewer. Frontend adds a full-screen reader overlay component with page navigation, keyboard shortcuts, and a "Read" button on downloaded issues in the volume detail page.

**Tech Stack:** Python (Flask, zipfile stdlib, run_rar helper, Pillow, pypdf), TypeScript/React (TanStack Router, CSS Modules)

---

## Task 1: Backend — Add `pypdf` dependency for PDF metadata

**Objective:** Ensure `pypdf` is available in the Kapowarr Python environment for reading PDF page counts.

**Files:**
- Modify: `pyproject.toml` or wherever dependencies are declared
- If the project has no dependency file: add `pypdf` via `pip install` in the Dockerfile or as a project dependency

**Step 1: Check current dependency declaration**

```bash
grep -r "pypdf\|rarfile\|Pillow" /mnt/user/appdata/dev/kapowarr/ --include="*.toml" --include="*.txt" --include="*.cfg" --include="Dockerfile*" 2>/dev/null
```

**Step 2: Add pypdf**

Kapowarr likely declares deps only in the Docker image (upstream `casvt/Kapowarr`). Since we publish our own Docker image, check if there's a Dockerfile or if we need to add the dep during the GitHub Actions build.

If no Dockerfile exists in the repo: the Docker build happens in CI — check `.github/workflows/` for the Docker build step and add `pypdf` there. Or simpler: create a `requirements-extra.txt` in `/mnt/user/appdata/dev/kapowarr/` and reference it from CI.

**Verification:** After CI rebuild, `docker exec kapowarr pip list | grep pypdf` should show the package.

---

## Task 2: Backend — Create `backend/features/reader.py`

**Objective:** Archive reader module that extracts page images from CBZ/CBR files and metadata from PDFs.

**Files:**
- Create: `backend/features/reader.py`

**Complete module:**

```python
# -*- coding: utf-8 -*-
"""Comic archive reader — extracts pages from CBZ, CBR, and PDF files."""

from __future__ import annotations

import io
import os
import shutil
import tempfile
from os.path import basename, exists, getmtime, join, splitext
from typing import List, Optional, Tuple
from zipfile import ZipFile

from PIL import Image

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
    """Extract all images from a CBZ file to cache_dir. Returns sorted image paths."""
    os.makedirs(cache_dir, exist_ok=True)
    image_paths: List[str] = []
    
    with ZipFile(filepath, 'r') as zf:
        for name in sorted(zf.namelist()):
            ext = splitext(name)[1].lower()
            if ext not in IMAGE_EXTS:
                continue
            # Skip macOS resource fork files and hidden files
            if basename(name).startswith('._') or '__MACOSX' in name:
                continue
            dest = join(cache_dir, basename(name))
            if not exists(dest):
                zf.extract(name, cache_dir)
                # If extracted into a subdir, move it
                extracted_path = join(cache_dir, name)
                if extracted_path != dest:
                    shutil.move(extracted_path, dest)
            image_paths.append(dest)
    
    return image_paths


def _extract_cbr(filepath: str, cache_dir: str) -> List[str]:
    """Extract all images from a CBR file to cache_dir using run_rar."""
    os.makedirs(cache_dir, exist_ok=True)
    image_paths: List[str] = []
    
    # List contents
    result = run_rar(['lb', filepath])
    if result.returncode != 0:
        raise RuntimeError(f"rar lb failed: {result.stderr}")
    
    names = [n.strip() for n in result.stdout.splitlines() if n.strip()]
    # Filter to images, sort
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
        
        # Extract single file to stdout
        result = run_rar(['p', '-inul', filepath, name])
        if result.returncode != 0:
            LOGGER.warning(f"Failed to extract {name} from {filepath}")
            continue
        
        with open(dest, 'wb') as f:
            f.write(result.stdout)
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
        if n.strip() and splitext(n.strip())[1].lower() in IMAGE_EXTS
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
        return 1  # fallback


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
        raise IndexError(f"Page {page_num} out of range (0-{len(image_paths)-1})")
    
    path = image_paths[page_num]
    
    # Determine mimetype from extension
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
    """Return PDF file bytes, mimetype, and filename for direct browser serving.
    
    Returns:
        (pdf_bytes, 'application/pdf', filename)
    """
    with open(filepath, 'rb') as f:
        return f.read(), 'application/pdf', basename(filepath)


def clear_cache(filepath: str = None) -> None:
    """Clear the extraction cache. If filepath given, clear only that file's cache."""
    if filepath:
        cache_dir = _get_cache_dir(filepath)
        if exists(cache_dir):
            shutil.rmtree(cache_dir, ignore_errors=True)
    else:
        if exists(CACHE_ROOT):
            shutil.rmtree(CACHE_ROOT, ignore_errors=True)
```

---

## Task 3: Backend — Add reader API endpoints

**Objective:** Add `GET /api/files/<file_id>/info` and `GET /api/files/<file_id>/page/<n>` endpoints.

**Files:**
- Modify: `frontend/api.py`

**Step 1: Add import**

At top of `frontend/api.py`, add:

```python
from backend.features.reader import get_page_count, get_page, serve_pdf_file, clear_cache
```

**Step 2: Add file info endpoint**

Insert before the `# =====================` divider near line 1190 (or wherever appropriate):

```python
@api.route('/files/<int:file_id>/info', methods=['GET'])
@error_handler
@auth
def api_file_info(file_id: int):
    """Get page count and file metadata for the reader."""
    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')
    
    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')
    
    ext = splitext(filepath)[1].lower()
    is_pdf = ext == '.pdf'
    
    page_count = get_page_count(filepath) if not is_pdf else 0
    
    return return_api({
        'file_id': file_id,
        'filepath': filepath,
        'file_type': ext.lstrip('.'),
        'page_count': page_count,
        'is_pdf': is_pdf,
        'size': file_data.get('size', 0),
    })


@api.route('/files/<int:file_id>/page/<int:page_num>', methods=['GET'])
@error_handler
@auth
def api_file_page(file_id: int, page_num: int):
    """Serve a single page from a comic file as an image."""
    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')
    
    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')
    
    ext = splitext(filepath)[1].lower()
    
    # PDFs: serve the raw PDF file for browser native viewer
    if ext == '.pdf':
        if page_num == 0:
            pdf_bytes, mimetype, filename = serve_pdf_file(filepath)
            return Response(
                pdf_bytes,
                mimetype=mimetype,
                headers={
                    'Content-Disposition': f'inline; filename="{filename}"',
                    'Cache-Control': 'private, max-age=3600',
                }
            ), 200
        else:
            raise InvalidKeyValue('page_num', page_num)  # PDF only has "page 0" = the whole file
    
    try:
        image_bytes, mimetype = get_page(filepath, page_num)
    except IndexError:
        raise InvalidKeyValue('page_num', page_num)
    except ValueError as e:
        raise InvalidKeyValue('file_type', str(e))
    
    return Response(
        image_bytes,
        mimetype=mimetype,
        headers={'Cache-Control': 'private, max-age=3600'}
    ), 200
```

**Step 3: Add required import for `FilesDB.get_data()`** — check if it exists. If not, add it.

**Step 4: Add `FilesDB.get_data()` method if missing**

In `backend/internals/db_models.py`, inside `FilesDB` class:

```python
@staticmethod
def get_data(file_id: int) -> Optional[dict]:
    """Get a single file's data by ID."""
    return get_db().execute(
        "SELECT id, filepath, size FROM files WHERE id = ?",
        (file_id,)
    ).fetchonedict()
```

---

## Task 4: Backend — Add route for serving the raw PDF file directly

**Objective:** For PDFs, browsers can display them natively via `<embed>` or `<iframe>`. Add a direct file serve endpoint.

**Files:**
- Modify: `frontend/api.py`

```python
@api.route('/files/<int:file_id>/raw', methods=['GET'])
@error_handler  
@auth
def api_file_raw(file_id: int):
    """Serve the raw file for browser-native handling (PDFs)."""
    file_data = FilesDB.get_data(file_id)
    if not file_data:
        raise KeyNotFound('file_id')
    
    filepath = file_data['filepath']
    if not exists(filepath):
        raise KeyNotFound('filepath')
    
    ext = splitext(filepath)[1].lower()
    mimetype = 'application/pdf' if ext == '.pdf' else 'application/octet-stream'
    
    return send_file(
        filepath,
        mimetype=mimetype,
        as_attachment=False,
        download_name=basename(filepath),
    ), 200
```

---

## Task 5: Backend — Add test coverage

**Objective:** Test the reader module with real and edge-case archives.

**Files:**
- Create: `tests/Tbackend/test_reader.py`

**Test cases:**
1. `test_cbz_page_count` — create a CBZ with 3 images, verify page count
2. `test_cbz_get_page` — extract page 0, verify it's the expected image
3. `test_cbz_page_out_of_range` — request page 99, verify IndexError
4. `test_cbr_page_count` — similar for CBR format
5. `test_pdf_page_count` — verify PDF page count with pypdf
6. `test_unsupported_format` — non-comic file raises ValueError
7. `test_clear_cache` — extract pages, clear, verify cache dir removed

**Verification:**
```bash
cd /mnt/user/appdata/dev/kapowarr && python3 -m pytest tests/Tbackend/test_reader.py -v
```

---

## Task 6: Frontend — Create reader route and types

**Objective:** Scaffold the reader route with TanStack Router and TypeScript types.

**Files:**
- Create: `frontend/src/routes/reader/-reader.types.ts`
- Create: `frontend/src/routes/reader/-reader.api.ts`
- Create: `frontend/src/routes/reader/-ui/reader-page.tsx`
- Create: `frontend/src/routes/reader/-ui/reader-page.module.css`
- Modify: `frontend/src/app/router.tsx`

**Step 1: Types (`-reader.types.ts`)**

```typescript
export interface FileInfo {
  file_id: number;
  filepath: string;
  file_type: string;
  page_count: number;
  is_pdf: boolean;
  size: number;
}
```

**Step 2: API hooks (`-reader.api.ts`)**

```typescript
import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { FileInfo } from './-reader.types';

export function fileInfoQueryOptions(fileId: number) {
  return queryOptions({
    queryKey: ['file', 'info', fileId],
    queryFn: () => fetchFileInfo(fileId),
    staleTime: 60_000,
    enabled: fileId > 0,
  });
}

async function fetchFileInfo(fileId: number): Promise<FileInfo> {
  const response = await apiClient.get(`files/${fileId}/info`);
  return readJson<FileInfo>(response);
}

/** Build the URL for a specific page image. */
export function pageUrl(fileId: number, page: number): string {
  // apiClient.getUrlBase() provides the base; construct the path
  return `/api/files/${fileId}/page/${page}`;
}

/** URL for serving the raw file (PDFs). */
export function rawFileUrl(fileId: number): string {
  return `/api/files/${fileId}/raw`;
}
```

**Step 3: Route registration (`router.tsx`)**

Add to the route tree:

```typescript
// In the route definitions, add:
const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/read/$fileId',
  component: () => {
    const ReaderPage = lazyRouteComponent(
      () => import('@/routes/reader/-ui/reader-page'),
    );
    return <ReaderPage />;
  },
});
```

---

## Task 7: Frontend — Build reader page component

**Objective:** Full-screen reader overlay with page navigation, image display, keyboard shortcuts.

**Files:**
- Modify: `frontend/src/routes/reader/-ui/reader-page.tsx`
- Modify: `frontend/src/routes/reader/-ui/reader-page.module.css`

**Component:**

```tsx
import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/primitives';
import { fileInfoQueryOptions, pageUrl, rawFileUrl } from '../-reader.api';
import styles from './reader-page.module.css';

function ArrowLeftIcon() { /* SVG left arrow */ }
function ArrowRightIcon() { /* SVG right arrow */ }
function CloseIcon() { /* SVG X */ }

export function ReaderPage() {
  const { fileId } = useParams({ strict: false }) as { fileId: string };
  const fid = parseInt(fileId ?? '0', 10);
  const navigate = useNavigate();
  
  const [currentPage, setCurrentPage] = useState(0);
  
  const { data: info, isLoading, error } = useQuery(fileInfoQueryOptions(fid));
  
  const totalPages = info?.page_count ?? 0;
  const isPdf = info?.is_pdf ?? false;
  
  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigate({ to: '..' });
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentPage(p => Math.min(p + 1, totalPages - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentPage(p => Math.max(p - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, totalPages]);
  
  const goPrev = useCallback(() => setCurrentPage(p => Math.max(p - 1, 0)), []);
  const goNext = useCallback(() => setCurrentPage(p => Math.min(p + 1, totalPages - 1)), [totalPages]);
  
  if (isLoading) {
    return <div className={styles.container}><p className={styles.status}>Loading reader…</p></div>;
  }
  
  if (error || !info) {
    return (
      <div className={styles.container}>
        <p className={styles.status}>Failed to load file info.</p>
        <Button variant="secondary" onClick={() => navigate({ to: '..' })}>Back</Button>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.pageInfo}>
          {isPdf ? 'PDF Document' : `Page ${currentPage + 1} / ${totalPages}`}
        </span>
        <span className={styles.fileName}>{info.filepath.split('/').pop()}</span>
        <button
          className={styles.closeBtn}
          onClick={() => navigate({ to: '..' })}
          title="Close reader (Esc)"
          aria-label="Close reader"
        >
          <CloseIcon />
        </button>
      </div>
      
      {/* Content area */}
      <div className={styles.content}>
        {isPdf ? (
          <embed
            src={rawFileUrl(fid)}
            type="application/pdf"
            className={styles.pdfEmbed}
          />
        ) : (
          <>
            <button
              className={styles.navBtn}
              onClick={goPrev}
              disabled={currentPage === 0}
              title="Previous page (←)"
              aria-label="Previous page"
            >
              <ArrowLeftIcon />
            </button>
            
            <img
              src={pageUrl(fid, currentPage)}
              alt={`Page ${currentPage + 1}`}
              className={styles.pageImage}
              draggable={false}
            />
            
            <button
              className={styles.navBtn}
              onClick={goNext}
              disabled={currentPage >= totalPages - 1}
              title="Next page (→)"
              aria-label="Next page"
            >
              <ArrowRightIcon />
            </button>
          </>
        )}
      </div>
      
      {/* Bottom bar (for non-PDF) */}
      {!isPdf && (
        <div className={styles.bottomBar}>
          <Button variant="secondary" onClick={goPrev} disabled={currentPage === 0}>
            ← Prev
          </Button>
          <span className={styles.pageIndicator}>
            {currentPage + 1} / {totalPages}
          </span>
          <Button variant="secondary" onClick={goNext} disabled={currentPage >= totalPages - 1}>
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
```

**CSS (`reader-page.module.css`):**

```css
.container {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #000;
  display: flex;
  flex-direction: column;
  color: #fff;
}

.topBar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.85);
  gap: 16px;
  flex-shrink: 0;
}

.pageInfo {
  font-size: 14px;
  opacity: 0.8;
}

.fileName {
  flex: 1;
  font-size: 13px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.closeBtn {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.closeBtn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.pageImage {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}

.pdfEmbed {
  width: 100%;
  height: 100%;
  border: none;
}

.navBtn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 16px 8px;
  border-radius: 4px;
  z-index: 10;
  transition: background 0.15s;
}

.navBtn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
}

.navBtn:disabled {
  opacity: 0.3;
  cursor: default;
}

.navBtn:first-of-type {
  left: 8px;
}

.navBtn:last-of-type {
  right: 8px;
}

.bottomBar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.85);
  flex-shrink: 0;
}

.pageIndicator {
  font-size: 14px;
  min-width: 80px;
  text-align: center;
}

.status {
  color: #fff;
  font-size: 16px;
}
```

---

## Task 8: Frontend — Add "Read" button to volume detail page

**Objective:** Add a "Read" button to the IssueRow component for downloaded issues, linking to the reader.

**Files:**
- Modify: `frontend/src/routes/volumes/-ui/volume-detail-page.tsx`
- Modify: `frontend/src/routes/volumes/-volumes.api.ts` (minor — add file ID fetch helper)

**Step 1: Add a small helper to get the first file ID for an issue**

In `-volumes.api.ts`:

```typescript
export async function fetchIssueFiles(issueId: number): Promise<{ id: number; filepath: string; size: number }[]> {
  const response = await apiClient.get(`issues/${issueId}`);
  const data = await readJson<IssueData>(response);
  return data.files ?? [];
}
```

**Step 2: Modify IssueRow to include a "Read" button**

In `volume-detail-page.tsx`, update the `IssueRowProps` interface and component:

- Add a `fileId` prop or fetch it on click
- Simpler: pass the reader link — the `IssueDetail` type already has `downloaded`, but doesn't have `file_id`. We need to either:
  a. Add file IDs to the `IssueDetail` type via the volume API response
  b. Fetch issue files when "Read" is clicked
  c. Add a `file_ids` field to the `IssueDetail` SPA type

Option (c) is cleanest. Update `VolumeDetailFull.issues` to include `file_ids: number[]`, update the API transform in `toVolumeDetailFull()`, and update the backend `Volume.get_public_data()` to include file IDs.

**Simpler approach:** Add `file_ids` to the `IssueDetail` type and include it from the API response.

In `-volumes.types.ts`, add to `IssueDetail`:

```typescript
export interface IssueDetail {
  // ... existing fields
  file_ids: number[];
}
```

In `-volumes.api.ts`, in `toVolumeDetailFull()`, add:
```typescript
file_ids: Array.isArray(i.file_ids) ? i.file_ids : [],
```

In the backend, in `Volume.get_public_data()` (where issues are listed), include `file_ids` from `FilesDB.fetch(issue_id=...)`.

**Step 3: Add Read button to IssueRow**

```tsx
// In IssueRow, after the history button:
{issue.downloaded && issue.file_ids.length > 0 && (
  <Link
    to="/read/$fileId"
    params={{ fileId: String(issue.file_ids[0]) }}
    className={styles.issueActionBtn}
    title="Read this issue"
    aria-label="Read this issue"
  >
    <BookOpenIcon />
  </Link>
)}
```

---

## Task 9: Backend — Include `file_ids` in volume public data

**Objective:** Modify the volume public data to include file IDs for each issue, so the frontend knows which file to open for reading.

**Files:**
- Modify: `backend/implementations/volumes.py`

In `Volume.get_public_data()` (around line 291), where issues are formatted:

```python
# For each issue in the issues list, add file_ids:
issue_data = issue.get_data()
result_issues.append({
    'id': issue_data.id,
    'issue_number': issue_data.issue_number,
    # ... existing fields ...
    'file_ids': [f['id'] for f in issue_data.files],
})
```

---

## Task 10: Backend — Add `FilesDB.get_data()` 

**Objective:** The reader API needs to look up file paths by ID.

**Files:**
- Modify: `backend/internals/db_models.py`

In `FilesDB` class:

```python
@staticmethod
def get_data(file_id: int) -> Optional[dict]:
    """Get a single file's data by ID."""
    return get_db().execute(
        "SELECT id, filepath, size FROM files WHERE id = ?",
        (file_id,)
    ).fetchonedict()
```

---

## Task 11: Integration — Add keyboard shortcut hint and page click navigation

**Objective:** Polish the reader UX with click-to-advance and a visible keyboard shortcut hint.

**Files:**
- Modify: `frontend/src/routes/reader/-ui/reader-page.tsx`

Add click on the image to advance to next page (unless it's the last page), and show keyboard hints on first load:

```tsx
const [showHints, setShowHints] = useState(true);

useEffect(() => {
  const timer = setTimeout(() => setShowHints(false), 5000);
  return () => clearTimeout(timer);
}, []);
```

Add click handler on the content area:
```tsx
const handleContentClick = useCallback((e: React.MouseEvent) => {
  // Only advance if clicking the image area, not nav buttons
  if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') {
    goNext();
  }
}, [goNext]);
```

---

## Task 12: Build, Test, and Commit

**Objective:** Validate everything compiles, type-checks, and tests pass.

**Commands:**
```bash
# Backend
cd /mnt/user/appdata/dev/kapowarr
python3 -m py_compile frontend/api.py
python3 -m py_compile backend/features/reader.py
python3 -m pytest tests/Tbackend/test_reader.py -v

# Frontend
cd /mnt/user/appdata/dev/kapowarr/frontend
npx tsc -b --noEmit
npm run build

# Commit
git -c safe.directory=/mnt/user/appdata/dev/kapowarr -C /mnt/user/appdata/dev/kapowarr add -A
git -c safe.directory=/mnt/user/appdata/dev/kapowarr -C /mnt/user/appdata/dev/kapowarr commit -m "feat: in-app CBZ/CBR/PDF reader"
git -c safe.directory=/mnt/user/appdata/dev/kapowarr -C /mnt/user/appdata/dev/kapowarr push origin develop
```

---

## Verification

After deploying the new Docker image:

1. Open a volume detail page
2. Find a downloaded issue — a "Read" button (book icon) should appear
3. Click it — the reader opens fullscreen
4. Navigate pages with arrow buttons, keyboard arrows, or clicking the image
5. Press Escape or click X to close
6. For PDF files: the browser's native PDF viewer should appear embedded
7. Verify that the page count matches the actual number of pages in the file

---

## Pitfalls

- **`tsc -b` strictness**: Always use `npx tsc -b --noEmit` for type-checking, not plain `tsc --noEmit`. `tsc -b` catches unused imports (TS6196) and unused variables (TS6133) that `--noEmit` silently permits.
- **Timestamp unit mismatch**: N/A for this feature, but remember all API timestamps are Unix seconds.
- **CBR extraction reliability**: `run_rar` returns the rar process result. The `-inul` flag suppresses license messages. If the bundled rar binary has issues, the CBR reader may fail. Test with a real CBR file.
- **Cache growth**: The temp cache dir at `/tmp/kapowarr_reader_cache/` grows over time. Consider adding a cron job or periodic cleanup, or clearing on container restart. The cache is keyed by filepath + mtime, so it auto-invalidates when files change.
- **Large files**: Very large CBZ/CBR files (500MB+) may cause extraction delays on first access. The cache mitigates this for subsequent reads.
- **PDF dependency**: `pypdf` must be installed in the Kapowarr container. If not available, the fallback returns `page_count: 0` and the frontend falls back to serving the raw PDF (which still works).
- **`FilesDB.get_data()` may not exist**: Check the existing `db_models.py` before adding it. The `FilesDB` class should have at least `fetch()` — we may need to add `get_data()` or use an existing method.
