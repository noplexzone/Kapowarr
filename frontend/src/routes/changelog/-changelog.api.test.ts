import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { changelogQueryOptions } from './-changelog.api';

beforeEach(() => vi.clearAllMocks());

it('fetches and validates the structured changelog once per running build', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue({
    current_version: '1.6.0',
    generated_at: '2026-08-13T00:00:00Z',
    error: null,
    entries: [
      { version: 'Unreleased', date: null, anchor: 'unreleased', sections: [{ title: 'Added', items: ['Future entry'] }] },
      { version: '1.6.0', date: '2026-08-12', anchor: '1.6.0', sections: [{ title: 'Fixed', items: ['Safe markdown'] }] },
    ],
  });

  const options = changelogQueryOptions();
  const result = await options.queryFn!({} as never);

  expect(apiClient.get).toHaveBeenCalledWith('changelog');
  expect(options.queryKey).toEqual(['changelog']);
  expect(options.staleTime).toBe(Infinity);
  expect(options.gcTime).toBe(Infinity);
  expect(result.entries[0].version).toBe('Unreleased');
  expect(result.entries[1].date).toBe('2026-08-12');
});
