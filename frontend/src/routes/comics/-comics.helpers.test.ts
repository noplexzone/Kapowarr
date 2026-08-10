import { expect, it } from 'vitest';
import { getSelectionScopeKey } from './-comics.helpers';

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
