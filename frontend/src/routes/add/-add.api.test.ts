import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { exactVolumeQueryOptions, searchVolumesPageQueryOptions } from './-add.api';

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


it('requests paginated Discover search results without using the legacy unlimited list', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue({ items: [], total: 0, offset: 30, page_size: 30, next_offset: null, has_more: false });
  await searchVolumesPageQueryOptions('Saga', 'comic', 'all', 30, 30).queryFn!({} as never);
  const params = vi.mocked(apiClient.get).mock.calls[0]?.[1]?.searchParams as URLSearchParams;
  expect(apiClient.get).toHaveBeenCalledWith('volumes/search', expect.any(Object));
  expect(params.get('paginated')).toBe('true');
  expect(params.get('offset')).toBe('30');
  expect(params.get('limit')).toBe('30');
});


it('requests MangaDex for paginated manga complete search and forwards cursors', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({} as Response);
  vi.mocked(readJson).mockResolvedValue({ items: [], total: null, offset: 0, page_size: 30, next_offset: null, previous_cursor: 'prev', cursor_history: ['prev'], has_more: false });
  await searchVolumesPageQueryOptions('Berserk', 'manga', 'mangadex', 'cursor-token', 30, true).queryFn!({} as never);
  const params = vi.mocked(apiClient.get).mock.calls[0]?.[1]?.searchParams as URLSearchParams;
  expect(params.get('metadata_source')).toBe('mangadex');
  expect(params.get('cursor')).toBe('cursor-token');
  expect(params.get('exclude_added')).toBe('true');
});
