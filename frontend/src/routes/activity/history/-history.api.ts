import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { HistoryEntry, HistoryResponse } from './-history.types';

export const HISTORY_KEY = ['activity', 'history'] as const;

export function historyQueryOptions(offset: number) {
  return queryOptions({
    queryKey: [...HISTORY_KEY, offset],
    queryFn: () => getHistory(offset),
    staleTime: 30_000,
  });
}

async function getHistory(offset: number): Promise<HistoryResponse> {
  const sp = new URLSearchParams({ offset: String(offset) });
  const response = await apiClient.get('activity/history', { searchParams: sp });
  // Backend returns a raw array; wrap it into the envelope the SPA expects.
  const data = await readJson<HistoryEntry[]>(response);
  return {
    entries: data,
    total: Array.isArray(data) ? data.length : 0,
    page_size: 50,
  };
}

export async function clearHistory(): Promise<void> {
  await apiClient.delete('activity/history');
}
