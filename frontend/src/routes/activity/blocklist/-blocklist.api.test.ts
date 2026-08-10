import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), delete: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { blocklistQueryOptions } from './-blocklist.api';

beforeEach(() => vi.clearAllMocks());

it('preserves page-number offset and truthful blocklist total', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as never);
  vi.mocked(readJson).mockResolvedValue({ entries: [{ id: 4 }], total: 77, offset: 1, page_size: 50 });
  const result = await blocklistQueryOptions(1).queryFn!({} as never);
  const params = vi.mocked(apiClient.get).mock.calls[0]?.[1]?.searchParams as URLSearchParams;
  expect(params.get('offset')).toBe('1');
  expect(result.total).toBe(77);
});
