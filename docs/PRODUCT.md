# Kapowarr Product Direction

## Purpose

Kapowarr is a premium media manager for comics and manga that also serves as an automation and operations console. The interface must make browsing feel artwork-led and calm while keeping acquisition, queue, history, imports, mismatches, blocklist, and settings workflows explicit and recoverable.

## Primary users and jobs

- Browse personal comics and manga libraries through strong cover artwork, useful progress/status cues, and direct volume entry points.
- Manage Comics and Manga as separate top-level media sections while sharing implementation patterns where that keeps behavior consistent.
- Add an exact metadata result without losing provider identity or silently falling back to a title search.
- Triage wanted/missing content, active searches, failed downloads, and recoverable queue states from a hybrid Home command center.
- Manage large libraries through URL-backed filters, poster-card selection actions, bulk actions, and recoverable partial failures.
- Configure integrations and media behavior without losing unsaved edits or operational context.

## Canonical information architecture

- Home
- Comics
- Manga
- Discover
- Activity
  - Queue
  - History
  - Searches
  - Mismatches
  - Imports
  - Blocklist
- Settings

Comics and Manga are separate top-level browse/manage destinations. Shared route components, API helpers, and design patterns are implementation details; the product should not present them as one generic Library with a hidden section filter.

## Home command center

Home combines browse and operate jobs. It should surface library health, wanted/missing triage, active downloads and searches, failed or recoverable work, recent additions. It should link to exact filtered destinations rather than duplicate every management workflow inline.

## Experience principles

### Browse surfaces

Poster-first, comfortable, artwork-led, and responsive. Cards expose essential metadata, status, and direct actions without permanently covering artwork. Pointer hover may reveal secondary controls; mobile uses explicit Manage mode and visible selection targets.

### Operate surfaces

Compact, status-rich, keyboard-friendly, and explicit about failures. Tables, lists, filters, bulk actions, progress, queue state, and error details take precedence over decoration. Wide operational tables become labelled mobile records rather than squeezed desktop tables.

### Shared behavior

- Internal navigation never reloads the document.
- The application shell remains mounted during ordinary route transitions.
- Meaningful filters, tabs, sorting, view mode, saved collection, page, and section state live in validated URL parameters.
- Ephemeral selection stays local and clears when its result scope changes.
- Destructive operations use server-authoritative identity, confirmation, bounded execution, and truthful partial-failure reporting.
- Authentication, URL-base deployment, direct nested-route loading, Docker/Unraid operation, and Python 3.8 remain supported.

## Non-goals

- Copying Plex, Jellyfin, Komga, Kavita, or another media product wholesale.
- A decorative storefront that hides operational failures.
- A large third-party UI framework.
- Glassmorphism, neon gradients, giant cards/pills, or animation that delays work.
- Replacing every interaction with a modal.
- Hiding state or removing functionality to simplify styling.
- Redesigning the reader in this phase; preserve it and improve it later.
