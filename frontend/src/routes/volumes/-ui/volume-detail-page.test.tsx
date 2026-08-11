import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizeVolumeFolderInput, volumeFolderInputValue } from './volume-detail-page';

const source = readFileSync('src/routes/volumes/-ui/volume-detail-page.tsx', 'utf8');

it('only shows Suwayomi bundle search for manga volumes', () => {
  expect(source).toContain("const showSuwayomiBundleSearch = volume.section === 'manga';");
  const bundleSection = source.slice(source.indexOf('Suwayomi Bundle section'));
  expect(bundleSection).toContain('showSuwayomiBundleSearch &&');
});


it('normalizes volume folder edits to a path relative to the selected root folder', () => {
  expect(volumeFolderInputValue('/content/X-Men Annual (1992)', '/content/')).toBe('X-Men Annual (1992)');
  expect(normalizeVolumeFolderInput('content/content/X-Men Annual (1992)', '/content/')).toBe('X-Men Annual (1992)');
  expect(normalizeVolumeFolderInput('  /content/X-Men Annual (1970)  ', '/content/')).toBe('X-Men Annual (1970)');
});
