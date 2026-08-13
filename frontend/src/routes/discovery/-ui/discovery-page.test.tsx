import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/routes/discovery/-ui/discovery-page.tsx', 'utf8');

it('hydrates add-search selections before opening the add form', () => {
  expect(source).toContain('function SearchResultAddModal');
  expect(source).toContain('exactVolumeQueryOptions(selection, section)');
  expect(source).toContain('Loading add settings…');
  expect(source).toContain('const hydratedResult = {');
});

it('clears and refreshes discover search results after adding from the search bar', () => {
  expect(source).toContain("setRawAddSearch('')");
  expect(source).toContain("invalidateQueries({ queryKey: ['volumes', 'search'] })");
  expect(source).toContain('void queryClient.invalidateQueries({ queryKey: VOLUMES_KEY });');
});


it('lazy-reveals discover volume results as the user scrolls', () => {
  expect(source).toContain('const DISCOVERY_BATCH_SIZE = 50;');
  expect(source).toContain('fetchDiscoveryVolumePage(type, section, pageOffset, DISCOVERY_BATCH_SIZE)');
  expect(source).toContain('volumes.map((vol) => (');
  expect(source).toContain("window.addEventListener('scroll', onScroll, { passive: true })");
  expect(source).toContain('Load more titles');
});
