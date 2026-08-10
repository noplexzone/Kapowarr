import { describe, expect, it } from 'vitest';
import { getActivePrimary, PRIMARY_NAV } from './navigation';

describe('canonical navigation model', () => {
  it('contains exactly the five product destinations', () => {
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
