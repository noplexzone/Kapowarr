import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import type { DashboardSearchTask, NavBadges, VolumeCard } from './-dashboard.types';

const volumeStatsSchema = z.object({
  volumes: z.number().int().nonnegative(), monitored: z.number().int().nonnegative(), unmonitored: z.number().int().nonnegative(),
  issues: z.number().int().nonnegative(), downloaded_issues: z.number().int().nonnegative(),
  missing_monitored: z.number().int().nonnegative(), upcoming_monitored: z.number().int().nonnegative(),
  unmonitored_issues: z.number().int().nonnegative(), failed_downloads: z.number().int().nonnegative(),
  active_downloads: z.number().int().nonnegative(), mismatches: z.number().int().nonnegative(),
  files: z.number().int().nonnegative().optional(), total_file_size: z.number().nonnegative().optional(),
});
const rawVolumeEntrySchema = z.object({ id: z.number().int(), title: z.string(), year: z.number().nullable(), publisher: z.string().nullable(), issue_count: z.number().int(), issues_downloaded: z.number().int() });
const volumePageSchema = z.object({
  items: z.array(rawVolumeEntrySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
});
const queueEntrySchema = z.object({ id: z.number().int() }).passthrough();
const searchProgressSchema = z.object({
  processed_count: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().nullable().optional(),
  phase: z.string().nullable().optional(),
  eta_seconds: z.number().int().nonnegative().nullable().optional(),
  elapsed_seconds: z.number().int().nonnegative().nullable().optional(),
  last_progress_at: z.number().nullable().optional(),
  seconds_since_progress: z.number().int().nonnegative().nullable().optional(),
}).passthrough();
const activeSearchTaskSchema = z.object({
  id: z.number().int(),
  action: z.enum(['auto_search', 'auto_search_issue', 'search_all']),
  display_title: z.string(),
  status: z.string(),
  message: z.string().nullable().optional(),
  volume_id: z.number().int().nullable().optional(),
  volume_title: z.string().nullable().optional(),
  issue_id: z.number().int().nullable().optional(),
  issue_number: z.number().nullable().optional(),
  queued_at: z.number().nullable().optional(),
  started_at: z.number().nullable().optional(),
  progress: searchProgressSchema.optional(),
});
const systemTaskSchema = z.object({
  id: z.number().int(),
  action: z.string(),
  display_title: z.string(),
  status: z.string(),
}).passthrough();

interface RawHistoryEntry {
  web_title: string | null;
  web_sub_title: string | null;
  file_title: string | null;
  source: string | null;
  source_name: string | null;
  downloaded_at: number;
  success: boolean | null;
}

interface HistoryEntry {
  id: number;
  title: string;
  source: string;
  downloaded_at: number;
  state: string;
}

export function navBadgesQueryOptions() {
  return queryOptions({
    queryKey: ['nav', 'badges'],
    queryFn: () => apiClient.get('nav/badges').then((r) => readJson<NavBadges>(r)),
    staleTime: 10_000,
  });
}

export function comicStatsQueryOptions() {
  return queryOptions({
    queryKey: ['volumes', 'stats', 'comic'],
    queryFn: () =>
      apiClient
        .get('volumes/stats', { searchParams: { section: 'comic' } })
        .then((r) => readJson(r, volumeStatsSchema)),
    staleTime: 30_000,
  });
}

export function mangaStatsQueryOptions() {
  return queryOptions({
    queryKey: ['volumes', 'stats', 'manga'],
    queryFn: () =>
      apiClient
        .get('volumes/stats', { searchParams: { section: 'manga' } })
        .then((r) => readJson(r, volumeStatsSchema)),
    staleTime: 30_000,
  });
}

export function recentlyAddedQueryOptions(section: 'comic' | 'manga') {
  return queryOptions({
    queryKey: ['volumes', 'recently-added', section],
    queryFn: async () => {
      const params: Record<string, string> = {
        sort: 'recently_added',
        paginated: 'true',
        offset: '0',
        limit: '6',
      };
      if (section === 'manga') params.section = 'manga';
      const r = await apiClient.get('volumes', { searchParams: params });
      const data = await readJson(r, volumePageSchema);
      return data.items.map(
          (v): VolumeCard => ({ ...v, section: section === 'manga' ? 'manga' : 'comics' }),
        );
    },
    staleTime: 30_000,
  });
}

export function dashboardActiveSearchesQueryOptions() {
  return queryOptions({
    queryKey: ['system', 'tasks', 'dashboard', 'active-searches'],
    queryFn: async (): Promise<DashboardSearchTask[]> => {
      const r = await apiClient.get('system/tasks', { timeout: 60_000 });
      const tasks = await readJson(r, z.array(systemTaskSchema));
      return tasks
        .filter((task) => ['auto_search', 'auto_search_issue', 'search_all'].includes(task.action))
        .map((task) => activeSearchTaskSchema.parse(task));
    },
    staleTime: 5_000,
  });
}

export function dashboardQueueQueryOptions() {
  return queryOptions({
    queryKey: ['activity', 'queue', 'dashboard'],
    queryFn: () => apiClient.get('activity/queue').then((r) => readJson(r, z.array(queueEntrySchema))),
    staleTime: 5_000,
  });
}

export function dashboardHistoryQueryOptions() {
  return queryOptions({
    queryKey: ['activity', 'history', 'dashboard'],
    queryFn: async () => {
      const sp = new URLSearchParams({ offset: '0' });
      const r = await apiClient.get('activity/history', { searchParams: sp });
      const data = await readJson<RawHistoryEntry[]>(r);
      const entries: HistoryEntry[] = (Array.isArray(data) ? data : []).map(
        (raw, idx): HistoryEntry => ({
          id: idx + 1,
          title: raw.web_title || raw.file_title || raw.web_sub_title || raw.source || 'Unknown',
          source: raw.source_name || raw.source || '',
          downloaded_at: raw.downloaded_at * 1000,
          state: raw.success === true ? 'downloaded' : raw.success === false ? 'failed' : 'cancelled',
        }),
      );
      return { entries, total: entries.length, page_size: 50 };
    },
    staleTime: 30_000,
  });
}
