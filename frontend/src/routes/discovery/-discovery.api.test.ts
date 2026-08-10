import { describe, expect, it } from 'vitest';
import { normalizeDiscoveryItem } from './-discovery.api';
import { getDiscoveryAddSearch } from './-discovery.types';


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
