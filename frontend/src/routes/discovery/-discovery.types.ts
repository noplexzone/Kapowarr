import { z } from 'zod';

export const discoveryVolumeSchema = z.object({
  comicvine_id: z.number().int(),
  metadata_source: z.enum(['comicvine', 'mangadex']).optional(),
  metadata_id: z.string().optional(),
  metadata_language: z.string().optional(),
  available_languages: z.array(z.string()).optional(),
  title: z.string(),
  year: z.number().int().nullable().optional(),
  publisher: z.string().nullable().optional(),
  volume_number: z.number().optional(),
  cover_link: z.string().optional(),
  id: z.number().int().optional(),
  already_added: z.number().int().nullable().optional(),
  issue_count: z.number().int().optional(),
  issue_number: z.string().optional(),
  cover_date: z.string().optional(),
  date_added: z.string().nullable().optional(),
  volume_title: z.string().optional(),
}).passthrough();

export type DiscoveryVolume = z.infer<typeof discoveryVolumeSchema>;

export const storyArcSchema = z.object({
  id: z.number().int(), name: z.string(), issue_count: z.number().int().optional(),
  cover_url: z.string().optional(), description: z.string().optional(),
}).passthrough();
export type StoryArc = z.infer<typeof storyArcSchema>;
export const storyArcDetailSchema = z.object({ volumes: z.array(discoveryVolumeSchema) });
export type StoryArcDetail = z.infer<typeof storyArcDetailSchema>;
export type DiscoveryType = 'upcoming' | 'new' | 'story-arcs';
export type DiscoverySection = 'comic' | 'manga';

export interface DiscoveryAddSearch {
  section: DiscoverySection;
  metadata_source: 'comicvine' | 'mangadex';
  metadata_id: string;
  title: string;
  metadata_language?: string;
}

export function getDiscoveryAddSearch(volume: DiscoveryVolume, section: DiscoverySection): DiscoveryAddSearch {
  const source = volume.metadata_source ?? 'comicvine';
  return {
    section,
    metadata_source: source,
    metadata_id: volume.metadata_id ?? String(volume.comicvine_id),
    title: volume.title,
    ...(volume.metadata_language ? { metadata_language: volume.metadata_language } : {}),
  };
}
