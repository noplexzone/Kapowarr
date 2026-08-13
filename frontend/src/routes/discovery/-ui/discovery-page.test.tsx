import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/routes/discovery/-ui/discovery-page.tsx', 'utf8');

it('renders a title-only combobox below the input with keyboard semantics', () => {
  expect(source).toContain('role="combobox"');
  expect(source).toContain('aria-expanded={open}');
  expect(source).toContain('aria-controls={listboxId}');
  expect(source).toContain('aria-activedescendant={activeDescendant}');
  expect(source).toContain('role="listbox"');
  expect(source).toContain('role="option"');
  const css = readFileSync('src/routes/discovery/-ui/discovery-page.module.css', 'utf8');
  expect(css).toContain('top: calc(100% + 0.25rem)');
  expect(css).not.toContain('bottom: calc(100% + 0.5rem)');
});

it('closes suggestions on outside click, escape, and clearing input', () => {
  expect(source).toContain("document.addEventListener('pointerdown', onPointerDown)");
  expect(source).toContain("event.key === 'Escape'");
  expect(source).toContain("event.target.value.trim().length < 2");
});

it('uses Enter and View all to open URL-backed complete results', () => {
  expect(source).toContain("navigate({ to: '/discover/search', search: { section, q: query } })");
  expect(source).toContain('View all results for “{query}”');
});

it('opens highlighted suggestions by exact provider identity', () => {
  expect(source).toContain("to: '/discover/add/$source/$metadataId'");
  expect(source).toContain('params: getAddRouteParams(result)');
  expect(source).toContain('metadata_id ?? String(result.comicvine_id)');
});

it('asks the all-source search endpoint so manga can aggregate MangaDex results', () => {
  expect(source).toContain("searchVolumesQueryOptions(debouncedQuery, section, 'all')");
  expect(source).toContain("searchVolumesPageQueryOptions(query, section, 'all'");
});

it('shows comic issue counts and unknown fallback in search metadata', () => {
  expect(source).toContain("Issue count unavailable");
  expect(source).toContain("`${result.issue_count} issue${result.issue_count === 1 ? '' : 's'}`");
  expect(source).not.toContain('0 issues');
});

it('hydrates exact add selections without generic search fallback', () => {
  expect(source).toContain('export function DiscoverExactAddPage');
  expect(source).toContain('ExactAddReview section={section}');
  expect(source).toContain('metadata_source: source');
  expect(source).toContain('searchFallbackTo="/discover/search"');
});

it('refreshes discover and library queries after adding', () => {
  expect(source).toContain("invalidateQueries({ queryKey: ['discovery'] })");
  expect(source).toContain('void queryClient.invalidateQueries({ queryKey: VOLUMES_KEY });');
});


it('lazy-reveals discover volume results as the user scrolls', () => {
  expect(source).toContain('const DISCOVERY_BATCH_SIZE = 50;');
  expect(source).toContain('fetchDiscoveryVolumePage(type, section, pageOffset, DISCOVERY_BATCH_SIZE)');
  expect(source).toContain('volumes.map((vol) => (');
  expect(source).toContain("window.addEventListener('scroll', onScroll, { passive: true })");
  expect(source).toContain('Load more titles');
});


it('keeps Discover add as title-only rather than publisher or genre modes', () => {
  expect(source).toContain("Add new {section === 'manga' ? 'manga' : 'comics'}");
  expect(source).not.toContain("(['title', 'publisher', 'genre'] as const)");
  expect(source).not.toContain('Search ComicVine by title, publisher, or genre keyword.');
  expect(source).not.toContain('heroRail');
});
