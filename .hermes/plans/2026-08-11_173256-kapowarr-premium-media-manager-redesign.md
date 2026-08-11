# Kapowarr Premium Media Manager Redesign Implementation Plan

> **For Hermes:** Planning only. Caleb requested no team handoffs; execute directly if/when he approves execution.

**Goal:** Redesign Kapowarr into a premium media-manager UI with comic flavor while preserving current functionality and adding stronger wanted/missing triage, saved filters/smart collections, poster-card bulk operations, mobile/PWA polish, and actionable task recovery.

**Architecture:** Keep the React/Vite/TanStack Router SPA and Flask API. Evolve through vertical, verifiable slices: docs/design truth, routing contracts, premium shell/tokens, Home command center, separated Comics/Manga poster libraries, Plex/Jellyfin-style volume detail, Activity recovery, mobile/PWA polish, then browser/Impeccable acceptance. Backend changes are allowed only where UI correctness needs truthful counts, bounded queries, persisted smart collections, or recovery/action contracts.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, TanStack Router/Query, Zod, CSS Modules, Vitest/Testing Library/MSW, Playwright/axe, Flask/Python, SQLite.

## Global Constraints

- Repo: `/mnt/user/appdata/dev/kapowarr`.
- Frontend: `/mnt/user/appdata/dev/kapowarr/frontend`.
- API: `/mnt/user/appdata/dev/kapowarr/frontend/api.py`.
- Product/design docs: `docs/PRODUCT.md`, `docs/DESIGN.md`.
- New product direction from Caleb:
  - premium media manager with comic flavor;
  - new default identity, not current Batman/gold as the design center;
  - Comics and Manga are separate top-level browse/manage destinations;
  - Home is a hybrid command center;
  - Library behavior is poster-first, with operations through selection actions on poster cards;
  - Volume detail should feel like Plex/Jellyfin where possible;
  - Reader redesign is later; preserve it but do not spend this overhaul on it;
  - include wanted/missing queue triage, saved filters/smart collections, bulk operations, mobile PWA polish, and better task notifications/failure recovery actions;
  - ambitious but safe: frontend-heavy, backend/API only when correctness requires it.
- Preserve existing functionality unless the replacement is real and tested.
- No placeholder buttons, inert actions, fake retry/recovery controls, or decorative controls without backend contracts.
- URL state remains authoritative for route, section, search, sort, filter, view, page, saved collection, tabs, and Activity filters.
- Selection state clears when exact result scope changes.
- Destructive operations require server-authoritative identity, explicit confirmation, bounded execution, partial-failure reporting, and query invalidation.
- Mobile must not rely on nested horizontal scrolling; interactive targets should be at least 44px.
- Verification must include standard gates and Impeccable gates.

## Current Context from Read-Only Inspection

- Planning baseline branch/status: `develop...origin/develop`; clean before plan creation.
- `docs/PRODUCT.md` currently says Comics and Manga are section filters inside shared destinations. This conflicts with the new direction.
- `docs/DESIGN.md` currently centers restrained comic identity and existing yellow/gold accent. It must be revised for the new premium default identity.
- `frontend/src/app/router.tsx` already has `/home`, `/library`, `/discover`, `/activity/*`, `/settings/$category`, `/volumes/$volumeId`, legacy redirects, and route pending/error/not-found components.
- `frontend/src/app/route-search.ts` currently models Library/Discover through `section: comic | manga` search params.
- `frontend/src/platform/shell/sidebar.tsx` currently renders `PRIMARY_NAV`; inspect `frontend/src/platform/shell/navigation.ts` during execution.
- `frontend/package.json` already includes Vitest, Playwright, axe, MSW, and `build:check`.
- PWA runtime hooks exist in `frontend/src/app/runtime-config.ts`; polish the existing path instead of adding a second PWA system.

---

## Target Product Shape

### Information Architecture

Visible primary navigation:

1. **Home** — hybrid command center: health, failures/recoveries, active downloads/searches, recent additions, wanted/missing triage, smart collection shortcuts.
2. **Comics** — poster-first comic library, saved views, card selection, bulk Manage mode.
3. **Manga** — poster-first manga library, saved views, card selection, bulk Manage mode, manga-source cues where existing contracts support them.
4. **Discover** — add/search discovery with Comics/Manga segmented or routed inside the flow.
5. **Activity** — Queue, History, Search History, Mismatches, Imports, Blocklist, failure recovery.
6. **Settings** — operational settings.

Compatibility redirects should preserve `/library?section=comic|manga`, older `/comics`/`/manga` query styles, and any existing deep links.

### Visual Identity

- Premium media manager: dark, calm, high-contrast, art-led, efficient.
- Comic flavor: strong cover art, crisp panel-like dividers, restrained accent, status clarity.
- New default theme: create a neutral dark “Kapowarr Noir” / equivalent. Existing character themes remain optional alternates after contrast review.
- Avoid glass/neon/glow, giant pills, permanent action overlays, decorative motion, modal-only navigation, and icon-only primary actions.

---

## Phase 0 — Design Truth, Compatibility Envelope, Impeccable Baseline

### Task 0.1: Update Product and Design Docs

**Objective:** Make durable docs match Caleb’s updated direction before code changes.

**Files:**
- `docs/PRODUCT.md`
- `docs/DESIGN.md`

**Steps:**
1. Replace canonical IA with Home / Comics / Manga / Discover / Activity / Settings.
2. State that Comics and Manga are separate destinations; shared components are implementation detail.
3. Add Home command-center responsibilities.
4. Update identity to “premium media manager with comic flavor.”
5. Define the new default theme direction and keep Operate/Browse distinction.

**Verify:**
```bash
git -c safe.directory=/mnt/user/appdata/dev/kapowarr -C /mnt/user/appdata/dev/kapowarr diff -- docs/PRODUCT.md docs/DESIGN.md
```

### Task 0.2: Confirm Impeccable Baseline

**Objective:** Make the design detector available and record the integration state.

**Files:**
- `.impeccable/config.json` if installed
- `.gitignore` if ephemeral Impeccable paths must be ignored

**Steps:**
1. Run:
   ```bash
   node --version
   npx --yes impeccable --version
   ```
2. If Node is `>=22.18.0` and project integration is absent, run:
   ```bash
   npx impeccable install --scope=project --providers=claude,codex
   ```
3. Inspect diff. Keep shared artifacts; ignore ephemeral screenshots/cache/live sessions.
4. If Node is too old, record detector-only fallback and do not fake results.

**Verify:**
```bash
npx --yes impeccable detect frontend/src
```

### Task 0.3: Write Action Census

**Objective:** Prevent the redesign from dropping existing functionality.

**Create:** `docs/plans/kapowarr-redesign-action-census.md`

**Steps:**
1. Inventory visible actions in Home/Dashboard, Comics/Manga library, Discover/Add, Volume detail, Activity routes, Settings.
2. For each action record: label, component, handler, API helper, endpoint, pending state, success reconciliation, error state, destructive confirmation.
3. Mark each as keep/redesign/remove-only-if-replaced/backend-contract-needed.

**Verify:** every principal route has entries and every visible state-changing control has a real API path or is marked for removal until implemented.

---

## Phase 1 — Separate Comics and Manga Routing

### Task 1.1: Split Visible Routes

**Objective:** Make Comics and Manga separate top-level destinations while preserving shared implementation.

**Files:**
- `frontend/src/app/router.tsx`
- `frontend/src/app/route-search.ts`
- `frontend/src/app/route-search.test.ts`
- `frontend/src/platform/shell/navigation.ts`
- `frontend/src/platform/shell/sidebar.tsx`
- `frontend/src/platform/shell/mobile-navigation.tsx`

**Design:**
- `/comics` is canonical comic library.
- `/manga` is canonical manga library.
- `/library` becomes compatibility redirect to section-specific route.
- Shared `ComicsPage` can remain temporarily; renaming is cleanup, not a blocker.

**Steps:**
1. Add a sectionless media-library search schema with `view`, `q`, `status`, `monitoring`, `sort`, `page`, optional `collection`.
2. Keep helpers that map route search to backend `VolumesSearch`.
3. Render `<ComicsPage section="comic" canonical />` at `/comics`.
4. Render `<ComicsPage section="manga" canonical />` at `/manga`.
5. Redirect `/library?section=comic` to `/comics` and `/library?section=manga` to `/manga`, preserving query.
6. Update primary nav and mobile nav.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- route-search sidebar --run
npx tsc -b --noEmit
```

### Task 1.2: Preserve Legacy Deep Links

**Objective:** Existing URLs continue to work.

**Files:** same as Task 1.1.

**Tests to add:**
- `/library?section=comic&q=batman&page=2` -> `/comics?q=batman&page=2`.
- `/library?section=manga&status=missing` -> `/manga?status=missing`.
- legacy `/comics?search=x&offset=1&view=posters` parses as page 2 grid.
- legacy `/manga?filter=wanted` parses as missing status.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- route-search --run
npx tsc -b --noEmit
```

---

## Phase 2 — Premium Design Foundation

### Task 2.1: New Default Theme Tokens

**Objective:** Add the new premium default theme without breaking alternate themes.

**Files:**
- `frontend/src/index.css`
- `frontend/src/platform/shell/store.ts`
- theme option declarations wherever currently defined

**Token direction:**
```css
[data-theme='kapowarr-noir'] {
  --surface: #0d1117;
  --surface-raised: #151b23;
  --surface-muted: #1f2630;
  --text-strong: #f1f5f9;
  --text: #cbd5e1;
  --text-dim: #8b98a8;
  --accent: #e2b84b;
  --accent-rgb: 226, 184, 75;
  --accent-text: #111827;
  --border: #2b3440;
  --success: #4ade80;
  --info: #60a5fa;
  --warning: #f59e0b;
  --danger: #f87171;
}
```

**Steps:**
1. Add new theme tokens.
2. Make it default when no stored theme exists.
3. Preserve existing character themes.
4. Check contrast for buttons, badges, nav, fields, and metadata.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- --run
npx tsc -b --noEmit
npm run build
npx --yes impeccable detect frontend/src
```

### Task 2.2: Shared Premium UI Patterns

**Objective:** Standardize layout and interactions before page rewrites.

**Files:**
- `frontend/src/components/patterns/patterns.tsx`
- `frontend/src/components/patterns/patterns.module.css`
- `frontend/src/components/primitives/interaction.tsx`
- `frontend/src/components/primitives/interaction.module.css`
- tests under `frontend/src/components/**`

**Components/patterns:** `PageHero`, `SectionHeader`, `Toolbar`, `FilterBar`, `SegmentedControl`, `PosterCardShell`, `BulkActionBar`, `CommandCard`, `RecoveryActionCard`, `SmartCollectionChip`, `MobileSheet` only if Dialog cannot handle mobile.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- patterns interaction --run
npx tsc -b --noEmit
```

### Task 2.3: Premium Shell Navigation

**Objective:** Redesign desktop and mobile shell for Home / Comics / Manga / Discover / Activity / Settings.

**Files:**
- `frontend/src/platform/shell/sidebar.tsx`
- `frontend/src/platform/shell/sidebar.module.css`
- `frontend/src/platform/shell/mobile-navigation.tsx`
- `frontend/src/platform/shell/mobile-navigation.module.css`
- `frontend/src/platform/shell/page-shell.tsx`
- `frontend/src/platform/shell/page-shell.module.css`
- `frontend/src/platform/shell/navigation.ts`
- shell tests

**Behavior:**
- Desktop left nav feels media-manager-grade, not admin-template.
- Comics/Manga are separate primary items.
- Mobile bottom nav exposes Home, Comics, Manga, Discover, Activity; Settings available through More or shell secondary entry.
- Activity badges only show real counts from existing or newly added APIs.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- sidebar --run
npx tsc -b --noEmit
npm run build
```

---

## Phase 3 — Home Hybrid Command Center

### Task 3.1: Bounded Home Data Contract

**Objective:** Make Home powerful without client-side full-library slicing.

**Files:**
- `frontend/api.py`
- backend helper files if existing dashboard endpoints are insufficient
- `frontend/src/routes/dashboard/-dashboard.api.ts`
- `frontend/src/routes/dashboard/-dashboard.types.ts`
- `tests/Tbackend/test_dashboard_home.py`

**Contract shape:**
```ts
interface HomeCommandCenter {
  stats: { comics: SectionHealth; manga: SectionHealth; failed_downloads: number; active_downloads: number; active_searches: number };
  triage: { missing_comics: TriageItem[]; missing_manga: TriageItem[]; failed_recent: FailureItem[]; recoverable: RecoveryItem[] };
  recent: { comics: RecentVolume[]; manga: RecentVolume[] };
  queue: QueueSummaryItem[];
  searches: ActiveSearchItem[];
  smart_collections: SmartCollectionSummary[];
}
```

**Steps:**
1. Reuse existing bounded dashboard endpoints where sufficient.
2. Add a consolidated endpoint only if it reduces duplicate waterfalls and remains compatible.
3. Cap server-side lists, e.g. 6 triage items/lane, 6 queue items, 6 recent/section.
4. Test truthful counts and bounded list lengths.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr
python3 -m py_compile frontend/api.py
python -m unittest discover -s ./tests -p '*.py'
```

### Task 3.2: Redesign Home Page

**Objective:** Replace “Dashboard” with a hybrid command center.

**Files:**
- `frontend/src/routes/dashboard/-ui/dashboard-page.tsx`
- `frontend/src/routes/dashboard/-ui/dashboard-page.module.css`
- `frontend/src/routes/dashboard/-ui/dashboard-page.test.tsx`

**Layout:**
1. Hero strip: health summary, active work, failed/recoverable count, primary actions.
2. Triage lanes: Missing Comics, Missing Manga, Failed/Recoverable, Active Queue.
3. Poster shelves: Recently Added Comics and Manga.
4. Smart collection shortcuts.
5. Activity/search strip.

**Rules:** retry button only if real retry endpoint exists; otherwise use “Open Activity”, “View details”, or “Open queue”.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- dashboard --run
npx tsc -b --noEmit
npm run build
```

---

## Phase 4 — Poster-First Comics and Manga Libraries

### Task 4.1: Poster Card Selection Operations

**Objective:** Move library operations onto poster cards and Manage mode.

**Files:**
- `frontend/src/routes/comics/-ui/comic-card.tsx`
- `frontend/src/routes/comics/-ui/comic-card.module.css`
- `frontend/src/routes/comics/-ui/comic-card.test.tsx`
- `frontend/src/routes/comics/-ui/comics-page.tsx`
- `frontend/src/routes/comics/-ui/comics-page.module.css`

**Card behavior:**
- Default: cover, title, year/publisher, status strip, missing/upcoming/monitored indicators, primary open action.
- Hover/focus on pointer devices: secondary actions.
- Manage mode: visible checkbox/selection target on each poster card and sticky/fixed bulk action bar.
- Mobile: explicit selection controls, no hover dependency.

**Props to add:** `manageMode`, `selected`, `onToggleSelected`, `pendingAction`, `actions`.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- comic-card comics-page --run
npx tsc -b --noEmit
```

### Task 4.2: Saved Filters / Smart Collections

**Objective:** Let users persist useful filtered views for Comics and Manga.

**Files:**
- `frontend/api.py`
- `backend/internals/db.py` and migration files if persistence is added
- `frontend/src/app/route-search.ts`
- `frontend/src/routes/comics/-comics.api.ts`
- `frontend/src/routes/comics/-comics.types.ts`
- `frontend/src/routes/comics/-ui/comics-page.tsx`
- backend/frontend tests

**Preferred persistence:** SQLite-backed saved filters, not localStorage-only.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS saved_filters(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK(section IN ('comic', 'manga')),
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(section, name)
);
```

**API:**
- `GET /api/savedfilters?section=comic|manga`
- `POST /api/savedfilters` `{section,name,query}`
- `PUT /api/savedfilters/<id>` `{name?,query?}`
- `DELETE /api/savedfilters/<id>`

**Tests:** create/list/update/delete, section isolation, duplicate names, malformed query JSON, API envelope parsing, destructive confirmation.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr
python3 -m py_compile frontend/api.py backend/internals/db.py
python -m unittest discover -s ./tests -p '*.py'
cd frontend
npm test -- comics-page --run
npx tsc -b --noEmit
npm run build
```

### Task 4.3: Wanted/Missing Queue Triage

**Objective:** Make missing/wanted work clear and actionable from Home and library cards.

**Files:**
- `frontend/src/routes/comics/-ui/comics-page.tsx`
- `frontend/src/routes/comics/-ui/comic-card.tsx`
- `frontend/src/routes/comics/-comics.api.ts`
- backend only if bounded missing counts/action contracts are missing

**Behavior:**
- Missing/Wanted is first-class with count and clear action.
- Poster cards show missing issue count and “Search missing” when applicable.
- Bulk toolbar supports “Search missing for selected” and “Refresh & scan selected”.
- Partial failure links to Activity/Search History.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- comics-page comic-card --run
npx tsc -b --noEmit
```

---

## Phase 5 — Plex/Jellyfin-Style Volume Detail

### Task 5.1: URL-Backed Detail Tabs

**Objective:** Make volume tabs routable and stable.

**Files:**
- `frontend/src/app/router.tsx`
- `frontend/src/routes/volumes/-ui/volume-detail-page.tsx`
- `frontend/src/routes/volumes/-ui/volume-detail-page.test.tsx`

**Tabs:** `/volumes/$volumeId/issues`, `/files`, `/history`, `/settings`; default route renders or redirects to Issues.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- volume-detail --run
npx tsc -b --noEmit
```

### Task 5.2: Media Detail Hero

**Objective:** Make the detail page feel like Plex/Jellyfin while retaining management controls.

**Files:**
- `frontend/src/routes/volumes/-ui/volume-hero.tsx`
- `frontend/src/routes/volumes/-ui/volume-detail-page.module.css`
- route tests

**Hero content:** large cover, title, year, publisher, section, volume number, monitored state, completion/missing count, latest issue cues, primary CTA, secondary action cluster.

**Primary CTA examples:** Search Missing, Read, Manage Issues depending current state.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- volume-detail volume-hero --run
npx tsc -b --noEmit
```

### Task 5.3: Decompose Detail Sections

**Objective:** Keep the route maintainable.

**Files:**
- `frontend/src/routes/volumes/-ui/volume-detail-page.tsx`
- `issues-section.tsx`
- `files-section.tsx`
- `history-section.tsx`
- `settings-section.tsx`
- existing dialogs

**Budgets:** `volume-detail-page.tsx` target <=300 lines; no extracted component >350 lines without reason.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- volume-detail manage-issues --run
npx tsc -b --noEmit
npm run build
```

---

## Phase 6 — Activity, Notifications, Recovery

### Task 6.1: Actionable Task Notification Center

**Objective:** Make notifications useful for failures and recovery.

**Files:**
- `frontend/src/platform/shell/task-notifications.tsx`
- `frontend/src/platform/shell/task-notifications.module.css`
- `frontend/src/platform/shell/task-notifications.test.tsx`

**Behavior:** active tasks, recent completions, failures, volume/issue context, failure reason, Open Activity/View details links; retry only with real backend contract.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- task-notifications --run
npx tsc -b --noEmit
```

### Task 6.2: Activity as Diagnostic Operations

**Objective:** Make Queue/History/Search History/Mismatches/Imports/Blocklist recovery-oriented.

**Files:**
- `frontend/src/routes/activity/queue/-ui/queue-page.tsx`
- `frontend/src/routes/activity/history/-ui/history-page.tsx`
- `frontend/src/routes/activity/search-history/-ui/search-history-page.tsx`
- `frontend/src/routes/activity/blocklist/-ui/blocklist-page.tsx`
- `frontend/src/routes/import/-ui/import-page.tsx`
- `frontend/src/routes/mismatch/-ui/mismatch-page.tsx`

**Behavior:** mobile card layouts, clear progress/phase/cancellation state, volume links, failure details, unblock confirmations, source/search filters only where backend supports them.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- queue history search-history blocklist --run
npx tsc -b --noEmit
npm run build
```

---

## Phase 7 — Discover/Add Polish

### Task 7.1: Align Discover with Separated Media Sections

**Files:**
- `frontend/src/routes/discovery/-ui/discovery-page.tsx`
- `frontend/src/routes/discovery/-ui/discovery-page.module.css`
- `frontend/src/routes/discovery/-discovery.types.ts`

**Behavior:** visible Comics/Manga segment or route-aware section; exact Add review identity; already-added routes to correct destination; premium empty/loading/error states.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- discovery --run
npx tsc -b --noEmit
```

### Task 7.2: Polish Add Review

**Files:**
- `frontend/src/routes/add/-ui/add-page.tsx`
- `frontend/src/routes/add/-ui/add-page.module.css`

**Behavior:** source identity visible, root folder compatibility clear, successful add routes to `/volumes/$volumeId`, errors inline and input-preserving.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- add-page --run
npx tsc -b --noEmit
```

---

## Phase 8 — Mobile PWA Polish

### Task 8.1: Mobile Layout/Safe Area

**Files:** shell CSS, mobile nav CSS, route CSS modules touched by bottom nav/bulk bar.

**Behavior:** bottom nav does not hide content; fixed bulk bars sit above nav; no horizontal overflow at 390px or 320px; safe-area respected.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npx tsc -b --noEmit
npm run build
npm run test:e2e -- --project=chromium
```

### Task 8.2: PWA Update/Install Identity

**Files:**
- `frontend/src/app/runtime-config.ts`
- `frontend/src/app/runtime-config.test.ts`
- `frontend/public/manifest.json` or equivalent
- service worker file if present

**Behavior:** new default theme color/name/icons if assets exist; guarded controller-change reload; URL-base deployment still works; no unsafe authenticated-media caching.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- runtime-config --run
npx tsc -b --noEmit
npm run build
```

---

## Phase 9 — Settings Cleanup

### Task 9.1: Settings as Service Cards

**Files:**
- `frontend/src/routes/settings/-ui/settings-page.tsx`
- `frontend/src/routes/settings/-ui/settings-page.module.css`
- `frontend/src/routes/settings/-ui/settings-service-editors.tsx`
- `frontend/src/routes/settings/-ui/settings-category-panels.tsx`

**Behavior:** URL-backed categories, visible dirty state, no-op saves disabled, exact destructive confirmations, mobile categories usable without horizontal squeeze.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm test -- settings --run
npx tsc -b --noEmit
npm run build
```

---

## Phase 10 — Acceptance and Publication Gate

### Task 10.1: Principal-Flow Browser Coverage

**Files:** Playwright specs/fixtures under existing frontend test path.

**Flows:**
1. Home command center.
2. Comics grid at 1440/768/390/320.
3. Manga grid at 390.
4. Manage mode selection and bulk toolbar.
5. Volume detail hero/tabs.
6. Activity queue/history mobile.
7. Settings mobile.
8. Axe serious/critical violations = 0 on principal routes.

**Verify:**
```bash
cd /mnt/user/appdata/dev/kapowarr/frontend
npm run test:e2e
```

### Task 10.2: Full Gates

Run from clean candidate:
```bash
cd /mnt/user/appdata/dev/kapowarr
python3 -m py_compile frontend/api.py
python -m unittest discover -s ./tests -p '*.py'
cd frontend
npm test -- --run
npx tsc -b --noEmit
npm run build:check
npm run test:e2e
npx --yes impeccable detect frontend/src
```

Expected: all pass; any Impeccable waiver names exact file/rule and product reason.

### Task 10.3: Bounded Visual Verification

1. Build and preview production frontend.
2. Inspect Home, Comics, Manga, Volume detail, Activity, Settings at desktop and mobile widths.
3. Check console errors and failed requests.
4. Fix confirmed defects in one batch; perform one confirmation pass only.

Acceptance:
- No root horizontal overflow on principal routes.
- No nested horizontal scrolling on mobile principal routes.
- Poster grids remain poster-first.
- Bulk bars do not hide content/actions.
- Primary actions have visible text.
- Focus rings are visible.
- Task failures are findable and actionable.
- Reader routes still work and are explicitly deferred for later redesign.

## Risks

1. Separating Comics/Manga reverses current docs/route direction; mitigate with docs first and redirects.
2. Saved filters need persistence; SQLite is preferred if collections should survive browsers/devices.
3. Premium identity can drift decorative; mitigate with Operate/Browse rules and Impeccable.
4. Poster bulk ops are dangerous if selection scope leaks; mitigate with exact scope keys and confirmations.
5. Home can become too busy; keep it triage plus shelves, not every metric.
6. Backend additions must update migrations and `DB_SCHEMA` for fresh installs.
7. Mobile fixed nav/bulk bars can obscure content; prove with Playwright at 320/390px.
8. Reader visual mismatch remains; this is accepted and deferred.

## Definition of Done

- Docs match Caleb’s direction.
- Visible nav separates Comics and Manga.
- Home is a bounded hybrid command center.
- Comics/Manga are poster-first with card selection and bulk operations.
- Saved filters/smart collections exist if implemented and are persisted.
- Wanted/missing triage is clearer from Home and cards.
- Volume detail has media-detail hero and URL-backed tabs.
- Activity/notifications expose failure details and real recovery paths.
- Mobile/PWA layout passes overflow and safe-area checks.
- Reader still works and is deferred.
- Full gates pass: Python compile, unittest discovery, Vitest, `tsc -b --noEmit`, `build:check`, Playwright/axe, Impeccable detect.
