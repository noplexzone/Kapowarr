import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), delete: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { historyQueryOptions } from './-history.api';

beforeEach(() => vi.clearAllMocks());

it('preserves page-number offset and truthful history total', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as never);
  vi.mocked(readJson).mockResolvedValue({
    entries: [{ web_link: '', web_title: 'Saga', web_sub_title: null, file_title: null, volume_id: 1, issue_id: 2, source: 'getcomics', source_name: 'GetComics', downloaded_at: 100, success: true }],
    total: 151,
    offset: 2,
    page_size: 50,
  });
  const result = await historyQueryOptions(2).queryFn!({} as never);
  const params = vi.mocked(apiClient.get).mock.calls[0]?.[1]?.searchParams as URLSearchParams;
  expect(params.get('offset')).toBe('2');
  expect(result.total).toBe(151);
  expect(result.entries[0]?.downloaded_at).toBe(100_000);
});
