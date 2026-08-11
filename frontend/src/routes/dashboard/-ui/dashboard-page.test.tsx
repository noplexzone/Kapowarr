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
