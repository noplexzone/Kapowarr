import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { HistoryEntry, HistoryResponse } from './-history.types';

export const HISTORY_KEY = ['activity', 'history'] as const;

interface RawHistoryEntry {
  web_link: string;
  web_title: string | null;
  web_sub_title: string | null;
  file_title: string | null;
  volume_id: number | null;
  issue_id: number | null;
  source: string | null;
  source_name: string | null;
  downloaded_at: number;
  success: boolean | null;
}

function toHistoryEntry(raw: RawHistoryEntry, idx: number): HistoryEntry {
  return {
    id: idx + 1,
    title: raw.web_title || raw.file_title || raw.web_sub_title || raw.source || 'Unknown',
    source: raw.source_name || raw.source || '',
    downloaded_at: raw.downloaded_at * 1000,
    state: raw.success === true ? 'downloaded' : raw.success === false ? 'failed' : 'cancelled',
  };
}

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
  const data = await readJson<RawHistoryEntry[]>(response);
  const entries = (Array.isArray(data) ? data : []).map(toHistoryEntry);
  return {
    entries,
    total: entries.length,
    page_size: 50,
  };
}

export async function clearHistory(): Promise<void> {
  await apiClient.delete('activity/history');
}
