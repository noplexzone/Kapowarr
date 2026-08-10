# Kapowarr Product Direction

## Purpose

Kapowarr is both a visual comic and manga library and an automation/operations tool. The interface must serve both jobs without forcing every workflow into the same density or presentation.

## Primary users and jobs

- Browse a personal comics or manga collection through strong cover artwork and useful progress/status cues.
- Add an exact metadata result without losing provider identity or silently falling back to a title search.
- Monitor acquisition, queue, history, imports, mismatches, blocklist, and system health efficiently.
- Manage large libraries through URL-backed filters, compact lists/tables, explicit Manage mode, bulk actions, and recoverable partial failures.
- Configure integrations and media behavior without losing unsaved edits or operational context.

## Canonical information architecture

- Home
- Library
- Discover
- Activity
  - Queue
  - History
  - Mismatches
  - Imports
  - Blocklist
- Settings

Comics and Manga are persistent section filters within shared destinations rather than duplicate navigation trees.

## Experience principles

### Browse surfaces

Poster-first, comfortable, artwork-led, and responsive. Cards expose only essential metadata and do not permanently cover artwork with controls.

### Operate surfaces

Compact, status-rich, keyboard-friendly, and explicit about failures. Tables, lists, filters, bulk actions, progress, queue state, and error details take precedence over decoration.

### Shared behavior

- Internal navigation never reloads the document.
- The application shell remains mounted during ordinary route transitions.
- Meaningful filters, tabs, sorting, view mode, and section state live in validated URL search parameters.
- Ephemeral selection stays local and clears when its result scope changes.
- Destructive operations use server-authoritative identity, confirmation, bounded execution, and truthful partial-failure reporting.
- Authentication, URL-base deployment, direct nested-route loading, Docker/Unraid operation, and Python 3.8 remain supported.

## Non-goals

- Copying another media product.
- A decorative storefront that hides operational failures.
- A large third-party UI framework.
- Glassmorphism, neon gradients, giant cards/pills, or animation that delays work.
- Replacing every interaction with a modal.
- Hiding state or removing functionality to simplify styling.
