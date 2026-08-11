import { expect, it } from 'vitest';
import { getSelectionScopeKey, getStoredSortPreference, runBounded } from './-comics.helpers';

it('changes the selection scope for every library navigation dimension', () => {
  const base = { sort: 'title', filter: '', view: 'posters', search: '', offset: 0 } as const;
  const key = getSelectionScopeKey('comic', base);

  expect(getSelectionScopeKey('comic', { ...base, offset: 1 })).not.toBe(key);
  expect(getSelectionScopeKey('comic', { ...base, search: 'saga' })).not.toBe(key);
  expect(getSelectionScopeKey('comic', { ...base, filter: 'wanted' })).not.toBe(key);
  expect(getSelectionScopeKey('comic', { ...base, sort: 'year' })).not.toBe(key);
  expect(getSelectionScopeKey('comic', { ...base, view: 'table' })).not.toBe(key);
  expect(getSelectionScopeKey('manga', base)).not.toBe(key);
});

it('restores only valid stored library sort preferences', () => {
  expect(getStoredSortPreference({ getItem: () => JSON.stringify('year') }, 'sort')).toBe('year');
  expect(getStoredSortPreference({ getItem: () => JSON.stringify('not-a-sort') }, 'sort')).toBeNull();
  expect(getStoredSortPreference({ getItem: () => 'not-json' }, 'sort')).toBeNull();
  expect(getStoredSortPreference({ getItem: () => null }, 'sort')).toBeNull();
});

it("bounds selected mutations to four and reports each partial failure", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await runBounded([1, 2, 3, 4, 5, 6, 7], 4, async (id) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (id === 2 || id === 6) throw new Error(String(id));
    return id * 2;
  });
  expect(maxActive).toBe(4);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
  expect(results.map((result) => result.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});
