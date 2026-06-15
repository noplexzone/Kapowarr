import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { AllSettings } from './-settings.types';

export const SETTINGS_KEY = ['settings'] as const;

export function settingsQueryOptions() {
  return queryOptions({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiClient.get('settings').then(res => readJson<AllSettings>(res)),
    staleTime: 30_000,
  });
}

export async function updateSettings(data: Partial<AllSettings>): Promise<void> {
  await apiClient.put('settings', { json: data });
}

export async function resetKeys(keys: string[]): Promise<void> {
  await apiClient.delete('settings', { json: { reset_keys: keys } });
}
