import { describe, expect, it } from 'vitest';
import {
  activitySearchSchema,
  discoverySearchSchema,
  discoverAddSearchSchema,
  discoverResultsSearchSchema,
  historySearchSchema,
  legacyDiscoveryToCanonical,
  legacyLibraryToCanonical,
  librarySearchSchema,
  mediaLibrarySearchSchema,
  mediaLibraryToLegacySearch,
  toLegacyLibrarySearch,
} from './route-search';

describe('canonical route search', () => {
  it('normalizes invalid legacy library state to safe shareable defaults', () => {
    expect(librarySearchSchema.parse({ section: 'other', view: 'huge', page: '-2' })).toMatchObject({
      section: 'comic',
      view: 'grid',
      page: 1,
      sort: 'title',
      status: 'all',
      monitoring: 'all',
    });
  });

  it('normalizes separated comics and manga library state without a section parameter', () => {
    expect(mediaLibrarySearchSchema.parse({ view: 'huge', page: '-2', q: '  batman  ' })).toMatchObject({
      view: 'grid',
      page: 1,
      sort: 'title',
      status: 'all',
      monitoring: 'all',
      q: 'batman',
    });
  });

  it('preserves supported discover state and trims query text', () => {
    expect(discoverySearchSchema.parse({ section: 'manga', category: 'recently-started', q: '  berserk  ' })).toEqual({
      section: 'manga',
      category: 'recently-started',
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
    })).toMatchObject({
      section: 'manga',
      sort: 'recently_added',
      status: 'all',
      monitoring: 'unmonitored',
      view: 'list',
      q: 'Dorohedoro',
      page: 3,
    });
  });

  it('maps separated media library state to the supported library API contract', () => {
    expect(mediaLibraryToLegacySearch(mediaLibrarySearchSchema.parse({
      status: 'missing',
      page: 2,
    }))).toMatchObject({
      filter: 'wanted',
      view: 'posters',
      offset: 1,
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

  it('preserves legacy query keys on separated media routes', () => {
    expect(mediaLibrarySearchSchema.parse({
      search: '  Saga  ',
      filter: 'wanted',
      view: 'posters',
      offset: '1',
    })).toMatchObject({
      q: 'Saga',
      status: 'missing',
      monitoring: 'all',
      view: 'grid',
      page: 2,
    });
  });

  it('validates Discover result and exact-add route state', () => {
    expect(discoverResultsSearchSchema.parse({ section: 'manga', q: '  Saga ', page: '2' })).toEqual({ section: 'manga', q: 'Saga', page: 2, hide_added: false });
    expect(discoverResultsSearchSchema.parse({ section: 'manga', q: '  Saga ', page: '2', hide_added: 'true' })).toMatchObject({ hide_added: true });
    expect(discoverAddSearchSchema.parse({ section: 'manga', title: '  Akira ', language: 'en', returnTo: '/discover/browse?section=manga&status=ongoing' })).toEqual({ section: 'manga', title: 'Akira', language: 'en', returnTo: '/discover/browse?section=manga&status=ongoing' });
    expect(discoverAddSearchSchema.parse({ section: 'manga', returnTo: 'https://evil.example/' }).returnTo).toBeUndefined();
  });

  it('preserves discovery section, category, and query', () => {
    expect(legacyDiscoveryToCanonical({ section: 'manga', type: 'new', q: '  Pluto ' })).toEqual({
      section: 'manga',
      category: 'recently-started',
      q: 'Pluto',
    });
  });

  it('redirects legacy story arc discovery state to the normal Discover landing', () => {
    expect(legacyDiscoveryToCanonical({ section: 'manga', type: 'story-arcs', q: '  Pluto ' })).toEqual({
      section: 'manga',
      category: 'recently-started',
      q: 'Pluto',
    });
  });
});
