# Kapowarr Design System

## Mode

Kapowarr is primarily an **Operate** application with deliberate **Browse** surfaces. Navigation, forms, settings, and activity prioritize clarity and density; Library, Discover, Home shelves, and volume artwork prioritize visual recognition.

## Identity

Kapowarr retains a restrained comic-inspired identity through strong cover art, the existing yellow/gold accent, clear line work, and consistent status colors. Franchise themes may adjust accent and surface tint only; they do not alter control sizing, contrast, spacing, or information hierarchy.

## Tokens

Shared CSS custom properties own:

- page and elevated surfaces
- border and overlay colors
- primary, secondary, and muted text
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

A persistent compact left navigation contains Home, Library, Discover, Activity, and Settings. Activity children appear contextually rather than duplicating Comics/Manga trees. Main content uses a bounded readable width where appropriate and full-width operational tables when useful.

### Mobile

A bottom navigation exposes Home, Library, Discover, Activity, and More/Settings. Secondary navigation uses tabs, segmented controls, drawers, or sheets. Respect safe-area insets and reserve page padding so fixed navigation and bulk bars never obscure content.

## Components

Prefer small composable primitives over a universal component. Standardize Button, IconButton, form fields, Checkbox/Radio/Toggle, SegmentedControl, Tabs, Toolbar/FilterBar, StatusBadge, Progress, PosterCard, DataTable, Empty/Error/Skeleton states, Dialog/Drawer/MobileSheet, Toast, Pagination, Breadcrumbs, headers, metrics, and BulkActionBar.

Every interactive component supports keyboard use, visible focus, disabled state, accessible naming, relevant loading/error state, themes, and mobile behavior.

## Density and interaction

- Desktop compact controls: 32–36px visible.
- Primary form controls: 36–40px visible.
- Mobile controls: about 40px visible with a 44px target.
- Checkbox/radio indicator: 20–24px inside a 44px transparent target.
- Poster ratio: 2:3.
- Desktop posters: roughly 150–190px; mobile: 115–145px.
- Titles normally clamp to two lines.

Hover may reveal secondary card controls on pointer devices, but mobile never depends on hover. Explicit Manage mode reveals selection controls and a sticky bulk toolbar.

## Motion and feedback

Motion is brief and functional. Honor reduced motion. Keep existing page content during background refresh, use skeletons on first load, show inline refetch progress, delay very fast route fallbacks, and announce async mutation outcomes.

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
