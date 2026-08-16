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

  it('exact add close uses router-validated discover return state', () => {
    // Source-level guard because this route is rendered through TanStack Router lazies in e2e.
    const source = require('node:fs').readFileSync('src/routes/add/-ui/add-page.tsx', 'utf8');
    expect(source).toContain('const closeReview = () =>');
    expect(source).toContain("navigate({ to: '/discover/search', search: { section, q: selection.title } })");
    expect(source).toContain("navigate({ to: '/discover', search: { section } })");
    expect(source).toContain('onClose={closeReview}');
    expect(source).toContain('navigateToDiscoverReturn');
    expect(source).not.toContain('history.back()');
    expect(source).not.toContain('returnTo as never');
  });

  it('uses TanStack masked locations as the route-owned exact Add overlay', () => {
    const source = require('node:fs').readFileSync('src/routes/discovery/-ui/discovery-page.tsx', 'utf8');
    expect(source).toContain('useRouterState({ select: (state) => state.location.maskedLocation })');
    expect(source).toContain("mask: {");
    expect(source).toContain("to: '/discover/add/$source/$metadataId'");
    expect(source).toContain('unmaskOnReload: true');
    expect(source).toContain('data-testid=\"discover-origin-route\"');
    expect(source).toContain('inertProps(overlayOpen)');
    expect(source).toContain('exactAddReturnFocus?.focus({ preventScroll: true })');
    expect(source).not.toContain('__tempLocation');
    expect(source).not.toContain('router.history');
    expect(source).not.toContain('DiscoverBackgroundRoute');
    expect(source).not.toContain('data-testid=\"discover-background-route\"');
  });
});
