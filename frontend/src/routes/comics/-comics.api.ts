import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson, getUrlBase } from '@/app/api-client';
import type { VolumesSearch, VolumeSummary, VolumeListResponse, VolumeDetail, SectionType } from './-comics.types';

export const VOLUMES_KEY = ['volumes'] as const;

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
      have: raw.issues_downloaded ?? 0,
      total: raw.issue_count ?? 0,
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

async function fetchVolumeList(params: VolumesSearch, section: SectionType): Promise<VolumeListResponse> {
  const sp = new URLSearchParams();
  sp.set('section', section);
  if (params.sort) sp.set('sort', params.sort);
  if (params.filter) sp.set('filter', params.filter);
  if (params.search) sp.set('query', params.search);
  if (params.offset != null) sp.set('offset', String(params.offset));

  const response = await apiClient.get('volumes', { searchParams: sp });
  const data = await readJson<Record<string, any>[]>(response);
  const volumes = Array.isArray(data) ? data.map(toVolumeSummary) : [];
  return { volumes, total: volumes.length };
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
