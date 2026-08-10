import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getUrlBase: vi.fn(() => ''),
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import {
  deleteLibraryVolume,
  runLibraryTask,
  runVolumeTask,
  setVolumeMonitored,
  volumeListQueryOptions,
} from './-comics.api';

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

describe('library actions', () => {
  it('sends exact task commands', async () => {
    const post = vi.mocked(apiClient.post);
    post.mockResolvedValue({} as never);
    parse.mockResolvedValue({ id: 9 });

    await runLibraryTask('update_all');
    await runLibraryTask('search_all');
    await runVolumeTask(42, 'refresh_and_scan');
    await runVolumeTask(42, 'auto_search');

    expect(post).toHaveBeenNthCalledWith(1, 'system/tasks', { json: { cmd: 'update_all' } });
    expect(post).toHaveBeenNthCalledWith(2, 'system/tasks', { json: { cmd: 'search_all' } });
    expect(post).toHaveBeenNthCalledWith(3, 'system/tasks', {
      json: { cmd: 'refresh_and_scan', volume_id: 42 }, timeout: 60_000,
    });
    expect(post).toHaveBeenNthCalledWith(4, 'system/tasks', {
      json: { cmd: 'auto_search', volume_id: 42 }, timeout: 60_000,
    });
  });

  it('updates monitoring and deletes without deleting media folders', async () => {
    const put = vi.mocked(apiClient.put);
    const del = vi.mocked(apiClient.delete);
    put.mockResolvedValue({} as never);
    del.mockResolvedValue({} as never);
    parse.mockResolvedValue(undefined);

    await setVolumeMonitored(7, false);
    await deleteLibraryVolume(7);

    expect(put).toHaveBeenCalledWith('volumes/7', { json: { monitored: false } });
    expect(del).toHaveBeenCalledWith('volumes/7', {
      searchParams: { delete_folder: 'false' },
    });
  });
});
