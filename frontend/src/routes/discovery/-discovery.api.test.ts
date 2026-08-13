import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { fetchDiscoveryVolumePage, normalizeDiscoveryItem } from './-discovery.api';
import { filterDiscoveryVolumes, getDiscoveryAddSearch, getDiscoveryAddSelection } from './-discovery.types';

const get = vi.mocked(apiClient.get);
const parse = vi.mocked(readJson);

beforeEach(() => vi.clearAllMocks());

describe('Discovery to Add identity', () => {
  it('requests paginated discovery volumes and normalizes returned items', async () => {
    get.mockResolvedValue({} as never);
    parse.mockResolvedValue({
      items: [{ volume_id: 4050, volume_title: 'Saga', issue_id: 9001, issue_number: '70' }],
      total: 51,
      offset: 50,
      page_size: 50,
    });

    const page = await fetchDiscoveryVolumePage('upcoming', 'comic', 50, 50);
    const searchParams = get.mock.calls[0]?.[1]?.searchParams as Record<string, string>;

    expect(get).toHaveBeenCalledWith('discovery', expect.any(Object));
    expect(searchParams).toMatchObject({ type: 'upcoming', section: 'comic', paginated: 'true', offset: '50', limit: '50' });
    expect(page.total).toBe(51);
    expect(page.items[0]).toMatchObject({ title: 'Saga', comicvine_id: 4050, issue_number: '70' });
  });

  it('preserves the exact ComicVine volume identity from an upcoming issue', () => {
    const volume = normalizeDiscoveryItem({
      volume_id: 4050,
      volume_title: 'Saga',
      issue_id: 9001,
      issue_number: '70',
      cover_date: '2026-09-01',
      already_added: null,
    }, 'upcoming');

    expect(getDiscoveryAddSearch(volume, 'comic')).toEqual({
      section: 'comic',
      source: 'comicvine',
      id: '4050',
      title: 'Saga',
    });
  });

  it('hydrates an in-place add selection without route-only search keys', () => {
    const volume = normalizeDiscoveryItem({
      comicvine_id: 4050,
      metadata_id: '4050',
      metadata_source: 'comicvine',
      title: 'Saga',
      metadata_language: 'en',
    }, 'new');

    expect(getDiscoveryAddSelection(volume)).toEqual({
      metadata_source: 'comicvine',
      metadata_id: '4050',
      title: 'Saga',
      metadata_language: 'en',
    });
  });

  it('can hide volumes that are already in the library', () => {
    const volumes = [
      { comicvine_id: 1, title: 'Keep', already_added: null },
      { comicvine_id: 2, title: 'Hide', already_added: 9 },
      { comicvine_id: 3, title: 'Also Keep' },
    ];

    expect(filterDiscoveryVolumes(volumes, true).map((v) => v.title)).toEqual(['Keep', 'Also Keep']);
    expect(filterDiscoveryVolumes(volumes, false)).toEqual(volumes);
  });

  it('accepts valid nullable metadata from the backend', () => {
    const volume = normalizeDiscoveryItem({
      comicvine_id: 42,
      title: 'Unknown Year',
      year: null,
      publisher: null,
      date_added: null,
      already_added: 7,
    }, 'new');

    expect(volume).toMatchObject({
      metadata_id: '42',
      year: null,
      publisher: null,
      already_added: 7,
    });
  });
});
