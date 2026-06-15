import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { NavBadges, VolumeStats } from './-dashboard.types';
import type { HistoryEntry } from '../activity/history/-history.types';
import type { QueueEntry } from '../activity/queue/-queue.types';
import type { SystemTask } from '../system/-system.types';

export function navBadgesQueryOptions() {
  return queryOptions({
    queryKey: ['nav', 'badges'],
    queryFn: () => apiClient.get('nav/badges').then((r) => readJson<NavBadges>(r)),
    staleTime: 10_000,
  });
}

export function volumeStatsQueryOptions() {
  return queryOptions({
    queryKey: ['volumes', 'stats'],
    queryFn: () => apiClient.get('volumes/stats').then((r) => readJson<VolumeStats>(r)),
    staleTime: 30_000,
  });
}

export function dashboardQueueQueryOptions() {
  return queryOptions({
    queryKey: ['activity', 'queue', 'dashboard'],
    queryFn: () => apiClient.get('activity/queue').then((r) => readJson<QueueEntry[]>(r)),
    staleTime: 5_000,
  });
}

export function dashboardHistoryQueryOptions() {
  return queryOptions({
    queryKey: ['activity', 'history', 'dashboard'],
    queryFn: async () => {
      const sp = new URLSearchParams({ offset: '0' });
      const r = await apiClient.get('activity/history', { searchParams: sp });
      // Backend returns a raw array; wrap it.
      const data = await readJson<HistoryEntry[]>(r);
      return { entries: data, total: Array.isArray(data) ? data.length : 0, page_size: 50 };
    },
    staleTime: 30_000,
  });
}

export function dashboardTasksQueryOptions() {
  return queryOptions({
    queryKey: ['system', 'tasks', 'dashboard'],
    queryFn: () => apiClient.get('system/tasks').then((r) => readJson<SystemTask[]>(r)),
    staleTime: 15_000,
  });
}
