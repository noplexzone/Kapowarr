import { describe, expect, it } from 'vitest';
import { normalizeDiscoveryItem } from './-discovery.api';
import { filterDiscoveryVolumes, getDiscoveryAddSearch, getDiscoveryAddSelection } from './-discovery.types';


describe('Discovery to Add identity', () => {
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
