import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/routes/dashboard/-ui/dashboard-page.tsx', 'utf8');

it('links section mismatch metrics to the records counted by stats', () => {
  expect(source).toContain('label="Comic mismatches"');
  expect(source).toContain('value={summary?.sections.comic.mismatches ?? null}');
  expect(source).toContain('label="Manga mismatches"');
  expect(source).toContain('value={summary?.sections.manga.mismatches ?? null}');
  expect(source).toContain('to="/activity/mismatches"');
  expect(source).not.toContain('label="Unmatched files"');
  expect(source).not.toContain('to="/import"');
});


it('orders live operation sections before history on the dashboard', () => {
  const activeSearches = source.indexOf('Active Searches');
  const activeDownloads = source.indexOf('Active Downloads');
  const recentActivity = source.indexOf('Recent Activity');
  expect(activeSearches).toBeGreaterThan(-1);
  expect(activeDownloads).toBeGreaterThan(activeSearches);
  expect(recentActivity).toBeGreaterThan(activeDownloads);
  expect(source).toContain('dashboardActiveSearchesQueryOptions');
  expect(source).toContain('searchTaskMeta(entry)');
});


it('links active searches view-all to search history outcomes', () => {
  const activeSearches = source.indexOf('Active Searches');
  const activeDownloads = source.indexOf('Active Downloads');
  const activeSearchSection = source.slice(activeSearches, activeDownloads);
  expect(activeSearchSection).toContain('to="/activity/search-history"');
  expect(activeSearchSection).not.toContain('to="/system/tasks"');
});


it('refreshes dashboard data from live operation events', () => {
  expect(source).toContain("useSocketEvent('task_added'");
  expect(source).toContain("useSocketEvent('task_status'");
  expect(source).toContain("useSocketEvent('task_ended'");
  expect(source).toContain("useSocketEvent('queue_added'");
  expect(source).toContain("useSocketEvent('queue_status'");
  expect(source).toContain("useSocketEvent('queue_ended'");
  expect(source).toContain("useSocketEvent('downloaded_status'");
});


it('presents Home as a hybrid command center before shelf rows', () => {
  const hero = source.indexOf('Kapowarr command center');
  const triage = source.indexOf('Missing Issue Triage');
  const liveOps = source.indexOf('Live Operations');
  const shelves = source.indexOf('Recently Added');
  expect(source).toContain('home-command-center-title');
  expect(hero).toBeGreaterThan(-1);
  expect(triage).toBeGreaterThan(hero);
  expect(liveOps).toBeGreaterThan(triage);
  expect(shelves).toBeGreaterThan(liveOps);
});

it('routes command-center triage into separated Comics and Manga libraries', () => {
  expect(source).toContain('to="/library"');
  expect(source).toContain("section: 'manga'");
  expect(source).toContain('Comics missing');
  expect(source).toContain('Manga missing');
  expect(source).not.toContain('to="/comics"');
  expect(source).not.toContain('to="/manga"');
});

it('keeps partial-data resilience and live refresh affordances visible', () => {
  expect(source).toContain('Some Home data could not be loaded');
  expect(source).toContain('Refresh Home');
  expect(source).toContain('Preserve successful sections');
});


it('keeps the desktop dashboard in a compact fit-to-screen layout', () => {
  const styles = readFileSync('src/routes/dashboard/-ui/dashboard-page.module.css', 'utf8');
  expect(styles).toContain('grid-template-areas:');
  expect(styles).toContain('grid-area: dashboard;');
  expect(styles).toContain('grid-template-columns: minmax(0, 1.45fr) minmax(20rem, 0.75fr);');
  expect(styles).toContain('.mainColumn {');
  expect(styles).toContain('.triageCard {\n    grid-template-columns: repeat(2, minmax(0, 1fr));');
  expect(styles).toContain('@media (min-width: 1181px) and (max-height: 860px)');
  expect(styles).toContain('.heroCopy p {\n    display: none;');
  expect(styles).toContain('.operationBlock .listRow:nth-of-type(n + 4)');
  expect(styles).not.toContain('.triageRow:nth-last-child(-n + 2)');
  expect(source).toContain('volumes={(comicRecent ?? []).slice(0, 3)}');
  expect(source).toContain('volumes={(mangaRecent ?? []).slice(0, 3)}');
  expect(styles).toContain('@media (min-width: 1181px) and (max-height: 930px)');
  expect(styles).toContain('aspect-ratio: 2 / 1.55');
  expect(styles).not.toContain('.coverGrid .coverCard:nth-child(n + 4)');
});
