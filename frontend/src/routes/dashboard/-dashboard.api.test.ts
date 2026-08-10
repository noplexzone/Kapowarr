import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { dashboardHistoryQueryOptions, recentlyAddedQueryOptions } from './-dashboard.api';

beforeEach(() => vi.clearAllMocks());

it('maps the legacy volume list used by recently added', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue([
    { id: 7, title: 'Saga', year: 2012, publisher: 'Image', issue_count: 10, issues_downloaded: 4 },
  ]);

  const result = await recentlyAddedQueryOptions('comic').queryFn!({} as never);

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: 7, title: 'Saga', section: 'comics' });
  expect(apiClient.get).toHaveBeenCalledWith('volumes', {
    searchParams: { sort: 'recently_added' },
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
