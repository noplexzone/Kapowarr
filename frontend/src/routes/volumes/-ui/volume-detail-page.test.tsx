import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/routes/volumes/-ui/volume-detail-page.tsx', 'utf8');

it('only shows Suwayomi bundle search for manga volumes', () => {
  expect(source).toContain("const showSuwayomiBundleSearch = volume.section === 'manga';");
  const bundleSection = source.slice(source.indexOf('Suwayomi Bundle section'));
  expect(bundleSection).toContain('showSuwayomiBundleSearch &&');
});
