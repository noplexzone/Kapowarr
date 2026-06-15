import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson, getUrlBase } from '@/app/api-client';
import type { SystemAbout, SystemTask } from './-system.types';

export const SYSTEM_ABOUT_KEY = ['system', 'about'] as const;
export const SYSTEM_TASKS_KEY = ['system', 'tasks'] as const;

export function systemAboutQueryOptions() {
  return queryOptions({
    queryKey: SYSTEM_ABOUT_KEY,
    queryFn: () => apiClient.get('system/about').then(res => readJson<SystemAbout>(res)),
    staleTime: 60_000,
  });
}

export function systemTasksQueryOptions() {
  return queryOptions({
    queryKey: SYSTEM_TASKS_KEY,
    queryFn: () => apiClient.get('system/tasks').then(res => readJson<SystemTask[]>(res)),
    staleTime: 0,
  });
}

export async function cancelTask(id: number): Promise<void> {
  await apiClient.delete(`system/tasks/${id}`);
}

export async function downloadLogs(): Promise<void> {
  const base = getUrlBase();
  const apiKey = localStorage.getItem('kapowarr_api_key') ?? '';
  const response = await fetch(`${base}/api/system/logs`, {
    headers: apiKey ? { 'X-Api-Key': apiKey } : {},
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kapowarr.log';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
