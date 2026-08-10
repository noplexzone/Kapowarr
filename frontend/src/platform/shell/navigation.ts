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
  { label: 'Activity', to: '/activity/queue', parent: true },
  { label: 'Settings', to: '/settings/general' },
];

export const ACTIVITY_NAV = [
  ['Queue', '/activity/queue'],
  ['History', '/activity/history'],
  ['Mismatches', '/activity/mismatches'],
  ['Imports', '/activity/imports'],
  ['Blocklist', '/activity/blocklist'],
] as const;

export function getActivePrimary(pathname: string): PrimaryNavLabel | undefined {
  if (pathname === '/' || pathname === '/home') return 'Home';
  if (pathname === '/library' || pathname.startsWith('/volumes/') || pathname.startsWith('/read/')) return 'Library';
  if (pathname === '/discover' || pathname.startsWith('/add')) return 'Discover';
  if (pathname === '/activity' || pathname.startsWith('/activity/')) return 'Activity';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'Settings';
  return undefined;
}
