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
