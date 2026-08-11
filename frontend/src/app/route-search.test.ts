import { describe, expect, it } from 'vitest';
import {
  activitySearchSchema,
  discoverySearchSchema,
  historySearchSchema,
  legacyDiscoveryToCanonical,
  legacyLibraryToCanonical,
  librarySearchSchema,
  toLegacyLibrarySearch,
} from './route-search';

describe('canonical route search', () => {
  it('normalizes invalid library state to safe shareable defaults', () => {
    expect(librarySearchSchema.parse({ section: 'other', view: 'huge', page: '-2' })).toMatchObject({
      section: 'comic',
      view: 'grid',
      page: 1,
      sort: 'title',
      status: 'all',
      monitoring: 'all',
    });
  });

  it('preserves supported discover state and trims query text', () => {
    expect(discoverySearchSchema.parse({ section: 'manga', category: 'story-arcs', q: '  berserk  ' })).toEqual({
      section: 'manga',
      category: 'story-arcs',
      q: 'berserk',
    });
  });

  it('validates route-specific activity state', () => {
    expect(activitySearchSchema.parse({ section: 'manga', q: '  retry  ' })).toEqual({
      section: 'manga',
      q: 'retry',
    });
    expect(historySearchSchema.parse({ section: 'invalid', status: 'invalid', page: '-3' })).toMatchObject({
      section: 'all',
      status: 'all',
      page: 1,
    });
  });
});

describe('legacy route redirects', () => {
  it('preserves supported comics and manga library state in canonical search', () => {
    expect(legacyLibraryToCanonical('manga', {
      sort: 'recently_added',
      filter: 'unmonitored',
      view: 'table',
      search: '  Dorohedoro  ',
      offset: '2',
    })).toEqual({
      section: 'manga',
      sort: 'recently_added',
      status: 'all',
      monitoring: 'unmonitored',
      view: 'list',
      q: 'Dorohedoro',
      page: 3,
    });
  });

  it('maps canonical library state to the supported library API contract', () => {
    expect(toLegacyLibrarySearch(librarySearchSchema.parse({
      section: 'comic',
      status: 'missing',
      page: 2,
    }))).toMatchObject({
      filter: 'wanted',
      view: 'posters',
      offset: 1,
    });
  });

  it('maps every canonical library filter to exactly one legacy backend filter', () => {
    expect(toLegacyLibrarySearch(librarySearchSchema.parse({ status: 'upcoming' })).filter).toBe('upcoming');
    expect(toLegacyLibrarySearch(librarySearchSchema.parse({ monitoring: 'monitored' })).filter).toBe('monitored');
    expect(toLegacyLibrarySearch(librarySearchSchema.parse({ monitoring: 'unmonitored' })).filter).toBe('unmonitored');
    expect(toLegacyLibrarySearch(librarySearchSchema.parse({ status: 'all', monitoring: 'all' })).filter).toBe('');
  });

  it('preserves discovery section, category, and query', () => {
    expect(legacyDiscoveryToCanonical({ section: 'manga', type: 'new', q: '  Pluto ' })).toEqual({
      section: 'manga',
      category: 'new',
      q: 'Pluto',
    });
  });
});
