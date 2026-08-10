# Changelog

All notable changes to this branch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Add truthful server-side library pagination with URL-backed page controls that cap rendered records at 60 per page.
- Allow interactive volume and issue searches to use an exact user-supplied source query, with an explicit force-download action for metadata mismatches.
- Speed up large direct downloads with validated four-part HTTP range transfers, per-part retries, and automatic single-stream fallback.

### Fixed

- Normalize and validate streamed library-import results so matched folders cannot be classified for unmatched-folder deletion.
- Fix unmatched library-import deletion to send the backend-compatible folder list and keep confirmed paths visible when deletion fails.
- Preserve every file during colliding mass renames, keep filesystem and database paths consistent on failures, and record post-processing failures instead of false download successes.
