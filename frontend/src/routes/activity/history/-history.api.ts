import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import type { HistoryEntry, HistoryResponse } from './-history.types';

export const HISTORY_KEY = ['activity', 'history'] as const;

interface RawHistoryEntry {
  web_link: string | null;
  web_title: string | null;
  web_sub_title: string | null;
  file_title: string | null;
  volume_id: number | null;
  issue_id: number | null;
  source: string | null;
  source_name: string | null;
  downloaded_at: number;
  success: boolean | null;
  failure_reason?: string | null;
}

function toHistoryEntry(raw: RawHistoryEntry, idx: number): HistoryEntry {
  return {
    id: idx + 1,
    title: raw.web_title || raw.file_title || raw.web_sub_title || raw.source || 'Unknown',
    source: raw.source_name || raw.source || '',
    downloaded_at: raw.downloaded_at * 1000,
    state: raw.success === true ? 'downloaded' : raw.success === false ? 'failed' : 'cancelled',
    failure_reason: raw.failure_reason ?? null,
  };
}

export type HistoryState = 'all' | 'downloaded' | 'failed' | 'cancelled';

export function historyQueryOptions(offset: number, state: HistoryState = 'all') {
  return queryOptions({
    queryKey: [...HISTORY_KEY, offset, state],
    queryFn: () => getHistory(offset, state),
    staleTime: 0,
    refetchInterval: 5_000,
  });
}

export const rawHistoryEntrySchema = z.object({ web_link: z.string().nullable(), web_title: z.string().nullable(), web_sub_title: z.string().nullable(), file_title: z.string().nullable(), volume_id: z.number().int().nullable(), issue_id: z.number().int().nullable(), source: z.string().nullable(), source_name: z.string().nullable(), downloaded_at: z.number(), success: z.boolean().nullable(), failure_reason: z.string().nullable().optional() });
const rawHistoryResponseSchema = z.object({ entries: z.array(rawHistoryEntrySchema), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), page_size: z.number().int().positive() });
const emptyObjectSchema = z.object({}).strict();

async function getHistory(offset: number, state: HistoryState): Promise<HistoryResponse> {
  const sp = new URLSearchParams({ offset: String(offset), paginated: 'true', state });
  const response = await apiClient.get('activity/history', { searchParams: sp });
  const data = await readJson(response, rawHistoryResponseSchema);
  if (!data || !Array.isArray(data.entries) || !Number.isInteger(data.total)) {
    throw new Error('Invalid paginated history response');
  }
  return {
    entries: data.entries.map(toHistoryEntry),
    total: data.total,
    page_size: data.page_size,
  };
}

export async function clearHistory(): Promise<void> {
  const response = await apiClient.delete('activity/history');
  await readJson(response, emptyObjectSchema);
}
