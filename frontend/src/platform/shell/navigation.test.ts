import { beforeEach, describe, expect, it } from 'vitest';
import { getActivePrimary, getStoredLibrarySearch, PRIMARY_NAV } from './navigation';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      clear: () => storage.clear(),
    },
  });
});

describe('canonical navigation model', () => {
  it('contains the selected primary destinations', () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      'Home',
      'Library',
      'Discover',
      'Activity',
      'Settings',
    ]);
  });

  it.each([
    ['/home', 'Home'],
    ['/library', 'Library'],
    ['/comics', 'Library'],
    ['/manga', 'Library'],
    ['/volumes/42', 'Library'],
    ['/discover', 'Discover'],
    ['/activity/mismatches', 'Activity'],
    ['/settings/proxy', 'Settings'],
  ])('matches %s to one active primary destination', (pathname, label) => {
    expect(getActivePrimary(pathname)).toBe(label);
  });

  it('does not mislabel secondary or unknown routes as Settings', () => {
    expect(getActivePrimary('/system/status')).toBeUndefined();
    expect(getActivePrimary('/not-found')).toBeUndefined();
  });

  it('marks only navigation groups as active parents', () => {
    expect(PRIMARY_NAV.filter((item) => item.parent).map((item) => item.label)).toEqual(['Activity']);
  });
});


it('hydrates media nav targets from stored preferences', () => {
  window.localStorage.setItem('kapowarr_sort', JSON.stringify('recently_added'));
  window.localStorage.setItem('kapowarr_view', JSON.stringify('table'));
  window.localStorage.setItem('kapowarr_filter', JSON.stringify('wanted'));
  window.localStorage.setItem('kapowarr_search', JSON.stringify('batman'));

  expect(getStoredLibrarySearch()).toEqual({
    section: 'comic',
    sort: 'recently_added',
    view: 'list',
    status: 'missing',
    monitoring: 'all',
    q: 'batman',
    page: 1,
  });
});

it('restores the last valid library section', () => {
  window.localStorage.setItem('kapowarr_section', JSON.stringify('manga'));

  expect(getStoredLibrarySearch()).toMatchObject({ section: 'manga' });
});

it('defaults an invalid stored library section to comics', () => {
  window.localStorage.setItem('kapowarr_section', JSON.stringify('novels'));

  expect(getStoredLibrarySearch()).toMatchObject({ section: 'comic' });
});

it('ignores invalid stored media nav preferences', () => {
  window.localStorage.setItem('kapowarr_sort', JSON.stringify('bogus'));
  window.localStorage.setItem('kapowarr_view', JSON.stringify('huge'));
  window.localStorage.setItem('kapowarr_filter', JSON.stringify('bad'));

  expect(getStoredLibrarySearch()).toMatchObject({
    sort: 'title',
    view: 'grid',
    status: 'all',
    monitoring: 'all',
  });
});


it('Activity parent remains current for primary navigation semantics', async () => {
  const sidebar = await import('./sidebar?raw');
  const mobile = await import('./mobile-navigation?raw');
  expect(sidebar.default).toContain("aria-current={isActive ? 'page' : undefined}");
  expect(mobile.default).toContain("aria-current={isActive ? 'page' : undefined}");
});
