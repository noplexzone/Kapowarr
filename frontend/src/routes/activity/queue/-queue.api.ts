import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { QueueEntry } from './-queue.types';

export const QUEUE_KEY = ['activity', 'queue'] as const;

export function queueQueryOptions() {
  return queryOptions({
    queryKey: QUEUE_KEY,
    queryFn: getQueue,
    staleTime: 0,
  });
}

async function getQueue(): Promise<QueueEntry[]> {
  const response = await apiClient.get('activity/queue');
  return readJson<QueueEntry[]>(response);
}

export async function moveDownload(id: number, index: number): Promise<void> {
  await apiClient.put(`activity/queue/${id}`, { json: { index } });
}

export async function removeDownload(id: number, blocklist = false): Promise<void> {
  const json = blocklist ? { blocklist: true } : undefined;
  await apiClient.delete(`activity/queue/${id}`, json ? { json } : undefined);
}

export async function clearQueue(): Promise<void> {
  await apiClient.delete('activity/queue');
}
