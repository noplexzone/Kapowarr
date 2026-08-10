import { z } from 'zod';
export const searchResultSchema = z.object({
  comicvine_id: z.number().int(), metadata_source: z.enum(['comicvine', 'mangadex']).optional(),
  metadata_id: z.string().optional(), metadata_language: z.string().optional(), available_languages: z.array(z.string()).optional(),
  title: z.string(), year: z.number().int().nullable(), publisher: z.string().nullable(), volume_number: z.number(),
  cover_url: z.string().optional(), cover_link: z.string().optional(), description: z.string().optional(),
  aliases: z.union([z.array(z.string()), z.string()]).optional(), translated: z.boolean().optional(), issue_count: z.number().int().optional(),
  already_added: z.number().int().nullable().optional(), id: z.number().int().optional(),
}).passthrough();
export type SearchResult = z.infer<typeof searchResultSchema>;
export const rootFolderSchema = z.object({ id: z.number().int(), folder: z.string(), section: z.enum(['comic', 'manga']) });
export type RootFolder = z.infer<typeof rootFolderSchema>;
