import { describe, expect, it } from 'vitest';
import { isNavActive, isSubActive } from './sidebar';

const comic = { label: 'Comic Mismatches', to: '/activity/mismatches', search: { section: 'comic' } };
const manga = { label: 'Manga Mismatches', to: '/activity/mismatches', search: { section: 'manga' } };
const activity = { label: 'Activity', to: '/activity/queue', children: [comic, manga] };

describe('mismatch navigation identity', () => {
  it.each([['comic', comic, manga], ['manga', manga, comic]] as const)('matches only the %s destination', (section, current, other) => {
    const search = { section };
    expect(isSubActive(current, '/activity/mismatches', search)).toBe(true);
    expect(isSubActive(other, '/activity/mismatches', search)).toBe(false);
    expect(isNavActive(activity, '/activity/mismatches', search)).toBe(true);
  });
  it('does not use a pathname prefix as route identity', () => {
    expect(isSubActive(comic, '/activity/mismatches-extra', { section: 'comic' })).toBe(false);
  });
});
