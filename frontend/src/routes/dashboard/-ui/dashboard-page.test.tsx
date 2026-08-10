import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/routes/dashboard/-ui/dashboard-page.tsx', 'utf8');

it('links section mismatch metrics to the records counted by stats', () => {
  expect(source).toContain('label="Comic mismatches"');
  expect(source).toContain('value={comicStats?.mismatches ?? null}');
  expect(source).toContain('label="Manga mismatches"');
  expect(source).toContain('value={mangaStats?.mismatches ?? null}');
  expect(source).toContain('to="/activity/mismatches"');
  expect(source).not.toContain('label="Unmatched files"');
  expect(source).not.toContain('to="/import"');
});
