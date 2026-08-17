import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import { searchResultSchema, rootFolderSchema } from './-add.types';
import type { SearchResult, RootFolder } from './-add.types';

const addedVolumeSchema = z.object({ id: z.number().int().positive() });
const searchPageSchema = z.object({
  items: z.array(searchResultSchema),
  total: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_offset: z.number().int().nonnegative().nullable(),
  next_cursor: z.string().nullable().optional(),
  previous_cursor: z.string().nullable().optional(),
  cursor_history: z.array(z.string()).optional(),
  total_is_exact: z.boolean().optional(),
  filtered_total_unknown: z.boolean().optional(),
  has_more: z.boolean(),
});
export type SearchResultsPage = z.infer<typeof searchPageSchema>;

export type MetadataSourceFilter = 'all' | 'comicvine' | 'mangadex';

export interface MetadataSelection {
  metadata_source: 'comicvine' | 'mangadex';
  metadata_id: string;
  title?: string;
  metadata_language?: string;
}

export function exactVolumeQueryOptions(selection: MetadataSelection | undefined, section: string) {
  return queryOptions({
    queryKey: ['volumes', 'exact', selection?.metadata_source, selection?.metadata_id, selection?.metadata_language, section],
    queryFn: async () => {
      if (!selection) throw new Error('Metadata selection is required');
      const sp = new URLSearchParams({
        metadata_source: selection.metadata_source,
        metadata_id: selection.metadata_id,
        section,
      });
      if (selection.metadata_language) sp.set('metadata_language', selection.metadata_language);
      const response = await apiClient.get('volumes/search/exact', { searchParams: sp });
      return readJson(response, searchResultSchema);
    },
    enabled: selection != null,
    staleTime: 300_000,
  });
}

export function searchVolumesQueryOptions(query: string, section: string, metadataSource: MetadataSourceFilter = 'comicvine', excludeAdded = false) {
  return queryOptions({
    queryKey: ['volumes', 'search', query, section, metadataSource, excludeAdded],
    queryFn: () => searchVolumes(query, section, metadataSource, excludeAdded),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function searchVolumesPageQueryOptions(query: string, section: string, metadataSource: MetadataSourceFilter = 'comicvine', offset: number | string = 0, limit = 30, excludeAdded = false) {
  return queryOptions({
    queryKey: ['volumes', 'search-page', query, section, metadataSource, offset, limit, excludeAdded],
    queryFn: () => searchVolumesPage(query, section, metadataSource, offset, limit, excludeAdded),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
  });
}

async function searchVolumes(query: string, section: string, metadataSource: MetadataSourceFilter, excludeAdded = false): Promise<SearchResult[]> {
  const sp = new URLSearchParams({ query, section, metadata_source: metadataSource });
  if (excludeAdded) sp.set('exclude_added', 'true');
  const response = await apiClient.get('volumes/search', { searchParams: sp });
  return readJson(response, z.array(searchResultSchema));
}

async function searchVolumesPage(query: string, section: string, metadataSource: MetadataSourceFilter, offset: number | string, limit: number, excludeAdded = false): Promise<SearchResultsPage> {
  const cursor = typeof offset === 'string' ? offset : '';
  const sp = new URLSearchParams({ query, section, metadata_source: metadataSource, paginated: 'true', offset: typeof offset === 'number' ? String(offset) : '0', limit: String(limit) });
  if (cursor) sp.set('cursor', cursor);
  if (excludeAdded) sp.set('exclude_added', 'true');
  const response = await apiClient.get('volumes/search', { searchParams: sp });
  return readJson(response, searchPageSchema);
}

export function rootFoldersQueryOptions() {
  return queryOptions({
    queryKey: ['rootfolder'],
    queryFn: getRootFolders,
    staleTime: 300_000,
  });
}

async function getRootFolders(): Promise<RootFolder[]> {
  const response = await apiClient.get('rootfolder');
  return readJson(response, z.array(rootFolderSchema));
}

export interface AddVolumePayload {
  comicvine_id: number;
  metadata_source?: 'comicvine' | 'mangadex';
  metadata_id?: string;
  metadata_language?: string;
  root_folder_id: number;
  monitor_volume: boolean;
  monitor_issues: boolean;
  monitoring_scheme?: string;
  volume_folder?: string;
  special_version?: string;
  auto_search?: boolean;
}

export async function addVolume(data: AddVolumePayload): Promise<{ id: number }> {
  const response = await apiClient.post('volumes', { json: data });
  return readJson(response, addedVolumeSchema);
}
