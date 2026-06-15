import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { NavBadges, VolumeStats, VolumeCard } from './-dashboard.types';

interface RawVolumeEntry {
  id: number;
  title: string;
  year: number | null;
  publisher: string | null;
  issue_count: number;
  issues_downloaded: number;
}

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
        .then((r) => readJson<VolumeStats>(r)),
    staleTime: 30_000,
  });
}

export function mangaStatsQueryOptions() {
  return queryOptions({
    queryKey: ['volumes', 'stats', 'manga'],
    queryFn: () =>
      apiClient
        .get('volumes/stats', { searchParams: { section: 'manga' } })
        .then((r) => readJson<VolumeStats>(r)),
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
      const data = await readJson<RawVolumeEntry[]>(r);
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
    queryFn: () => apiClient.get('activity/queue').then((r) => readJson<unknown[]>(r)),
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
