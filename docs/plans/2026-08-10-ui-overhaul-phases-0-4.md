# Kapowarr UI Overhaul Phases 0–4 Implementation Plan

> **For Hermes:** Execute task-by-task with one active writer, stable-commit review gates, and Jarvis-owned verification/publication.

**Goal:** Complete the approved SPA overhaul so large libraries remain fast, every visible action works, media workflows are poster-first/mobile-safe, operations pages support diagnosis and recovery, and acceptance coverage guards regressions.

**Architecture:** Keep Flask, React 19, TanStack Router/Query, and CSS Modules. Repair API/action contracts first; establish semantic shared UI; rebuild Library and Volume Detail; migrate Dashboard/Activity/Settings/navigation; finish with rendered accessibility, responsive, and performance gates. URL search state remains authoritative.

**Tech Stack:** Python/Flask/SQLite, React 19, TypeScript 5.7, Vite 6, Vitest/jsdom, Testing Library, MSW.

## Global constraints

- Canonical repo `/mnt/user/appdata/dev/kapowarr`; implementation worktree `/mnt/user/appdata/dev/_scratch/kapowarr-ui-overhaul`; base `develop`; branch `feat/ui-overhaul-remaining`.
- Preserve current responsive sidebar/drawer and React/TanStack foundation.
- Poster-first browsing with direct overlay controls; no nested horizontal gesture scrolling on mobile.
- Touch targets render at least 44×44px on touch layouts; do not shrink readable base text.
- Every visible action has a verified API path, pending/success/error feedback, duplicate-submission protection, and cache invalidation. Hide actions lacking a safe contract.
- Server pagination uses zero-based page-number `offset`, default/bounded page size 60, and a truthful matching total.
- Settings deletion confirms the exact indexer/client/mapping/root folder. Volume delete preserves files by default.
- API errors remain errors; use `readJson` and never convert failures into valid empty states.
- Validate TypeScript with `npx tsc -b --noEmit`; run the repository's unittest-discovery CI gate.
- Update `CHANGELOG.md` under `Unreleased`.
- Do not restart/modify the live Kapowarr container without Caleb's permission.
- Publish only `noplexzone/kapowarr:develop`, never `latest` or a stable version tag.

## Ownership/gates

Jarvis owns scope, integration, release, and final evidence. The implementer follows TDD and coherent Conventional Commits. An independent reviewer checks specification compliance first, then correctness/security/regressions. Critical/Important findings block progression and route through remediation and re-review.

---

### Task 1 — Truthful paginated library contract

**Files:** `backend/implementations/volumes.py`, `frontend/api.py`, `frontend/src/routes/comics/-comics.api.ts`, `-comics.types.ts`; add `tests/Tbackend/test_volume_pagination.py` and frontend adapter tests.

**Contract:** `GET /api/volumes?...&offset=N&limit=60` returns `{items,total,offset,page_size}` inside the API envelope. Sorting/filter/search/section semantics remain unchanged and deterministically ordered.

**TDD:** Cover first/middle/final pages, section isolation, search/filter totals, invalid bounds, frontend request params/transformation/malformed envelopes. Implement parameterized SQL count/page helpers, bounded API parsing, and typed adapter. Verify focused Python/frontend tests, `py_compile`, typecheck. Commit `feat(library): add truthful volume pagination`.

### Task 2 — Functional library command layer

**Files:** comics API/page/card/modal/CSS; add `comics-page.test.tsx`.

**Contracts:** Update All → `system/tasks {cmd:'update_all'}`; Search All → `{cmd:'search_all'}`; card/selected search → bounded `auto_search` tasks; selected scan → `refresh_and_scan`; monitor toggles → existing volume PUT; delete → exact confirmation then `DELETE volumes/:id?delete_folder=false`. Invalidate list/stats/nav. Remove or route modal actions that cannot work safely in-place.

**TDD:** Every visible action sends the exact request once, disables while pending, announces result, reports partial batch failures, and invalidates. Commit `feat(library): wire library actions`.

### Task 3 — URL pagination and bounded rendering

**Files:** comics page/CSS; create shared `components/pagination/*` and tests.

**Acceptance:** search/filter/sort resets `offset=0`; page controls preserve state; announce `X–Y of total`; a 1,167-item fixture mounts no more than 60 cards/rows. Commit `feat(library): bound rendered volume pages`.

### Task 4 — Global route states and code splitting

**Files:** `frontend/src/app/router.tsx`; create `components/query-state/*` and tests.

**Acceptance:** root/layout pending, retryable error, and not-found surfaces replace blanks. Settings, Volume Detail, Activity, Discovery, and Import are lazy route components without breaking loader/auth contracts. Verify direct navigation and production chunks. Commit `feat(ui): add route states and code splitting`.

### Task 5 — Confirm destructive settings deletes

**Files:** create `components/confirm-dialog/*`; modify settings page; add tests.

**Acceptance:** exact object/path named; mutation waits for confirmation; pending cannot duplicate; failed mutation keeps dialog/context; keyboard/Escape/focus work. Root-folder copy accurately states configuration/media consequences. Commit `fix(settings): confirm destructive deletes`.

### Task 6 — Semantic UI/accessibility foundation

**Files:** global `index.css`, Button primitive; create shared `page-header`, `toolbar`, `form-field`, `toast`, `empty-state`, and `responsive-record` components with tests.

**Acceptance:** semantic spacing/type/control/radius/focus/status tokens; danger/size/loading buttons; associated labels/help/errors; one live toast region; desktop cells transform to mobile definition-list records; global `:focus-visible`, reduced-motion, and 44px touch rules. Migrate representative callers. Commit `feat(ui): establish shared design system`.

### Task 7 — Poster-first Library rebuild

**Files:** comics page/card/table row and CSS/tests.

**Acceptance:** persistent top search; filter chips; cover-dominant cards; legible monitored/missing/progress; named direct search/monitor/overflow actions; deliberate selection mode; no floating obstruction; ≤60 mounted records; no root overflow/nested horizontal interaction at 320/390px. Commit `feat(library): rebuild poster-first browsing`.

### Task 8 — Decompose/rebuild Volume Detail

**Files:** split `volume-detail-page.tsx` into `volume-hero`, `volume-tabs`, `issues-panel`, `files-panel`, `history-panel`; update CSS/tests.

**Acceptance:** state-dependent primary action above fold; secondary actions in overflow; no internal IDs as issue numbers; existing manual search/download/manage/cover workflows preserved by characterization tests; issue rows become mobile cards without horizontal table scrolling. Commit `feat(volumes): rebuild responsive volume workflow`.

### Task 9 — Actionable Dashboard

**Files:** dashboard API/types/page/CSS and tests; backend only if current data cannot support truthful cards.

**Acceptance order:** active queue/failures, missing monitored issues, mismatches, recent downloads, recent additions, totals. Every metric links to a real destination/filter. Repeated activity is grouped. Mobile additions use grid/list, not a horizontal carousel. Commit `feat(dashboard): prioritize actionable library health`.

### Task 10 — Diagnostic Activity

**Files:** queue/history/blocklist API/types/pages/CSS; shared filters/details/tests.

**Acceptance:** search/state/source filters; grouped expandable rows; source/failure/retry detail; real retry/investigate/link actions; danger-styled removals; mobile cards; API timestamps converted from seconds with `*1000`. Commit `feat(activity): add diagnostic recovery views`.

### Task 11 — Split/harden Settings

**Files:** router; decompose settings page under `-ui/sections/`; update CSS/types/API/tests.

**Acceptance:** route-addressable sections; desktop local nav/mobile accordions; associated labels; search by setting; Save disabled when unchanged; visible dirty state; sticky Save/Discard; inline validation/help; restart implications shown before hosting changes; advanced collapsed; confirmed deletes retained. Commit `feat(settings): split and harden configuration`.

### Task 12 — Simplify navigation and Discovery→Add continuity

**Files:** sidebar/router, Discovery/Add API/types/pages/tests.

**Acceptance:** task-based nav without duplicate library destinations; drawer/badges preserved. Discovery Add carries source/id/title to Add review; already-added items open section-aware volume detail. Commit `feat(navigation): simplify media workflows`.

### Task 13 — Acceptance, accessibility, and performance gates

**Files:** frontend test fixtures/config/scripts; `package.json` only for justified pinned dev dependencies; CI only if publish credentials allow workflow edits.

**Coverage:** shared fields/dialogs/toasts/status; route loading/error/empty; pagination/filter/URL and 1,167-item DOM budget; all visible actions; desktop/tablet/390/320 smoke; keyboard/focus/live regions and reliable automated a11y; dark/light evidence; no single route chunk above 500 kB minified and a recorded initial-JS budget. Document real tooling limits rather than fabricate coverage. Commit `test(ui): add overhaul acceptance gates`.

### Task 14 — Whole-branch review, integration, and publication

1. Independent spec/quality reviews; remediate and re-review all Critical/Important findings.
2. Jarvis inspects complete diff for scope/secrets/generated artifacts.
3. Run focused frontend tests, `npx tsc -b --noEmit`, `npm run build`, focused Python tests, and `mkdir -p db && python -m unittest discover -s ./tests -p '*.py'`.
4. Browser-smoke exact production artifact at desktop/390/320, including console, overflow, button geometry, and mounted-record count.
5. Update changelog; clean Conventional Commit history; integrate into `develop`; push.
6. Wait for GitHub Tests and Docker publish; verify registry manifest digest for `noplexzone/kapowarr:develop`.
7. Report literal pull line and label acceptance-ready, not release-ready. Do not restart live Kapowarr.
