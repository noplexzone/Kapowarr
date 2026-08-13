import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/routes/changelog/-ui/changelog-page.tsx', 'utf8');
const routerSource = readFileSync('src/app/router.tsx', 'utf8');
const sidebarSource = readFileSync('src/platform/shell/sidebar.tsx', 'utf8');
const systemSource = readFileSync('src/routes/system/-ui/system-status-page.tsx', 'utf8');
const settingsSource = readFileSync('src/routes/settings/-ui/settings-page.tsx', 'utf8');

it('renders changelog as a compact semantic route with current-version context', () => {
  expect(routerSource).toContain("path: 'changelog'");
  expect(routerSource).toContain('changelogQueryOptions');
  expect(source).toContain('<h1 className={styles.title}>Changelog</h1>');
  expect(source).toContain('Installed version');
  expect(source).toContain('Current');
  expect(source).not.toContain('dangerouslySetInnerHTML');
});

it('supports linkable version anchors and direct route loading', () => {
  expect(source).toContain('id={entry.anchor}');
  expect(source).toContain('href={`#${entry.anchor}`}');
  expect(routerSource).toContain('component: ChangelogPage');
});

it('shows empty and error states for malformed or missing packaged changelogs', () => {
  expect(source).toContain('data.error');
  expect(source).toContain('No changelog entries are available in this build.');
  expect(source).toContain('No categorized changes.');
});

it('links visible version and settings about surfaces to changelog', () => {
  expect(sidebarSource).toContain('to="/changelog"');
  expect(sidebarSource).toContain('Kapowarr {about?.version');
  expect(systemSource).toContain('label="Version" value={about.version} to="/changelog"');
  expect(settingsSource).toContain("runtimeConfig.assetUrl('changelog')");
});

it('renders only a bounded safe markdown subset', () => {
  expect(source).toContain('renderSafeMarkdown');
  expect(source).toContain('target="_blank"');
  expect(source).toContain('rel="noopener noreferrer"');
  expect(source).not.toContain('DOMParser');
});
