# Kapowarr Design System

## Mode

Kapowarr is primarily an **Operate** application with deliberate **Browse** surfaces. Navigation, forms, settings, Activity, and task recovery prioritize clarity and density; Comics, Manga, Discover, Home shelves, and volume artwork prioritize visual recognition.

## Identity

Kapowarr's default identity is a premium dark media-manager interface with comic flavor. It should feel calm, sharp, and trustworthy rather than toy-like: strong cover art, crisp line work, restrained panel-like dividers, clear status colors, and a small number of deliberate accent moments.

The new default theme should be a neutral dark Kapowarr identity rather than a franchise theme. Existing character themes may remain as alternates, but they should only adjust accent and surface tint; they must not alter control sizing, contrast, spacing, or information hierarchy.

## Tokens

Shared CSS custom properties own:

- page, muted, and elevated surfaces
- border and overlay colors
- primary, secondary, strong, and muted text
- accent, success, information, warning, and danger
- focus ring
- spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48px
- typography and content widths
- radii: normally 6–12px
- restrained elevation
- motion duration/easing
- control, touch-target, poster, and navigation dimensions

Do not add externally hosted fonts. Use the system stack.

## Layout

### Desktop

A persistent premium left navigation contains Home, Comics, Manga, Discover, Activity, and Settings. Activity children appear contextually. Main content uses a bounded readable width where appropriate and full-width operational layouts when useful.

### Mobile

A bottom navigation exposes the primary destinations that matter during one-handed use: Home, Comics, Manga, Discover, and Activity. Settings remains reachable through a secondary shell entry or Activity/More pattern. Secondary navigation uses tabs, segmented controls, drawers, or sheets. Respect safe-area insets and reserve page padding so fixed navigation and bulk bars never obscure content.

## Components

Prefer small composable primitives over a universal component. Standardize Button, IconButton, form fields, Checkbox/Radio/Toggle, SegmentedControl, Tabs, Toolbar/FilterBar, StatusBadge, Progress, PosterCard, DataTable, Empty/Error/Skeleton states, Dialog/Drawer/MobileSheet, Toast, Pagination, Breadcrumbs, page heroes, metrics, recovery cards, and BulkActionBar.

Every interactive component supports keyboard use, visible focus, disabled state, accessible naming, relevant loading/error state, themes, and mobile behavior.

## Density and interaction

- Desktop compact controls: 32–36px visible.
- Primary form controls: 36–40px visible.
- Mobile controls: about 40px visible with a 44px target.
- Checkbox/radio indicator: 20–24px inside a 44px transparent target.
- Poster ratio: 2:3.
- Desktop posters: roughly 150–190px; mobile: 115–145px.
- Titles normally clamp to two lines.

Hover may reveal secondary card controls on pointer devices, but mobile never depends on hover. Explicit Manage mode reveals selection controls on poster cards and a sticky/fixed bulk toolbar. Permanent action overlays over covers are not acceptable.

## Volume detail direction

Volume pages should lean toward a Plex/Jellyfin-style media detail surface: large cover, clear title and metadata, completion/monitoring state, a primary CTA, grouped secondary operations, and URL-backed tabs for Issues, Files, History, and Settings. The design must still expose management controls directly and accessibly.

## Motion and feedback

Motion is brief and functional. Honor reduced motion. Keep existing page content during background refresh, use skeletons on first load, show inline refetch progress, delay very fast route fallbacks, and announce async mutation outcomes. Task failures should be findable from Home, Activity, and notifications.

## Accessibility floor

WCAG 2.2 AA behavior: semantic headings/forms/tabs, one `aria-current` destination, named icon buttons, keyboard and focus management, Escape/focus restoration for overlays, adequate contrast, non-color status cues, 44px targets, responsive table alternatives, live status announcements, and no unintended root overflow.

## Avoid

- giant rounded cards or oversized pills
- permanent action overlays over covers
- nested horizontal swipe regions
- decorative gradients/glow/glass
- low-contrast metadata
- icon-only primary actions
- modal-only navigation
- desktop tables squeezed onto phones
- arbitrary local colors, spacing, radii, or shadows outside tokens
- redesigning the reader before the primary media-manager shell and workflows are stable
