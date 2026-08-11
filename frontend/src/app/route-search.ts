import { z } from 'zod';

const cleanQuery = z.string().trim().max(200).optional().catch(undefined).transform((value) => value || undefined);

export const sectionSchema = z.enum(['comic', 'manga']).default('comic').catch('comic');
export const activitySectionSchema = z.enum(['all', 'comic', 'manga']).default('all').catch('all');
export const librarySortSchema = z.enum([
  'title',
  'volume_number',
  'year',
  'recently_added',
  'recently_released',
  'publisher',
  'wanted',
]);

export const librarySearchSchema = z.object({
  section: sectionSchema,
  view: z.enum(['grid', 'list']).default('grid').catch('grid'),
  q: cleanQuery,
  status: z.enum(['all', 'missing', 'upcoming']).default('all').catch('all'),
  monitoring: z.enum(['all', 'monitored', 'unmonitored']).default('all').catch('all'),
  sort: librarySortSchema.default('title').catch('title'),
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export const legacyLibrarySearchSchema = z.object({
  sort: z.string().optional().catch(undefined),
  filter: z.string().optional().catch(undefined),
  view: z.string().optional().catch(undefined),
  search: cleanQuery,
  offset: z.coerce.number().int().min(0).default(0).catch(0),
});

export const discoverySearchSchema = z.object({
  section: sectionSchema,
  category: z.enum(['upcoming', 'new', 'story-arcs']).default('upcoming').catch('upcoming'),
  q: cleanQuery,
});

export const legacyDiscoverySearchSchema = z.object({
  section: sectionSchema,
  type: z.enum(['upcoming', 'new', 'story-arcs']).default('upcoming').catch('upcoming'),
  q: cleanQuery,
});

export const activitySearchSchema = z.object({
  section: activitySectionSchema,
  q: cleanQuery,
});

export const historySearchSchema = activitySearchSchema.extend({
  status: z.enum(['all', 'downloaded', 'failed', 'cancelled']).default('all').catch('all'),
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export const blocklistSearchSchema = activitySearchSchema.extend({
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export const searchHistorySearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export const scopedActivitySearchSchema = z.object({
  section: sectionSchema,
  q: cleanQuery,
});

export type LibrarySearch = z.infer<typeof librarySearchSchema>;

export function toLegacyLibrarySearch(search: LibrarySearch) {
  const filter: '' | 'wanted' | 'upcoming' | 'monitored' | 'unmonitored' = search.monitoring === 'unmonitored'
    ? 'unmonitored'
    : search.monitoring === 'monitored'
      ? 'monitored'
      : search.status === 'missing'
        ? 'wanted'
        : search.status === 'upcoming'
          ? 'upcoming'
          : '';

  return {
    sort: search.sort,
    filter,
    view: search.view === 'grid' ? 'posters' as const : 'table' as const,
    search: search.q,
    offset: search.page - 1,
  };
}

export function legacyLibraryToCanonical(
  section: 'comic' | 'manga',
  rawSearch: unknown,
): LibrarySearch {
  const search = legacyLibrarySearchSchema.parse(rawSearch);
  const sortResult = librarySortSchema.safeParse(search.sort);

  return librarySearchSchema.parse({
    section,
    view: search.view === 'table' ? 'list' : 'grid',
    q: search.search,
    status: search.filter === 'wanted' ? 'missing' : search.filter === 'upcoming' ? 'upcoming' : 'all',
    monitoring: search.filter === 'unmonitored'
      ? 'unmonitored'
      : search.filter === 'monitored'
        ? 'monitored'
        : 'all',
    sort: sortResult.success ? sortResult.data : 'title',
    page: search.offset + 1,
  });
}

export function legacyDiscoveryToCanonical(rawSearch: unknown) {
  const search = legacyDiscoverySearchSchema.parse(rawSearch);
  return discoverySearchSchema.parse({
    section: search.section,
    category: search.type,
    q: search.q,
  });
}
