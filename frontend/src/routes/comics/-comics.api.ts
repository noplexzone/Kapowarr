import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { VolumesSearch, VolumeSummary, VolumeListResponse, VolumeDetail, SectionType } from './-comics.types';

export const VOLUMES_KEY = ['volumes'] as const;

export function volumeListQueryOptions(profile: number, params: VolumesSearch, section: SectionType = 'comic') {
  return queryOptions({
    queryKey: [...VOLUMES_KEY, 'list', profile, section, params],
    queryFn: () => fetchVolumeList(params, section),
    staleTime: 30_000,
  });
}

async function fetchVolumeList(params: VolumesSearch, section: SectionType): Promise<VolumeListResponse> {
  const sp = new URLSearchParams();
  sp.set('section', section);
  if (params.sort) sp.set('sort', params.sort);
  if (params.filter) sp.set('filter', params.filter);
  if (params.search) sp.set('search', params.search);
  if (params.offset != null) sp.set('offset', String(params.offset));

  const response = await apiClient.get('volumes', { searchParams: sp });
  // Backend returns a raw array; wrap it into the envelope the SPA expects.
  const data = await readJson<VolumeSummary[]>(response);
  return {
    volumes: data,
    total: Array.isArray(data) ? data.length : 0,
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
  return readJson<VolumeDetail>(response);
}
