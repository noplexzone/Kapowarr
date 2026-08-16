import { z } from 'zod';

export const DISCOVER_INITIAL_PAGE_SIZE = 30;
export const DISCOVER_AUTOMATIC_PAGE_LIMIT = 3;

export const discoverySectionSchema = z.enum(['comic', 'manga']);
export type DiscoverySection = z.infer<typeof discoverySectionSchema>;
export const browseSortSchema = z.enum(['trending', 'title', 'year', 'recently_started', 'recently_updated']).default('trending').catch('trending');
export type BrowseSort = z.infer<typeof browseSortSchema>;

export const discoveryVolumeSchema = z.object({
  comicvine_id: z.number().int(), metadata_source: z.enum(['comicvine', 'mangadex']).optional(), metadata_id: z.string().optional(), metadata_language: z.string().optional(), available_languages: z.array(z.string()).optional(), title: z.string(), year: z.number().int().nullable().optional(), publisher: z.string().nullable().optional(), volume_number: z.number().optional(), cover_link: z.string().nullable().optional(), cover_url: z.string().nullable().optional(), id: z.number().int().optional(), already_added: z.number().int().nullable().optional(), issue_count: z.number().int().nullable().optional(), issue_number: z.string().optional(), cover_date: z.string().optional(), date_added: z.string().nullable().optional(), volume_title: z.string().optional(), status: z.string().nullable().optional(), metadata_source_label: z.string().optional(), source_note: z.string().optional(), original_language: z.string().nullable().optional(), demographic: z.string().nullable().optional(), content_rating: z.string().nullable().optional(),
}).passthrough();
export type DiscoveryVolume = z.infer<typeof discoveryVolumeSchema>;

export const discoveryPageSchema = z.object({ items: z.array(z.record(z.unknown())), total: z.number().int().nonnegative().nullable(), offset: z.number().int().nonnegative(), page_size: z.number().int().positive(), has_more: z.boolean().optional(), next_cursor: z.string().nullable().optional(), previous_cursor: z.string().nullable().optional(), cursor_history: z.array(z.string()).optional(), total_is_exact: z.boolean().optional(), source_note: z.string().optional(), is_bounded: z.boolean().optional(), maximum_per_year: z.number().int().positive().optional(), years_included: z.array(z.number().int()).optional() });
export type DiscoveryPage = Omit<z.infer<typeof discoveryPageSchema>, 'items'> & { items: DiscoveryVolume[] };

export const discoveryFacetSchema = z.object({ value: z.string(), label: z.string(), count: z.number().int().nonnegative().optional() });
export type DiscoveryFacet = z.infer<typeof discoveryFacetSchema>;
export const discoveryCapabilitiesSchema = z.object({ section: discoverySectionSchema, filters: z.array(z.enum(['publisher', 'decade', 'character', 'genre', 'status', 'tags', 'demographic', 'original_language', 'year', 'author', 'artist', 'content_rating'])), deferred_filters: z.array(z.string()), shelves: z.array(z.string()), source_notes: z.record(z.string()), publishers: z.array(discoveryFacetSchema).optional(), decades: z.array(discoveryFacetSchema).optional(), statuses: z.array(discoveryFacetSchema).optional(), original_languages: z.array(discoveryFacetSchema).optional(), demographics: z.array(discoveryFacetSchema).optional() });
export type DiscoveryCapabilities = z.infer<typeof discoveryCapabilitiesSchema>;
export type DiscoveryType = 'recently-started' | 'upcoming-launches' | 'recently-active' | 'recently-updated' | 'upcoming' | 'new' | 'trending';
export interface BrowseFilters { section: DiscoverySection; q?: string; publisher?: string; decade?: string; character?: string; genre?: string; status?: string; tags?: string; demographic?: string; original_language?: string; year?: string; author?: string; artist?: string; content_rating?: string; hide_added?: boolean; sort: BrowseSort; }

export function filterDiscoveryVolumes<T extends { already_added?: number | null }>(volumes: T[], hideAlreadyAdded: boolean): T[] { return hideAlreadyAdded ? volumes.filter((volume) => volume.already_added == null) : volumes; }
export interface DiscoveryAddSelection { metadata_source: 'comicvine' | 'mangadex'; metadata_id: string; title?: string; metadata_language?: string; }
export function getDiscoveryAddSelection(volume: DiscoveryVolume): DiscoveryAddSelection { return { metadata_source: volume.metadata_source ?? 'comicvine', metadata_id: volume.metadata_id ?? String(volume.comicvine_id), title: volume.title, ...(volume.metadata_language ? { metadata_language: volume.metadata_language } : {}) }; }
export function getDiscoveryCardKey(volume: DiscoveryVolume): string { return `${volume.metadata_source ?? 'comicvine'}:${volume.metadata_id ?? volume.comicvine_id}`; }
export function dedupeDiscoveryItems(items: DiscoveryVolume[]): DiscoveryVolume[] { const seen = new Set<string>(); return items.filter((item) => { const key = getDiscoveryCardKey(item); if (seen.has(key)) return false; seen.add(key); return true; }); }

export interface DiscoveryAddSearch { section: DiscoverySection; source: 'comicvine' | 'mangadex'; id: string; title: string; language?: string; }
export function getDiscoveryAddSearch(volume: DiscoveryVolume, section: DiscoverySection): DiscoveryAddSearch { const source = volume.metadata_source ?? 'comicvine'; return { section, source, id: volume.metadata_id ?? String(volume.comicvine_id), title: volume.title, ...(volume.metadata_language ? { language: volume.metadata_language } : {}) }; }
