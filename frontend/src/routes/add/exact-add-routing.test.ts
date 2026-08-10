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
});
