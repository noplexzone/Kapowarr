# Kapowarr Reliability Audit Fixes Implementation Plan

> **For Hermes:** Execute task-by-task with an isolated implementer and independent review before publishing.

**Goal:** Prevent task/download deadlocks and make Suwayomi automation bounded, retryable, diagnosable, and capable of fallback.

**Architecture:** WebSocket delivery becomes bounded best-effort infrastructure that cannot block business threads. System tasks gain singleton admission, cancellation, stale-progress observability, and safe queue cleanup. Suwayomi search preserves raw candidates through bundling and downloads use bounded waits/retries plus structured failures; bulk DB writes are reduced and frontend request budgets are aligned.

**Tech Stack:** Python 3.13, Flask/Waitress, multiprocessing, SQLite/WAL, pytest, TypeScript/ky, Docker/GitHub Actions.

## Global Constraints

- Work only in `/mnt/user/appdata/dev/kapowarr-reliability` on `fix/reliability-audit` based on `develop` commit `c277b0a`.
- Do not modify/restart the running `kapowarr` container during implementation.
- Preserve existing public API compatibility unless a test demonstrates a necessary correction.
- Use TDD, focused commits, sanitized errors, bounded waits, and interruptible cancellation.
- Never let event notification, logging, or progress reporting block task/download execution.
- Final mutable artifact is `noplexzone/kapowarr:develop`; do not publish `latest`.

## Task 1 — Nonblocking events and resilient system-task queue

**Owner:** Light/Claude Code. **Review:** L/Jarvis. **Workspace:** reliability worktree.

**Files:** `backend/internals/server.py`, `backend/implementations/volumes.py`, `backend/features/tasks.py`, `backend/implementations/file_matching.py`, task/WebSocket regression tests.

**Acceptance criteria:**
1. Multiprocess WebSocket publishing uses a bounded nonblocking/coalescing mechanism; dead/missing consumers cannot block callers.
2. Bulk scan records progress before best-effort notification and honors cancellation.
3. `update_all` and `search_all` are singleton actions across queued/running tasks; duplicate interval runs advance their next schedule without queue growth.
4. Queued tasks delete without joining unstarted threads; running cancellable tasks signal stop and use bounded joins.
5. Tasks expose/update `last_progress_at`; stale state is observable and queue cleanup is guaranteed in `finally`.
6. Bulk scans skip per-volume global unmatched-file cleanup and run it once after the pool.
7. Existing and new focused tests pass, including a blocked event publisher test and concurrent duplicate admission test.

## Task 2 — Correct Suwayomi search, retry, and fallback automation

**Owner:** Light/Claude Code after Task 1 stable commit. **Review:** L/Jarvis.

**Files:** `backend/features/search.py`, `backend/features/tasks.py`, `backend/features/download_queue.py`, Suwayomi search/bundle tests.

**Acceptance criteria:**
1. TPB/VAI volume auto-search retains individual Suwayomi chapter candidates until bundling completes, while user-facing results remain filtered.
2. Alternate titles are searched when the primary produces no matched/complete candidate, not only when it returns zero raw results.
3. Failed Suwayomi issue and TPB/volume downloads use capped retries then exclude the failed source/link and fall back to the next viable candidate without loops or duplicates.
4. Repeated formatted queries share one bounded Suwayomi library/source pass where practical, with source errors isolated.
5. End-to-end mocked regression tests prove bundling, alternate-title recovery, and Suwayomi-to-Usenet/GetComics fallback.

## Task 3 — Bound Suwayomi execution and persist actionable failures

**Owner:** Light/Claude Code after Task 2. **Review:** L/Jarvis.

**Files:** `backend/implementations/suwayomi.py`, `backend/implementations/download_clients.py`, `backend/features/post_processing.py`, related models/tests.

**Acceptance criteria:**
1. `wait_for_download()` uses monotonic deadlines, terminal upstream-state detection, typed outcomes, and `stop_event.wait()`.
2. CBZ and PDF page fetches share bounded retry/backoff for network, 429, and 5xx failures; ordinary 4xx fail immediately; partial output is cleaned.
3. PDF conversion/merge runs in a spawn-safe killable worker boundary with hard timeout and cancellation; timeout/cancellation cannot report success.
4. Download objects retain a sanitized structured failure reason including stage, status/type, identifiers, and attempts; history no longer hard-codes `Download failed` when a cause exists.
5. Regression tests cover never-completing downloads, cancellation, transient success, non-retryable 404, conversion hangs, cleanup, and distinct history reasons.

## Task 4 — SQLite admission resilience, frontend timeouts, and test discovery

**Owner:** Light/Claude Code after Task 3. **Review:** L/Jarvis.

**Files:** `backend/features/tasks.py`, `backend/features/download_queue.py`, `frontend/src/routes/volumes/-volumes.api.ts`, rename dormant test modules, CI/test configuration if needed.

**Acceptance criteria:**
1. Manual history/queue admission retries only `SQLITE_BUSY/locked` with bounded jitter and cannot leave orphan/misleading rows.
2. Direct issue/volume frontend requests use an explicit timeout above the backend admission bound.
3. `search_all_progress.py` and `task_resilience.py` become normally collected tests; stale UpdateAll assertions are corrected and unawaited coroutine warnings removed.
4. Focused lock-contention and exactly-once tests pass.

## Task 5 — Integration, review, and acceptance artifact

**Owner:** Jarvis. **Prerequisite:** Tasks 1–4 approved.

1. Inspect the complete commit range and run `git diff --check`.
2. Run the project’s configured backend test suite and frontend build from `.github/workflows/tests.yml`.
3. Build the Docker image and fresh-state smoke test it without touching the running deployment.
4. Independent whole-branch spec and quality review; route critical/important findings through one remediation wave.
5. Push the verified branch, integrate to `develop`, verify CI, publish only `noplexzone/kapowarr:develop`, and report digest/pull line as acceptance-ready.
