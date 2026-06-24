import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { SearchResult, RootFolder } from './-add.types';

export function searchVolumesQueryOptions(query: string, section: string) {
  return queryOptions({
    queryKey: ['volumes', 'search', query, section],
    queryFn: () => searchVolumes(query, section),
    enabled: query.length >= 2,
    staleTime: 60_000,
  });
}

async function searchVolumes(query: string, section: string): Promise<SearchResult[]> {
  const sp = new URLSearchParams({ query, section });
  const response = await apiClient.get('volumes/search', { searchParams: sp });
  return readJson<SearchResult[]>(response);
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
  return readJson<RootFolder[]>(response);
}

export interface AddVolumePayload {
  comicvine_id: number;
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
  return readJson<{ id: number }>(response);
}
