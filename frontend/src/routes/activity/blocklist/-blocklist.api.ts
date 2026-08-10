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

interface RawBlocklistResponse {
  entries: BlocklistEntry[];
  total: number;
  offset: number;
  page_size: number;
}

async function getBlocklist(offset: number): Promise<BlocklistResponse> {
  const sp = new URLSearchParams({ offset: String(offset), paginated: 'true' });
  const response = await apiClient.get('blocklist', { searchParams: sp });
  const data = await readJson<RawBlocklistResponse>(response);
  if (!data || !Array.isArray(data.entries) || !Number.isInteger(data.total)) {
    throw new Error('Invalid paginated blocklist response');
  }
  return { entries: data.entries, total: data.total, page_size: data.page_size };
}

export async function deleteBlocklistEntry(id: number): Promise<void> {
  const response = await apiClient.delete(`blocklist/${id}`);
  await readJson<unknown>(response);
}

export async function clearBlocklist(): Promise<void> {
  const response = await apiClient.delete('blocklist');
  await readJson<unknown>(response);
}
