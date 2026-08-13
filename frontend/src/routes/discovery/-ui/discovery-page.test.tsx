import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DISCOVER_AUTOMATIC_PAGE_LIMIT, DISCOVER_INITIAL_PAGE_SIZE, dedupeDiscoveryItems } from '../-discovery.types';

const source = readFileSync('src/routes/discovery/-ui/discovery-page.tsx', 'utf8');

it('uses separate comic and manga feature-level discover pages', () => {
  expect(source).toContain('export function ComicDiscoverPage');
  expect(source).toContain('export function MangaDiscoverPage');
  expect(source).toContain('function DiscoverSearch');
  expect(source).toContain('function DiscoveryShelf');
  expect(source).not.toContain('StoryArcsView');
});

it('starts with search and section controls rather than a giant title panel', () => {
  expect(source).toContain('DiscoverSearch section={section}');
  expect(source).toContain('aria-label="Discover search and media section"');
  expect(source).not.toContain('className={styles.hero}');
});

it('uses IntersectionObserver hybrid loading with a centralized automatic limit', () => {
  expect(DISCOVER_INITIAL_PAGE_SIZE).toBeGreaterThanOrEqual(24);
  expect(DISCOVER_INITIAL_PAGE_SIZE).toBeLessThanOrEqual(30);
  expect(DISCOVER_AUTOMATIC_PAGE_LIMIT).toBe(3);
  expect(source).toContain('new IntersectionObserver');
  expect(source).toContain('Load More');
  expect(source).not.toContain("window.addEventListener('scroll'");
});

it('deduplicates discovery items by provider identity and omits fake filters', () => {
  const items = dedupeDiscoveryItems([
    { comicvine_id: 1, metadata_source: 'comicvine', metadata_id: '1', title: 'One' },
    { comicvine_id: 1, metadata_source: 'comicvine', metadata_id: '1', title: 'Duplicate' },
    { comicvine_id: -2, metadata_source: 'mangadex', metadata_id: 'md-2', title: 'Two' },
  ]);
  expect(items.map(item => item.title)).toEqual(['One', 'Two']);
  expect(source).toContain('Character and Genre not shown');
});
