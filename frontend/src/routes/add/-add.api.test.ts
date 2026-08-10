import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { exactVolumeQueryOptions } from './-add.api';

beforeEach(() => vi.clearAllMocks());

it('hydrates a Discovery selection by exact metadata identity', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue({
    comicvine_id: 4050,
    metadata_source: 'comicvine',
    metadata_id: '4050',
    title: 'Saga',
    year: 2012,
    publisher: 'Image',
    volume_number: 1,
  });

  const result = await exactVolumeQueryOptions({
    metadata_source: 'comicvine',
    metadata_id: '4050',
    title: 'Saga',
  }, 'comic').queryFn!({} as never);

  const params = vi.mocked(apiClient.get).mock.calls[0]?.[1]?.searchParams as URLSearchParams;
  expect(apiClient.get).toHaveBeenCalledWith('volumes/search/exact', expect.any(Object));
  expect(params.get('metadata_source')).toBe('comicvine');
  expect(params.get('metadata_id')).toBe('4050');
  expect(params.get('section')).toBe('comic');
  expect(result.metadata_id).toBe('4050');
});
