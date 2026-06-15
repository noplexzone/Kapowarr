import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { BlocklistEntry, BlocklistResponse } from './-blocklist.types';

export const BLOCKLIST_KEY = ['blocklist'] as const;

export function blocklistQueryOptions(offset: number) {
  return queryOptions({
    queryKey: [...BLOCKLIST_KEY, offset],
    queryFn: () => getBlocklist(offset),
    staleTime: 30_000,
  });
}

async function getBlocklist(offset: number): Promise<BlocklistResponse> {
  const sp = new URLSearchParams({ offset: String(offset) });
  const response = await apiClient.get('blocklist', { searchParams: sp });
  // Backend returns a raw array; wrap it into the envelope the SPA expects.
  const data = await readJson<BlocklistEntry[]>(response);
  return {
    entries: data,
    total: Array.isArray(data) ? data.length : 0,
    page_size: 50,
  };
}

export async function deleteBlocklistEntry(id: number): Promise<void> {
  await apiClient.delete(`blocklist/${id}`);
}

export async function clearBlocklist(): Promise<void> {
  await apiClient.delete('blocklist');
}
