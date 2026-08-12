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


it('refreshes the volume detail cache when this volume refresh scan task ends', () => {
  expect(source).toContain("useSocketEvent<TaskEndedPayload>('task_ended'");
  expect(source).toContain("payload.action !== 'refresh_and_scan'");
  expect(source).toContain('payload.volume_id !== id');
  expect(source).toContain('queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) })');
  expect(source).toContain("setActionMsg(payload.message || 'Refresh & Scan completed.');");
});
