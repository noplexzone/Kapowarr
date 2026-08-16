import { z } from 'zod';
const nullableString = z.string().nullable().optional();
const nullableStringArray = z.array(z.string()).nullable().optional();

export const searchResultSchema = z.object({
  comicvine_id: z.number().int(), metadata_source: z.enum(['comicvine', 'mangadex']).optional(),
  metadata_id: nullableString, metadata_language: nullableString, available_languages: nullableStringArray,
  title: z.string(), year: z.number().int().nullable(), publisher: z.string().nullable(), volume_number: z.number(),
  cover_url: nullableString, cover_link: nullableString, description: nullableString,
  aliases: z.union([z.array(z.string()), z.string()]).nullable().optional(), translated: z.boolean().nullable().optional(), issue_count: z.number().int().nullable().optional(), status: nullableString, completion: z.union([z.string(), z.number()]).nullable().optional(),
  already_added: z.number().int().nullable().optional(), id: z.number().int().nullable().optional(),
}).passthrough();
export type SearchResult = z.infer<typeof searchResultSchema>;
export const rootFolderSchema = z.object({ id: z.number().int(), folder: z.string(), section: z.enum(['comic', 'manga']) });
export type RootFolder = z.infer<typeof rootFolderSchema>;
