# -*- coding: utf-8 -*-

"""
Suwayomi-Server API client.

Suwayomi exposes a GraphQL API at /api/graphql (primary) and a deprecated
REST API at /api/v1.  We use GraphQL for library/chapter management and the
REST API only for fetching page images.
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from threading import Event
from time import sleep
from typing import Dict, List, Optional, Tuple

from requests import Session
from requests.exceptions import RequestException

from backend.base.logging import LOGGER

# Prefix used in the Kapowarr download_link field for Suwayomi entries.
SUWAYOMI_SCHEME = "suwayomi:"
SUWAYOMI_SOURCE_NAME = "Suwayomi"

# Seconds between polling Suwayomi for chapter download status.
POLL_INTERVAL = 5


def make_suwayomi_link(manga_id: int, chapter_id: int) -> str:
    """Encode manga/chapter IDs as a Kapowarr download_link."""
    return f"suwayomi:{manga_id}:{chapter_id}"


def parse_suwayomi_link(link: str) -> Tuple[int, int]:
    """Decode a suwayomi:M:C link → (manga_id, chapter_id)."""
    _, manga_id, chapter_id = link.split(":")
    return int(manga_id), int(chapter_id)


def make_suwayomi_volume_link(manga_id: int, chapter_ids: List[int]) -> str:
    """Encode manga ID + multiple chapter IDs as a Kapowarr download_link."""
    return f"suwayomi:{manga_id}:{','.join(str(cid) for cid in chapter_ids)}"


def parse_suwayomi_volume_link(link: str) -> Tuple[int, List[int]]:
    """Decode a suwayomi:M:C1,C2,... link → (manga_id, [chapter_ids])."""
    _, manga_id, chapter_list = link.split(":", 2)
    chapter_ids = [int(c) for c in chapter_list.split(",")]
    return int(manga_id), chapter_ids


def is_suwayomi_link(link: str) -> bool:
    return link.startswith(SUWAYOMI_SCHEME)


def is_manga_publisher(publisher: Optional[str]) -> bool:
    """Return True if publisher string matches a known manga publisher."""
    if not publisher:
        return False
    from backend.implementations.comicvine import (
        _ENGLISH_MANGA_PUBLISHERS, _MANGA_PUBLISHERS
    )
    pub_lower = publisher.lower().strip()
    return pub_lower in _MANGA_PUBLISHERS or pub_lower in _ENGLISH_MANGA_PUBLISHERS


class SuwayomiClient:
    """Thin wrapper around the Suwayomi-Server GraphQL + REST APIs."""

    def __init__(self) -> None:
        from backend.internals.settings import Settings
        sv = Settings().sv
        self._base_url = sv.suwayomi_base_url.rstrip("/")
        self._ssn = Session()
        if sv.suwayomi_username and sv.suwayomi_password:
            self._ssn.auth = (sv.suwayomi_username, sv.suwayomi_password)

    def is_configured(self) -> bool:
        return bool(self._base_url)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _gql(
        self,
        query: str,
        variables: Optional[Dict] = None
    ) -> dict:
        resp = self._ssn.post(
            f"{self._base_url}/api/graphql",
            json={"query": query, "variables": variables or {}},
            timeout=15,
        )
        resp.raise_for_status()
        payload = resp.json()
        if "errors" in payload:
            raise RuntimeError(f"Suwayomi GraphQL error: {payload['errors']}")
        return payload["data"]

    # ------------------------------------------------------------------
    # Library / manga
    # ------------------------------------------------------------------

    def get_library_manga(self) -> List[Dict]:
        """Return all manga in the user's library: [{id, title}, ...]."""
        data = self._gql("""
            query {
                mangas(filter: {inLibrary: {equalTo: true}}) {
                    nodes { id title }
                }
            }
        """)
        return data["mangas"]["nodes"]

    # ------------------------------------------------------------------
    # Chapters
    # ------------------------------------------------------------------

    def get_chapters(self, manga_id: int) -> List[Dict]:
        """Return all chapters for a manga.

        Each item has: id, mangaId, chapterNumber, isDownloaded,
        pageCount, name, sourceOrder.
        """
        data = self._gql(
            """
            query Chapters($mangaId: Int!) {
                chapters(filter: {mangaId: {equalTo: $mangaId}}) {
                    nodes {
                        id mangaId chapterNumber
                        isDownloaded pageCount
                        name sourceOrder
                    }
                }
            }
            """,
            {"mangaId": manga_id},
        )
        return data["chapters"]["nodes"]

    def get_chapter_info(self, manga_id: int, chapter_id: int) -> Optional[Dict]:
        """Return the chapter dict for a specific chapter ID, or None."""
        for ch in self.get_chapters(manga_id):
            if ch["id"] == chapter_id:
                return ch
        return None

    # ------------------------------------------------------------------
    # Downloads
    # ------------------------------------------------------------------

    def enqueue_download(self, chapter_id: int) -> None:
        """Tell Suwayomi to download a chapter."""
        self._gql(
            """
            mutation EnqueueDownload($id: Int!) {
                enqueueChapterDownload(id: $id) { state }
            }
            """,
            {"id": chapter_id},
        )

    def wait_for_download(
        self,
        manga_id: int,
        chapter_id: int,
        stop_event: Event,
    ) -> Optional[Dict]:
        """Block until the chapter is downloaded or stop_event is set.

        Returns the chapter dict when downloaded, or None if stopped/failed.
        """
        while not stop_event.is_set():
            ch = self.get_chapter_info(manga_id, chapter_id)
            if ch is None:
                LOGGER.warning(
                    "Suwayomi: chapter %d not found for manga %d",
                    chapter_id, manga_id,
                )
                return None
            if ch["isDownloaded"]:
                return ch
            LOGGER.debug(
                "Suwayomi: waiting for chapter %d (manga %d) to download…",
                chapter_id, manga_id,
            )
            stop_event.wait(timeout=POLL_INTERVAL)

        return None

    # ------------------------------------------------------------------
    # Page images
    # ------------------------------------------------------------------

    def get_page_image(
        self,
        manga_id: int,
        chapter_source_order: int,
        page_index: int,
    ) -> bytes:
        """Fetch a single page image via the Suwayomi REST API.

        Suwayomi addresses chapters by their sourceOrder (position) when
        serving page images through the REST endpoint.
        """
        url = (
            f"{self._base_url}/api/v1/manga/{manga_id}"
            f"/chapter/{chapter_source_order}/page/{page_index}"
        )
        resp = self._ssn.get(url, timeout=30)
        resp.raise_for_status()
        return resp.content

    def create_cbz(
        self,
        manga_id: int,
        chapter_source_order: int,
        page_count: int,
        dest_path: str,
        stop_event: Event,
    ) -> bool:
        """Download all pages and create a CBZ file at dest_path.

        Returns True on success, False if stop_event fired mid-way.
        """
        with zipfile.ZipFile(dest_path, "w", zipfile.ZIP_STORED) as zf:
            for i in range(page_count):
                if stop_event.is_set():
                    return False
                data = self.get_page_image(manga_id, chapter_source_order, i)
                ext = _detect_image_ext(data)
                zf.writestr(f"{i + 1:04d}.{ext}", data)
        return True

    def create_pdf_from_chapters(
        self,
        manga_id: int,
        chapters: List[Tuple[int, int]],
        dest_path: str,
        stop_event: Event,
    ) -> bool:
        """Download pages from multiple chapters and merge into one PDF.

        Args:
            manga_id: Suwayomi manga ID.
            chapters: List of (source_order, page_count) tuples, in order.
            dest_path: Output PDF file path.
            stop_event: Event to signal cancellation.

        Returns True on success, False if stopped or no pages collected.
        """
        import img2pdf

        temp_paths: List[str] = []
        try:
            for source_order, page_count in chapters:
                for i in range(page_count):
                    if stop_event.is_set():
                        return False
                    data = self.get_page_image(manga_id, source_order, i)
                    ext = _detect_image_ext(data)
                    with tempfile.NamedTemporaryFile(
                        delete=False, suffix=f'.{ext}'
                    ) as tf:
                        tf.write(data)
                        temp_paths.append(tf.name)

            if not temp_paths:
                return False

            if stop_event.is_set():
                return False

            pdf_bytes = img2pdf.convert(temp_paths)
            with open(dest_path, 'wb') as f:
                f.write(pdf_bytes)

            return True

        finally:
            for path in temp_paths:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    # ------------------------------------------------------------------
    # Source search / library sync
    # ------------------------------------------------------------------

    def get_sources(self) -> List[Dict]:
        """Return all installed extension sources: [{id, name, lang}, ...]."""
        data = self._gql("""
            query {
                sources {
                    nodes { id name lang }
                }
            }
        """)
        return data["sources"]["nodes"]

    def search_source(self, source_id: str, title: str) -> List[Dict]:
        """Search one source for manga by title. Returns [{id, title}, ...]."""
        data = self._gql(
            """
            mutation FetchSourceManga($source: LongString!, $query: String!) {
                fetchSourceManga(input: {source: $source, type: SEARCH, query: $query, page: 1}) {
                    mangas { id title }
                }
            }
            """,
            {"source": source_id, "query": title},
        )
        return data["fetchSourceManga"]["mangas"]

    def add_to_library(self, manga_id: int) -> None:
        """Mark a manga as in-library."""
        self._gql(
            """
            mutation UpdateManga($id: Int!) {
                updateManga(input: {id: $id, patch: {inLibrary: true}}) {
                    manga { id }
                }
            }
            """,
            {"id": manga_id},
        )

    def remove_from_library(self, manga_id: int) -> None:
        """Remove a manga from the library."""
        self._gql(
            """
            mutation UpdateManga($id: Int!) {
                updateManga(input: {id: $id, patch: {inLibrary: false}}) {
                    manga { id }
                }
            }
            """,
            {"id": manga_id},
        )

    def fetch_manga_chapters(self, manga_id: int) -> List[Dict]:
        """Fetch the chapter list from the source and return it.

        Uses fetchChapters which synchronously retrieves chapters from the
        extension source and stores them in Suwayomi's database.
        """
        data = self._gql(
            """
            mutation FetchChapters($mangaId: Int!) {
                fetchChapters(input: {mangaId: $mangaId}) {
                    chapters { id chapterNumber sourceOrder name }
                }
            }
            """,
            {"mangaId": manga_id},
        )
        return data["fetchChapters"]["chapters"]

    def sync_manga_to_library(self, title: str) -> bool:
        """Search all sources for title, add first matching manga to library.

        Returns True if a manga was added, False otherwise.
        Intended to run in a background thread — all errors are logged, not raised.
        """
        try:
            sources = self.get_sources()
        except Exception as exc:
            LOGGER.debug("Suwayomi: failed to fetch sources: %s", exc)
            return False

        title_lower = title.lower()
        for source in sources:
            if source.get("name") == "Local source":
                continue

            try:
                results = self.search_source(source["id"], title)
            except Exception as exc:
                LOGGER.debug(
                    "Suwayomi: search failed for source '%s': %s",
                    source.get("name", source["id"]), exc,
                )
                continue

            for manga in results:
                manga_title_lower = manga["title"].lower()
                if title_lower in manga_title_lower or manga_title_lower in title_lower:
                    manga_id = manga["id"]
                    try:
                        self.add_to_library(manga_id)
                    except Exception as exc:
                        LOGGER.debug(
                            "Suwayomi: failed to add '%s' to library: %s",
                            manga["title"], exc,
                        )
                        continue

                    try:
                        chapters = self.fetch_manga_chapters(manga_id)
                    except Exception as exc:
                        LOGGER.debug(
                            "Suwayomi: chapter fetch failed for '%s' via '%s': %s",
                            manga["title"], source.get("name", source["id"]), exc,
                        )
                        chapters = []

                    if not chapters:
                        LOGGER.debug(
                            "Suwayomi: no chapters for '%s' via '%s', trying next source",
                            manga["title"], source.get("name", source["id"]),
                        )
                        try:
                            self.remove_from_library(manga_id)
                        except Exception as exc:
                            LOGGER.debug(
                                "Suwayomi: failed to remove '%s' from library: %s",
                                manga["title"], exc,
                            )
                        continue

                    LOGGER.info(
                        "Suwayomi: added '%s' (id=%d) to library via source '%s' (%d chapters)",
                        manga["title"], manga_id, source.get("name", source["id"]),
                        len(chapters),
                    )
                    return True

        return False

    # ------------------------------------------------------------------
    # Connectivity test
    # ------------------------------------------------------------------

    def test(self) -> None:
        """Raise RequestException if the server is unreachable."""
        resp = self._ssn.get(
            f"{self._base_url}/api/graphql",
            params={"query": "{ __typename }"},
            timeout=5,
        )
        resp.raise_for_status()


def _detect_image_ext(data: bytes) -> str:
    """Guess image extension from magic bytes."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "jpg"
