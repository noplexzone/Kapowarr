# Kapowarr SPA Action Census

This census records the main state-changing actions exposed by the redesigned SPA. Each entry names the trigger, backend contract, confirmation behavior, cache/update expectation, and mobile placement expectation.

## Global rules

- Destructive actions name the target and require confirmation when they affect more than one object, remove configured services, delete files/folders, or blocklist content.
- SPA API helpers unwrap `{ error, result }` envelopes with `readJson`, including DELETE calls, so backend failures surface to the page.
- Mutations invalidate the query keys for the affected route or update local state with a truthful server result.
- Mobile layouts keep primary/state-changing actions visible as text buttons with 44px-or-larger touch targets.
- Unsupported retry/recovery actions are not shown.

## Library — Comics/Manga

| Action | Trigger | Backend/API | Confirmation | Update contract | Mobile placement |
| --- | --- | --- | --- | --- | --- |
| Search visible/selected missing | wanted triage and manage toolbar | system task API through library helpers | none; reports partial failures | task/activity invalidation and per-target partial-failure message | poster/action toolbar buttons |
| Monitor/unmonitor selected | manage toolbar | volume update helpers | no broad destructive confirmation; scoped to visible selected IDs | clear/update selection and invalidate library | fixed/visible bulk toolbar |
| Delete selected volumes | manage toolbar | `DELETE /api/volumes/<id>` | exact selected count and visible-page scope | clear selection and invalidate library | bulk toolbar above bottom nav |

## Volume detail

| Action | Trigger | Backend/API | Confirmation | Update contract | Mobile placement |
| --- | --- | --- | --- | --- | --- |
| Search missing / issue search | hero or issue row | system task API | none | task/activity invalidation | visible hero/row text button |
| Manual download / force download | manual search dialogs | issue/volume download endpoints | force action is explicitly labelled | task/activity invalidation and dialog status | dialog actions wrap |
| Blocklist result | manual search dialog | blocklist endpoint | source/result action labelled | invalidates blocklist/activity where applicable | row/card action |
| Edit volume settings | Settings tab/dialog | `PUT /api/volumes/<id>` | restart not applicable; backend errors surfaced | invalidates volume data | dialog footer |
| Delete volume | edit/delete block | `DELETE /api/volumes/<id>` | volume title; extra folder deletion warning when selected | remove volume query and navigate away | dialog delete section |
| Delete matched files | Manage Issues footer | file delete endpoint by backend file ID | exact file and issue count | refresh manual-match data and volume query | sticky dialog footer |
| Delete unmatched files | Manage Issues unmatched section | file ID or volume-scoped unmatched-file ID | all-unmatched delete names count | refresh manual-match data and volume query | inline unmatched-file cards |
| Force match files/issues | Manage Issues | manual match / force-match endpoints | target issue labels visible | refresh manual-match data and volume query | footer/inline buttons |

## Activity diagnostics

| Action | Trigger | Backend/API | Confirmation | Update contract | Mobile placement |
| --- | --- | --- | --- | --- | --- |
| Queue move up/down | Queue row/card | queue move endpoint | none | invalidate queue | text buttons on card |
| Queue remove | Queue row/card | queue delete endpoint | per-item label; no fake retry | invalidate queue | text button |
| Queue remove and blocklist | Queue row/card | queue delete with blocklist flag | title-specific confirmation | invalidate queue/blocklist | text button |
| Queue remove all | Queue header | queue clear endpoint | broad queue confirmation | invalidate queue | header action |
| Blocklist remove entry | Blocklist row/card | `DELETE /api/blocklist/<id>` | entry-specific confirmation modal | invalidate blocklist | card action |
| Blocklist clear all | Blocklist header | clear blocklist endpoint | broad confirmation modal | invalidate blocklist | header action |

## Import and mismatch operations

| Action | Trigger | Backend/API | Confirmation | Update contract | Mobile placement |
| --- | --- | --- | --- | --- | --- |
| Scan staged folders | Import page hero | import scan endpoint | none | replace scan result set | hero action |
| Import selected matches | Import result toolbar | import selected endpoint | selected matched count visible | update success and result state | action cluster above bottom nav |
| Delete unmatched folders | Import delete dialog | unmatched delete endpoint | exact folder list in dialog | remove deleted unmatched folders from result state | dialog footer |
| Scan mismatches | Mismatch page hero | mismatch scan endpoint | none | replace mismatch set | hero action |
| Match mismatch item | Mismatch card/row | mismatch match endpoint | no destructive confirmation; item-specific | remove/fix matched row or refresh result state | card text button |
| Delete selected mismatch folders | Mismatch toolbar/dialog | mismatch delete endpoint | selected folder list/count | remove deleted rows from result state | toolbar/dialog above bottom nav |

## Settings

| Action | Trigger | Backend/API | Confirmation | Update contract | Mobile placement |
| --- | --- | --- | --- | --- | --- |
| Save top-level settings | Settings toolbar | `PUT /api/settings` | restart-causing host/port/url/proxy changes require explicit restart confirmation | update local baseline and invalidate settings | toolbar block, buttons wrap full-width |
| Discard top-level settings | Settings toolbar | local only | none | reset draft to baseline | toolbar button |
| Add/update/test NZB indexer | Indexers card/form | `/api/nzbindexers*` | none for add/update/test | invalidate indexer query; connection test result inline | service-card form |
| Delete NZB indexer | Indexer card | `DELETE /api/nzbindexers/<id>` | indexer name and URL | invalidate indexer query | card action |
| Add/update/test download client | Download Clients card/form | `/api/externalclients*` | none for add/update/test | invalidate client/options queries | service-card form |
| Delete download client | Download-client card | `DELETE /api/externalclients/<id>` | client title and URL | invalidate client query | card action |
| Add/update remote mapping | Remote Path Mappings form | `/api/remotemapping*` | none | invalidate mapping query | service-card form |
| Delete remote mapping | Mapping card | `DELETE /api/remotemapping/<id>` | client name plus remote/local paths | invalidate mapping query | card action |
| Add root folder | Root Folders form | `POST /api/rootfolder` | none | invalidate root-folder query | service-card form |
| Delete root folder config | Root-folder card | `DELETE /api/rootfolder/<id>` | folder path plus note that media files are not deleted | invalidate root-folder query | card action |

## Remaining audit watchpoints

- Every new mutation must add its endpoint and confirmation behavior here.
- Shared action components should preserve visible text labels on mobile.
- Bulk actions must continue to clear hidden selections when route/filter/sort/page scope changes.
- Settings service-editor saves replace only their own query state; top-level dirty drafts must not be lost by child-card mutations.
