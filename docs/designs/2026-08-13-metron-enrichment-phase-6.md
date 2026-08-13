# Metron Enrichment Phase 6 Design and Migration Plan

## Scope and product decisions

Metron is optional Comics-only enrichment. ComicVine remains canonical. Manga/MangaDex behavior is unchanged. ComicVine nonempty scalar values win over Metron. Metron may fill missing scalar fields and may add locally indexed additive enrichment such as characters and genres. Users can save their own Metron API token, test it, run/resume a backfill, refresh/relink/remove a Metron match, and view provider provenance.

## Official Metron API source notes

Source checked before implementation:

- `https://metron.cloud/api/schema/?format=json` and `?format=yaml` returned the current OpenAPI schema with `basicAuth`, `cookieAuth`, and `knoxApiToken` security schemes. `knoxApiToken` is HTTP bearer.
- `https://metron-project.github.io/blog/api-best-practices` documents current operational behavior: DRF pagination with `{count,next,previous,results}`, rate headers `X-RateLimit-Burst-*` and `X-RateLimit-Sustained-*`, `Retry-After`, `modified_gt`, detail conditional requests via `If-Modified-Since` / `Last-Modified`, and error handling for 400/401/403/404/429/5xx.
- The product specification requires bearer-token authentication; implement bearer token using the documented `knoxApiToken` scheme. Do not put tokens in URLs.

## Existing ComicVine metadata flow

- Search/add routes are in `frontend/api.py`:
  - `GET /api/volumes/search` uses `ComicVine().search_volumes()` for ComicVine candidates.
  - `GET /api/volumes/search/exact` hydrates one ComicVine candidate by `metadata_source=comicvine` and `metadata_id`.
  - `POST /api/volumes` with `metadata_source=comicvine` calls `Library.add()`.
- `Library.add()` in `backend/implementations/volumes.py`:
  - rejects duplicate `comicvine_id`;
  - fetches full ComicVine volume via `ComicVine().fetch_volume(comicvine_id)`;
  - inserts canonical scalar data into `volumes` with `metadata_source='comicvine'`, `metadata_id=str(comicvine_id)`, `metadata_language='en'`;
  - inserts cover in `volumes_covers` and issues in `issues`;
  - applies monitor scheme, scans/processes files, optionally enqueues search.
- `refresh_and_scan()` refreshes ComicVine metadata and file state for existing volumes.
- Discover shelves and Browse All currently call ComicVine and deliberately defer Character/Genre filters.

## Current database representation of provider IDs and metadata

- `volumes.comicvine_id` is non-null and remains the canonical comic identity.
- `volumes.metadata_source`, `volumes.metadata_id`, and `volumes.metadata_language` identify the primary metadata source for a volume. For Comics these are ComicVine values; for Manga they may be MangaDex.
- Issues store canonical ComicVine issue IDs in `issues.comicvine_id`.
- No current schema stores secondary provider links, provider cache, per-field provenance, character/genre enrichment, backfill progress, rate state, or Metron match review state.

## Background task conventions

- Tasks inherit `Task` in `backend/features/tasks.py` and define `action`, `display_title`, `category`, `volume_id`, `issue_id`, `run()`.
- `TaskHandler.add()` queues in-memory tasks and runs one queue head at a time in a thread with Flask app context.
- Task history is persisted in `task_history` with task name, timestamps, volume/issue IDs, and JSON `details`.
- Periodic tasks are listed in `task_intervals` and configured from `task_intervals` in settings.
- Existing singleton handling prevents duplicate `update_all` and `search_all`; Metron backfill should also avoid duplicate active jobs.

## Credential-storage conventions

- Public settings in `SettingsValues` are stored in `config`.
- Secret setting names are redacted by `_settings_for_log`, including keys ending in `_token`.
- Public settings masking currently masks auth/proxy/Suwayomi passwords; Metron token must also be masked and not returned after save.
- `credentials` table exists for external service credentials but existing app settings currently store ComicVine and Suwayomi credentials in `config`. Metron token should follow the protected server-side config convention with explicit masking/redaction.

## Migration plan

Forward migrations only. Do not rewrite applied migrations.

1. Add Metron settings to config through `SettingsValues` defaults:
   - `metron_enabled` bool;
   - `metron_api_token` string;
   - `metron_last_successful_connection` int;
   - `metron_last_enrichment_run` int;
   - optional rate/backfill operational status JSON strings.
2. Add provider relationship/cache/index tables:
   - `volume_provider_links(volume_id, provider, external_id, resource_type, match_method, match_confidence, review_status, linked_at, last_successful_enrichment, last_checked)` with uniqueness on `(volume_id, provider, resource_type)` and `(provider, resource_type, external_id)` where appropriate.
   - `provider_cache(provider, resource_type, external_id, payload, etag, last_modified, fetched_at, expires_at)` unique on `(provider, resource_type, external_id)`.
   - normalized enrichment indexes such as `volume_enrichment_terms(volume_id, provider, term_type, external_id, name)` for character/genre browse and filters, indexed by `(term_type, name)` and `(provider, external_id)`.
   - `metron_backfill_state(id, status, total, processed, matched, unmatched, review_required, failed, current_volume_id, rate_limit_paused_until, cancel_requested, started_at, updated_at, completed_at)` for resumable progress.
3. Existing Manga rows are unaffected because enrichment joins target Comics through root folder section and provider rows are added only when `provider='metron'`.
4. Migrations are additive and index-backed; no large row rewrites beyond cheap settings insertion/defaults.

## Merge precedence matrix

| Field type | ComicVine value | Metron value | Result |
| --- | --- | --- | --- |
| title/start year/publisher/issue count/issue numbers/release dates/cover/description | nonempty | any | Keep ComicVine |
| scalar fallback | blank/null | nonempty | Fill from Metron and mark provenance |
| scalar later supplied by ComicVine | nonempty refresh | previous Metron fallback | Replace with ComicVine |
| characters/genres/creators/imprints/alternate titles/identifiers/artwork refs | any | nonempty | Merge additively with source provenance |
| additive apparent duplicates | provider IDs equal | provider IDs equal | Deduplicate |
| additive similar names only | names similar | IDs absent/different | Preserve distinct records |

## Implementation guardrails

- Metron failures must be fail-open: adding or refreshing a ComicVine volume must succeed without Metron.
- Backend validates provider JSON at the Metron boundary and normalizes it into internal types.
- No React render path may call Metron. Discover Character/Genre uses local indexed enrichment only.
- Redact `Authorization` headers and saved token values from logs, API responses, rendered HTML, tests, screenshots, and commits.
