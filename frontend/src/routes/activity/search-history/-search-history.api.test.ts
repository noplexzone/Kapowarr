import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { searchHistoryQueryOptions } from './-search-history.api';

beforeEach(() => vi.clearAllMocks());

it('requests paginated search task history with a long timeout', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as never);
  vi.mocked(readJson).mockResolvedValue({
    entries: [],
    total: 0,
    offset: 2,
    page_size: 15,
  });

  await searchHistoryQueryOptions(2).queryFn!({} as never);

  expect(apiClient.get).toHaveBeenCalledWith('system/tasks/history', {
    searchParams: new URLSearchParams({ offset: '2', paginated: 'true', type: 'search' }),
    timeout: 60_000,
  });
});

it('classifies found-but-unmatched searches as no matches', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as never);
  vi.mocked(readJson).mockResolvedValue({
    entries: [{
      task_name: 'auto_search',
      display_title: 'Auto Search',
      run_at: 100,
      queued_at: 90,
      started_at: 95,
      volume_id: 1,
      volume_title: 'Saga',
      issue_id: null,
      issue_number: null,
      details: {
        total_found: 8,
        per_issue: [{ issue_number: '1', matched: false, display_title: 'Bad candidate', source: 'GetComics' }],
        downloads: [],
      },
    }],
    total: 1,
    offset: 0,
    page_size: 15,
  });

  const result = await searchHistoryQueryOptions(0).queryFn!({} as never);

  expect(result.entries[0]?.outcome).toBe('no_match');
  expect(result.entries[0]?.outcome_label).toBe('No matches');
  expect(result.entries[0]?.message).toBe('8 results found, but none matched');
});
