import { describe, expect, it } from 'vitest';
import { addReviewSearchSchema, addSearchSchema } from '@/app/router';
import { getDiscoveryAddSearch } from '@/routes/discovery/-discovery.types';

describe('exact Discovery to Add identity', () => {
  it('preserves provider-owned identity without turning it into generic search state', () => {
    const search = getDiscoveryAddSearch({ comicvine_id: 44, metadata_source: 'mangadex', metadata_id: 'md-9', metadata_language: 'en', title: 'Exact Edition' }, 'manga');
    expect(search).toEqual({ section: 'manga', source: 'mangadex', id: 'md-9', title: 'Exact Edition', language: 'en' });
    expect(addReviewSearchSchema.parse(search)).toMatchObject({ source: 'mangadex', id: 'md-9' });
    expect(addSearchSchema.parse({ section: 'manga' })).not.toHaveProperty('title');
  });
  it('rejects an exact review route without source identity', () => {
    expect(() => addReviewSearchSchema.parse({ section: 'comic', id: '1' })).toThrow();
  });
  it('legacy exact add parameters can be preserved by Discover redirects', () => {
    const legacy = addReviewSearchSchema.parse({ section: 'comic', source: 'comicvine', id: '4050-123', title: 'Saga' });
    expect(legacy).toEqual({ section: 'comic', source: 'comicvine', id: '4050-123', title: 'Saga' });
  });

  it('exact add close fallback is explicit instead of browser-history dependent', () => {
    // Source-level guard because this route is rendered through TanStack Router lazies in e2e.
    const source = require('node:fs').readFileSync('src/routes/add/-ui/add-page.tsx', 'utf8');
    expect(source).toContain('const closeReview = () =>');
    expect(source).toContain("navigate({ to: '/discover/search', search: { section, q: selection.title } })");
    expect(source).toContain("navigate({ to: '/discover', search: { section } })");
    expect(source).toContain('onClose={closeReview}');
    expect(source).not.toContain('history.back()');
  });
});
