import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { VolumeDetailFull } from './-volumes.types';

export const VOLUME_FULL_KEY = (id: number) =>
  ['volumes', 'full', id] as const;

export function volumeDetailFullQueryOptions(id: number) {
  return queryOptions({
    queryKey: VOLUME_FULL_KEY(id),
    queryFn: () => fetchVolumeDetailFull(id),
    staleTime: 30_000,
    enabled: id > 0,
  });
}

async function fetchVolumeDetailFull(id: number): Promise<VolumeDetailFull> {
  const response = await apiClient.get(`volumes/${id}`);
  return readJson<VolumeDetailFull>(response);
}

export async function deleteVolume(id: number): Promise<void> {
  await apiClient.delete(`volumes/${id}`);
}

export async function autoSearchVolume(id: number): Promise<void> {
  await apiClient.post(`volumes/${id}/download`);
}

export async function manualSearchVolume(id: number): Promise<void> {
  await apiClient.post(`volumes/${id}/manualsearch`);
}
