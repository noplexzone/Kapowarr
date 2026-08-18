# Changelog

All notable changes to this branch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Add runtime integrity conflict storage for strict one-to-one issue-file matching, duplicate/range conflict capture, and Punisher/Crisis regression fixtures.
- Make Dashboard summary responses include safe timing, stale/error metadata, and isolated metric-group fallbacks.
- Make Metron connection testing support current draft tokens without persisting or logging them.
- Make Discover the canonical search-and-add surface with a title-only accessible combobox, paginated `/discover/search`, and exact `/discover/add/<source>/<metadata-id>` review routes.

### Changed

- Enforce final library issue-file mappings with unique active file and issue constraints, withholding range and duplicate candidates from active mappings.
- Stop final issue renames from preserving destination collisions by appending `(1)`, `(2)`, and related suffixes.
- Classify Shinchosha as a Manga publisher so reported Manga titles are excluded from Comic discovery surfaces.
- Recover interrupted Metron schema normalization safely, keep backups until validation succeeds, and log deterministic merge counts.
- Preserve Discover exact Add return state through typed router destinations instead of browser-history guesses.
- Derive Recently Started and Upcoming Launches from ComicVine first-known issue data instead of volume start-year/date-added approximations.
- Add durable Metron enrichment task reservations so candidate selection and queued work have a single active owner per volume.
- Apply Monitor Missing with the shared valid-file predicate so missing issues become monitored and downloaded issues are unmonitored.
- Mark MangaDex decade Browse responses as bounded with unknown totals and no false pagination.
- Apply Hide in Library on server-side provider IDs for Discover shelves, Browse, and full search.
- Redirect legacy Add URLs into Discover and return paginated metadata-search envelopes for full result pages while keeping legacy search callers compatible.

### Removed

- Remove obsolete visible page headers, Library attention banner, Saved Views, Story Arcs, and the generic Add/search page while preserving Discover exact Add review.

## [1.6.0] - 2026-08-12

### Added

- Add bulk matching for selected unmatched files in the Volume Detail Manage Issues dialog.
- Add direct multi-file import from Volume Detail pages.
- Move Home operations into the main dashboard column so shelves no longer create dead space under metric cards.
- Limit Home recently-added shelves to one row per section and tighten the desktop fit for Caleb-sized browser viewports.
- Compact the desktop Home dashboard so command metrics, operations, and recent shelves fit above the fold.
- Add authenticated artwork-banner treatment to the Volume Detail hero header.
- Finish the redesign implementation cleanup with extracted Volume Detail file/history/settings panels and shared premium section/action patterns.
- Add Phase 10 principal-flow browser coverage for Home, Comics/Manga separation, poster manage mode, volume detail/files, Activity, Settings, and the deferred Reader route.
- Redesign Settings as premium service-card configuration with active-category summaries, descriptive category cards, dirty draft markers, and mobile-safe action wrapping.
- Add a SPA action census documenting mutating actions, confirmations, cache updates, and mobile placement expectations.
- Polish mobile/PWA shell identity with a six-destination safe-area bottom nav and Kapowarr Noir install colors.
- Redesign Import and Mismatch review into diagnostic operational surfaces with mobile-safe cards and clearer scan summaries.
- Polish Discover and Add flows with premium command surfaces, clearer metadata context, and mobile-safe add/search actions.
- Extend Activity diagnostics across History, Search History, and Blocklist with mobile-safe cards, source context, failure details, and visible recovery actions.
- Redesign Activity Queue into a diagnostic operations surface with mobile cards, clearer progress, and visible action labels.
- Make task notifications more actionable with contextual links, retained failure details, and safer mobile positioning.
- Add a Plex-style volume detail hero with completion stats, contextual primary actions, and a URL-backed Settings tab.
- Add Comics/Manga wanted triage controls for visible missing volumes and selected missing-volume searches.
- Add persisted Comics/Manga smart filters so saved library views survive across browsers and devices.
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
- Refresh Volume Detail from task completion, downloaded-status events, and task polling fallbacks after refresh/import work completes.
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
