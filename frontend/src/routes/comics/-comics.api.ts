import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson, getUrlBase } from '@/app/api-client';
import type { VolumesSearch, VolumeSummary, VolumeListResponse, VolumeDetail, SectionType, LibraryFacets } from './-comics.types';

export const VOLUMES_KEY = ['volumes'] as const;
export const LIBRARY_FACETS_KEY = ['library-facets'] as const;

export function volumeListQueryOptions(profile: number, params: VolumesSearch, section: SectionType = 'comic') {
  return queryOptions({
    queryKey: [...VOLUMES_KEY, 'list', profile, section, params],
    queryFn: () => fetchVolumeList(params, section),
    staleTime: 30_000,
  });
}

/** Transform a raw backend volume dict into the SPA's VolumeSummary shape. */
function toVolumeSummary(raw: Record<string, any>): VolumeSummary {
  return {
    id: raw.id,
    title: raw.title ?? '',
    year: raw.year ?? 0,
    volume_number: raw.volume_number ?? 0,
    publisher: raw.publisher ?? '',
    monitored: Boolean(raw.monitored),
    root_folder: raw.root_folder ?? '',
    folder: raw.folder ?? '',
    special_version: raw.special_version ?? '',
    progress: {
      have: raw.released_issues_downloaded ?? raw.issues_downloaded ?? 0,
      total: raw.released_issue_count ?? raw.issue_count ?? 0,
      completion: raw.completion_percentage ?? null,
      upcoming: raw.upcoming_issue_count ?? 0,
    },
    cover_url: `${getUrlBase()}/api/volumes/${raw.id}/cover`,
  };
}

/** Transform a raw backend volume detail dict into the SPA's VolumeDetail shape. */
function toVolumeDetail(raw: Record<string, any>): VolumeDetail {
  return {
    ...toVolumeSummary(raw),
    description: raw.description ?? undefined,
    issues: Array.isArray(raw.issues)
      ? raw.issues.map((i: Record<string, any>) => ({
          id: i.id,
          issue_number: String(i.issue_number ?? ''),
          issue_title: i.title ?? i.issue_title ?? undefined,
          calculated_issue_number: i.calculated_issue_number ?? 0,
          monitored: Boolean(i.monitored),
          downloaded: Boolean(i.downloaded ?? false),
          release_date: i.release_date ?? undefined,
        }))
      : [],
  };
}

const VOLUME_PAGE_SIZE = 60;

const rawVolumeListSchema = z.object({
  items: z.array(z.record(z.unknown())), total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(), page_size: z.number().int().positive(),
});
const emptyObjectSchema = z.object({}).strict();
const nullSchema = z.null();

const facetItemSchema = z.object({ value: z.string(), label: z.string().optional(), filter: z.string().optional(), count: z.number().int().optional() });
const libraryFacetsSchema = z.object({ publishers: z.array(facetItemSchema), years: z.array(facetItemSchema), status: z.array(facetItemSchema) });

export function libraryFacetsQueryOptions(section: SectionType) {
  return queryOptions({
    queryKey: [...LIBRARY_FACETS_KEY, section],
    queryFn: async (): Promise<LibraryFacets> => {
      const response = await apiClient.get('volumes/facets', { searchParams: { section } });
      return readJson(response, libraryFacetsSchema) as Promise<LibraryFacets>;
    },
    staleTime: 60_000,
  });
}

async function fetchVolumeList(params: VolumesSearch, section: SectionType): Promise<VolumeListResponse> {
  const sp = new URLSearchParams();
  sp.set('paginated', 'true');
  sp.set('section', section);
  if (params.sort) sp.set('sort', params.sort);
  sp.set('direction', params.direction ?? 'asc');
  if (params.filter) sp.set('filter', params.filter);
  if (params.search) sp.set('query', params.search);
  sp.set('offset', String(params.offset ?? 0));
  sp.set('limit', String(VOLUME_PAGE_SIZE));

  const response = await apiClient.get('volumes', {
    searchParams: sp,
    timeout: 60_000,
  });
  const data = await readJson(response, rawVolumeListSchema);
  if (
    !data
    || !Array.isArray(data.items)
    || !Number.isInteger(data.total)
    || !Number.isInteger(data.offset)
    || !Number.isInteger(data.page_size)
  ) {
    throw new Error('Invalid paginated volume response');
  }

  return {
    volumes: data.items.map(toVolumeSummary),
    total: data.total,
    offset: data.offset,
    page_size: data.page_size,
  };
}

export function volumeDetailQueryOptions(profile: number, id: number) {
  return queryOptions({
    queryKey: [...VOLUMES_KEY, 'detail', profile, id],
    queryFn: () => fetchVolumeDetail(id),
    staleTime: 30_000,
  });
}

async function fetchVolumeDetail(id: number): Promise<VolumeDetail> {
  const response = await apiClient.get(`volumes/${id}`);
  const raw = await readJson<Record<string, any>>(response);
  return toVolumeDetail(raw);
}

export type LibraryTaskCommand = 'update_all' | 'search_all';
export type VolumeTaskCommand = 'auto_search' | 'refresh_and_scan';

export async function runLibraryTask(cmd: LibraryTaskCommand): Promise<{ id: number }> {
  const response = await apiClient.post('system/tasks', { json: { cmd } });
  return readJson<{ id: number }>(response);
}

export async function runVolumeTask(id: number, cmd: VolumeTaskCommand): Promise<{ id: number }> {
  const response = await apiClient.post('system/tasks', {
    json: { cmd, volume_id: id },
    timeout: 60_000,
  });
  return readJson<{ id: number }>(response);
}

export async function setVolumeMonitored(id: number, monitored: boolean): Promise<void> {
  const response = await apiClient.put(`volumes/${id}`, { json: { monitored } });
  await readJson(response, nullSchema);
}

export async function deleteLibraryVolume(id: number): Promise<void> {
  const response = await apiClient.delete(`volumes/${id}`, {
    searchParams: { delete_folder: 'false' },
  });
  await readJson(response, emptyObjectSchema);
}
