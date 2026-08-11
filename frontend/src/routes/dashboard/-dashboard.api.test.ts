import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { dashboardActiveSearchesQueryOptions, dashboardHistoryQueryOptions, recentlyAddedQueryOptions } from './-dashboard.api';

beforeEach(() => vi.clearAllMocks());

it('requests and maps a bounded paginated volume list for recently added', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue({
    items: [
      { id: 7, title: 'Saga', year: 2012, publisher: 'Image', issue_count: 10, issues_downloaded: 4 },
    ],
    total: 1,
    offset: 0,
    page_size: 6,
  });

  const result = await recentlyAddedQueryOptions('comic').queryFn!({} as never);

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: 7, title: 'Saga', section: 'comics' });
  expect(apiClient.get).toHaveBeenCalledWith('volumes', {
    searchParams: {
      sort: 'recently_added',
      paginated: 'true',
      offset: '0',
      limit: '6',
    },
  });
});

it('bounds the manga recently-added request and scopes it to manga', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue({ items: [], total: 0, offset: 0, page_size: 6 });

  await recentlyAddedQueryOptions('manga').queryFn!({} as never);

  expect(apiClient.get).toHaveBeenCalledWith('volumes', {
    searchParams: {
      sort: 'recently_added',
      paginated: 'true',
      offset: '0',
      limit: '6',
      section: 'manga',
    },
  });
});

it('maps the legacy history list used by the dashboard', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue([
    { web_title: 'Saga #1', web_sub_title: null, file_title: null, source: 'getcomics', source_name: 'GetComics', downloaded_at: 100, success: true },
  ]);

  const result = await dashboardHistoryQueryOptions().queryFn!({} as never);

  expect(result.total).toBe(1);
  expect(result.entries[0]).toMatchObject({ title: 'Saga #1', downloaded_at: 100_000, state: 'downloaded' });
});


it('filters active search tasks from the system queue for the dashboard', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue([
    { id: 1, action: 'auto_search', display_title: 'Auto Search', status: 'running', volume_title: 'Saga', progress: { processed_count: 2, total_count: 8 } },
    { id: 2, action: 'refresh_and_scan', display_title: 'Refresh', status: 'queued' },
    { id: 3, action: 'search_all', display_title: 'Search All', status: 'queued', progress: { processed_count: 0, total_count: 1200 } },
  ]);

  const result = await dashboardActiveSearchesQueryOptions().queryFn!({} as never);

  expect(apiClient.get).toHaveBeenCalledWith('system/tasks', { timeout: 60_000 });
  expect(result.map((task) => task.action)).toEqual(['auto_search', 'search_all']);
  expect(result[0]).toMatchObject({ volume_title: 'Saga', progress: { processed_count: 2, total_count: 8 } });
});
