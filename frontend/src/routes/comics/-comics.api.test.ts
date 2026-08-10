import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
  getUrlBase: vi.fn(() => ''),
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { volumeListQueryOptions } from './-comics.api';

const get = vi.mocked(apiClient.get);
const parse = vi.mocked(readJson);

beforeEach(() => vi.clearAllMocks());

describe('volume list pagination', () => {
  it('requests a bounded zero-based page and preserves the truthful total', async () => {
    const response = {} as Response;
    get.mockResolvedValue(response as never);
    parse.mockResolvedValue({
      items: [{ id: 7, title: 'Saga', issues_downloaded: 2, issue_count: 5 }],
      total: 1167,
      offset: 2,
      page_size: 60,
    });

    const options = volumeListQueryOptions(1, {
      sort: 'title', filter: 'wanted', view: 'posters', search: 'saga', offset: 2,
    }, 'comic');
    const result = await options.queryFn!({} as never);

    const searchParams = get.mock.calls[0]?.[1]?.searchParams as URLSearchParams;
    expect(get).toHaveBeenCalledWith('volumes', expect.any(Object));
    expect(searchParams.get('offset')).toBe('2');
    expect(searchParams.get('limit')).toBe('60');
    expect(result).toMatchObject({ total: 1167, offset: 2, page_size: 60 });
    expect(result.volumes).toHaveLength(1);
    expect(result.volumes[0]?.progress).toEqual({ have: 2, total: 5 });
    expect(parse).toHaveBeenCalledWith(response);
  });

  it('fails closed when the response shape is not paginated', async () => {
    get.mockResolvedValue({} as never);
    parse.mockResolvedValue([]);
    const options = volumeListQueryOptions(1, {
      sort: 'title', filter: '', view: 'posters', offset: 0,
    }, 'manga');
    await expect(options.queryFn!({} as never)).rejects.toThrow(/paginated volume response/i);
  });
});
