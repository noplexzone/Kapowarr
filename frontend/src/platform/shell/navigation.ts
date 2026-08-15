export type PrimaryNavLabel = 'Home' | 'Library' | 'Discover' | 'Activity' | 'Settings';

export interface PrimaryNavItem {
  label: PrimaryNavLabel;
  to: string;
  parent?: boolean;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { label: 'Home', to: '/home' },
  { label: 'Library', to: '/library' },
  { label: 'Discover', to: '/discover' },
  { label: 'Activity', to: '/activity', parent: true },
  { label: 'Settings', to: '/settings/general' },
];

export const ACTIVITY_NAV = [
  ['Queue', '/activity/queue'],
  ['History', '/activity/history'],
  ['Searches', '/activity/search-history'],
  ['Mismatches', '/activity/mismatches'],
  ['Imports', '/activity/imports'],
  ['Blocklist', '/activity/blocklist'],
] as const;

export function getActivePrimary(pathname: string): PrimaryNavLabel | undefined {
  if (pathname === '/' || pathname === '/home') return 'Home';
  if (pathname === '/library' || pathname === '/comics' || pathname === '/manga' || pathname.startsWith('/volumes/') || pathname.startsWith('/read/')) return 'Library';
  if (pathname === '/discover' || pathname.startsWith('/discover/') || pathname.startsWith('/add')) return 'Discover';
  if (pathname === '/activity' || pathname.startsWith('/activity/')) return 'Activity';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'Settings';
  return undefined;
}


const SORT_OPTIONS = new Set(['title', 'volume_number', 'year', 'recently_added', 'recently_released', 'publisher', 'completion']);
const VIEW_OPTIONS = new Set(['posters', 'table']);
const FILTER_OPTIONS = new Set(['', 'wanted', 'upcoming', 'unmonitored', 'monitored']);

function readStoredString(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function getStoredLibrarySearch() {
  const sort = readStoredString('kapowarr_sort');
  const view = readStoredString('kapowarr_view');
  const filter = readStoredString('kapowarr_filter');
  const q = readStoredString('kapowarr_search');
  const validFilter = filter && FILTER_OPTIONS.has(filter) ? filter : '';
  return {
    sort: sort && SORT_OPTIONS.has(sort) ? sort : 'title',
    view: view && VIEW_OPTIONS.has(view) ? (view === 'table' ? 'list' : 'grid') : 'grid',
    status: validFilter === 'wanted' ? 'missing' : validFilter === 'upcoming' ? 'upcoming' : 'all',
    monitoring: validFilter === 'unmonitored' ? 'unmonitored' : validFilter === 'monitored' ? 'monitored' : 'all',
    q: q || undefined,
    page: 1,
  };
}
