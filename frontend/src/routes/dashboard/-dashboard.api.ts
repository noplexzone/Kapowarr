import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import type { NavBadges, VolumeCard } from './-dashboard.types';

const volumeStatsSchema = z.object({
  volumes: z.number().int().nonnegative(), monitored: z.number().int().nonnegative(), unmonitored: z.number().int().nonnegative(),
  issues: z.number().int().nonnegative(), downloaded_issues: z.number().int().nonnegative(),
  missing_monitored: z.number().int().nonnegative(), upcoming_monitored: z.number().int().nonnegative(),
  unmonitored_issues: z.number().int().nonnegative(), failed_downloads: z.number().int().nonnegative(),
  active_downloads: z.number().int().nonnegative(), import_problems: z.number().int().nonnegative(),
  files: z.number().int().nonnegative().optional(), total_file_size: z.number().nonnegative().optional(),
});
const rawVolumeEntrySchema = z.object({ id: z.number().int(), title: z.string(), year: z.number().nullable(), publisher: z.string().nullable(), issue_count: z.number().int(), issues_downloaded: z.number().int() });
const queueEntrySchema = z.object({ id: z.number().int() }).passthrough();

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
      const params: Record<string, string> = { sort: 'recently_added' };
      if (section === 'manga') params.section = 'manga';
      const r = await apiClient.get('volumes', { searchParams: params });
      const data = await readJson(r, z.array(rawVolumeEntrySchema));
      return (Array.isArray(data) ? data : [])
        .slice(0, 6)
        .map(
          (v): VolumeCard => ({ ...v, section: section === 'manga' ? 'manga' : 'comics' }),
        );
    },
    staleTime: 30_000,
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
