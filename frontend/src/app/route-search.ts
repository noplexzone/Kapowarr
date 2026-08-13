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

export const mediaLibrarySearchSchema = z.preprocess((raw) => {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const legacyFilter = typeof value.filter === 'string' ? value.filter : undefined;
  const legacyView = typeof value.view === 'string' ? value.view : undefined;
  const rawOffset = value.offset;
  const offset = typeof rawOffset === 'string' || typeof rawOffset === 'number' ? Number(rawOffset) : NaN;

  return {
    view: legacyView === 'posters' ? 'grid' : legacyView === 'table' ? 'list' : value.view,
    q: value.q ?? value.search,
    status: legacyFilter === 'wanted' ? 'missing' : legacyFilter === 'upcoming' ? 'upcoming' : value.status,
    monitoring: legacyFilter === 'unmonitored' ? 'unmonitored' : legacyFilter === 'monitored' ? 'monitored' : value.monitoring,
    sort: value.sort,
    page: Number.isFinite(offset) ? offset + 1 : value.page,
    collection: value.collection,
    section: value.section,
  };
}, z.object({
  view: z.enum(['grid', 'list']).default('grid').catch('grid'),
  q: cleanQuery,
  status: z.enum(['all', 'missing', 'upcoming']).default('all').catch('all'),
  monitoring: z.enum(['all', 'monitored', 'unmonitored']).default('all').catch('all'),
  sort: librarySortSchema.default('title').catch('title'),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  collection: z.string().trim().max(80).optional().catch(undefined).transform((value) => value || undefined),
}));

export const librarySearchSchema = z.preprocess((raw) => {
  const parsed = mediaLibrarySearchSchema.parse(raw);
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { ...parsed, section: value.section };
}, z.object({
  view: z.enum(['grid', 'list']),
  q: cleanQuery,
  status: z.enum(['all', 'missing', 'upcoming']),
  monitoring: z.enum(['all', 'monitored', 'unmonitored']),
  sort: librarySortSchema,
  page: z.number().int().min(1),
  collection: z.string().optional(),
  section: sectionSchema,
}));

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

export const discoverResultsSearchSchema = z.object({
  section: sectionSchema,
  q: z.string().trim().min(2).max(200).catch(''),
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export const discoverAddSearchSchema = z.object({
  section: sectionSchema,
  title: z.string().trim().min(1).max(200).optional().catch(undefined),
  language: z.string().min(2).max(16).optional().catch(undefined),
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

export type MediaLibrarySearch = z.infer<typeof mediaLibrarySearchSchema>;
export type LibrarySearch = z.infer<typeof librarySearchSchema>;

export function mediaLibraryToLegacySearch(search: MediaLibrarySearch) {
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

export function toLegacyLibrarySearch(search: LibrarySearch) {
  return mediaLibraryToLegacySearch(search);
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
