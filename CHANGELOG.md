# Changelog

All notable changes to this branch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Add poster-first Comics/Manga manage mode hardening with visible card actions, missing indicators, and scoped bulk controls.
- Redesign Home into a premium command center with wanted triage, live operations, failure recovery links, and recent Comics/Manga shelves.
- Begin the premium media-manager redesign with separated Comics and Manga primary navigation, a new Kapowarr Noir default theme, and updated product/design direction.
- Show top-right live task notifications with file-scan progress, completion history, and dismiss controls, including per-file counts such as `Scanning 1/168 Strange Tales`.
- Preserve Discovery and story-arc metadata identity through Add review, with exact volume redirects for existing and newly added titles.
- Report truthful monitored issue health and operational dashboard metrics with actionable filtered destinations.
- Bound selected library mutations to four concurrent requests with partial-failure feedback and validate focused API responses at runtime with Zod.
- Harden Settings with URL-addressable categories, label/help search, accessible fields, validated global Save/Discard controls, unsaved-navigation protection, and explicit restart confirmation.
- Add production-build Playwright, axe, and visual-regression gates at desktop, 390 px, and 320 px widths, with representative light and dark workflow coverage.
- Decompose Settings and Volume Detail into focused category, service-editor, hero, issue, and management components.
- Add truthful server-side library pagination with URL-backed page controls that cap rendered records at 60 per page.
- Add poster-first library controls, responsive volume-detail issue cards, operational dashboard refresh/error states, and safer settings workflows.
- Add shared loading, error, empty, form, status, pagination, focus, motion, and touch-target foundations.
- Add automated UI contract and build-budget checks, with vendor chunking that reduces the main JavaScript bundle from about 584 kB to 162 kB.
- Allow interactive volume and issue searches to use an exact user-supplied source query, with an explicit force-download action for metadata mismatches.
- Speed up large direct downloads with validated four-part HTTP range transfers, per-part retries, and automatic single-stream fallback.

### Fixed
- Fix Volume Detail edits so custom volume-folder saves stay relative to the selected root folder and the Automatic special-version option no longer sends an invalid backend value.
- Make the Discover page search-bar add flow hydrate exact metadata, clear stale search results after success, and show add failures instead of appearing inert.

- Make PWA updates activate without leaving installed mobile clients on stale bundles, and make manual search results readable on tablet/mobile dialogs.
- Remove the redundant Discover add-search label, retain stored Library sort/filter state through primary navigation, show the Issues tab by default on volume pages, and broaden comic Discovery refill/filtering for library-heavy collections.
- Add Discover controls to hide already-library titles, search/add from a bottom bar, and exclude additional manga imprints from comic discovery.
- Keep Discovery add settings in-page, isolate New and Upcoming card identity, preserve the chosen library sort across navigation, and remove the redundant Overview description panel.
- Serve the SPA and PWA safely from the configured reverse-proxy base path, with static-only service-worker caching.
- Replace regex HTML sanitization with DOMPurify, apply restrictive browser security headers, and harden the non-root container runtime.
- Preserve JSON 404 behavior for unknown API paths, retain query strings during legacy UI migration, and return numeric dashboard metrics for empty sections.
- Redact API keys, passwords, and provider tokens from settings and startup logs.
- Replace arbitrary-path unmatched-file deletion with authenticated, volume-scoped opaque identifiers and root containment checks.
- Normalize and validate streamed library-import results so matched folders cannot be classified for unmatched-folder deletion.
- Fix unmatched library-import deletion to send the backend-compatible folder list and keep confirmed paths visible when deletion fails.
- Publish both `develop` and the current application-version container tags with OCI source, version, and revision labels.
- Gate container publication behind the complete backend, frontend, and production-browser matrix, and use the reviewed image in Compose.
- Fix the image and Compose runtime at non-root, Unraid-compatible UID/GID `99:100`, removing ineffective runtime identity environment handling.
- Close directory- and inode-replacement races in unmatched-file deletion, use authoritative file IDs for matched deletion, and label destructive issue controls.
- Fail closed with an explicit API error when safe descriptor-relative unmatched-file deletion is unavailable on the host platform.
- Restrict configurable CORS to API and Socket.IO origins, and require API keys for passwordless state-changing requests while provisioning fresh same-origin SPA clients.
- Parameterize dashboard section queries, bound Recently Added requests, and link mismatch counts to the records that compose them.
- Protect top-level and service-editor Settings drafts across route changes, refreshes, and tab closure without blocking safe category changes.
- Preserve every file during colliding mass renames, keep filesystem and database paths consistent on failures, and record post-processing failures instead of false download successes.
