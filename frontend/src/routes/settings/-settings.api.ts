import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { AllSettings, NZBIndexer, ExternalClient, ClientOption, RemoteMapping, SuwayomiSource } from './-settings.types';

export const SETTINGS_KEY = ['settings'] as const;

export function settingsQueryOptions() {
  return queryOptions({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiClient.get('settings').then(res => readJson<AllSettings>(res)),
    staleTime: 30_000,
  });
}

export async function updateSettings(data: Partial<AllSettings>): Promise<void> {
  const response = await apiClient.put('settings', { json: data });
  await readJson<unknown>(response);
}

export async function resetKeys(keys: string[]): Promise<void> {
  const response = await apiClient.delete('settings', { json: { reset_keys: keys } });
  await readJson<unknown>(response);
}

export const SUWAYOMI_SOURCES_KEY = ['suwayomi-sources'] as const;

export function suwayomiSourcesQueryOptions() {
  return queryOptions({
    queryKey: SUWAYOMI_SOURCES_KEY,
    queryFn: () => apiClient.get('settings/suwayomi/sources').then(res => readJson<{ sources: SuwayomiSource[] }>(res)),
    staleTime: 60_000,
  });
}

// NZB Indexers
export const NZB_INDEXERS_KEY = ['nzb-indexers'] as const;

export function nzbIndexersQueryOptions() {
  return queryOptions({
    queryKey: NZB_INDEXERS_KEY,
    queryFn: () => apiClient.get('nzbindexers').then(res => readJson<NZBIndexer[]>(res)),
    staleTime: 30_000,
  });
}

export async function addNzbIndexer(data: Partial<NZBIndexer>): Promise<NZBIndexer> {
  return apiClient.post('nzbindexers', { json: data }).then(res => readJson<NZBIndexer>(res));
}

export async function updateNzbIndexer(id: number, data: Partial<NZBIndexer>): Promise<NZBIndexer> {
  return apiClient.put(`nzbindexers/${id}`, { json: data }).then(res => readJson<NZBIndexer>(res));
}

export async function deleteNzbIndexer(id: number): Promise<void> {
  const response = await apiClient.delete(`nzbindexers/${id}`);
  await readJson<unknown>(response);
}

export async function testNzbIndexer(base_url: string, api_key: string): Promise<{success: boolean; description: string | null}> {
  return apiClient.post('nzbindexers/test', { json: { base_url, api_key } }).then(res => readJson<{success: boolean; description: string | null}>(res));
}

// External Download Clients
export const CLIENTS_KEY = ['external-clients'] as const;
export const CLIENT_OPTIONS_KEY = ['client-options'] as const;

export function externalClientsQueryOptions() {
  return queryOptions({
    queryKey: CLIENTS_KEY,
    queryFn: () => apiClient.get('externalclients').then(res => readJson<ExternalClient[]>(res)),
    staleTime: 30_000,
  });
}

export function clientOptionsQueryOptions() {
  return queryOptions({
    queryKey: CLIENT_OPTIONS_KEY,
    queryFn: () => apiClient.get('externalclients/options').then(res => readJson<Record<string, ClientOption>>(res)),
    staleTime: 300_000,
  });
}

export async function addExternalClient(data: Partial<ExternalClient> & {client_type: string}): Promise<ExternalClient> {
  return apiClient.post('externalclients', { json: data }).then(res => readJson<ExternalClient>(res));
}

export async function updateExternalClient(id: number, data: Partial<ExternalClient>): Promise<ExternalClient> {
  return apiClient.put(`externalclients/${id}`, { json: data }).then(res => readJson<ExternalClient>(res));
}

export async function deleteExternalClient(id: number): Promise<void> {
  const response = await apiClient.delete(`externalclients/${id}`);
  await readJson<unknown>(response);
}

export async function testExternalClient(data: {client_type: string; base_url: string; username?: string; password?: string; api_token?: string}): Promise<{success: boolean; description: string | null}> {
  return apiClient.post('externalclients/test', { json: data }).then(res => readJson<{success: boolean; description: string | null}>(res));
}

// Remote Path Mappings
export const REMOTE_MAPPINGS_KEY = ['remote-mappings'] as const;

export function remoteMappingsQueryOptions() {
  return queryOptions({
    queryKey: REMOTE_MAPPINGS_KEY,
    queryFn: () => apiClient.get('remotemapping').then(res => readJson<RemoteMapping[]>(res)),
    staleTime: 30_000,
  });
}

export async function addRemoteMapping(data: {external_download_client_id: number; remote_path: string; local_path: string}): Promise<RemoteMapping> {
  return apiClient.post('remotemapping', { json: data }).then(res => readJson<RemoteMapping>(res));
}

export async function updateRemoteMapping(id: number, data: Partial<RemoteMapping>): Promise<RemoteMapping> {
  return apiClient.put(`remotemapping/${id}`, { json: data }).then(res => readJson<RemoteMapping>(res));
}

export async function deleteRemoteMapping(id: number): Promise<void> {
  const response = await apiClient.delete(`remotemapping/${id}`);
  await readJson<unknown>(response);
}

// Root Folders
export const ROOT_FOLDERS_KEY = ['root-folders'] as const;

export interface RootFolder {
  id: number;
  folder: string;
  section: string;
  free_space: number | null;
  total_space: number | null;
}

export function rootFoldersQueryOptions() {
  return queryOptions({
    queryKey: ROOT_FOLDERS_KEY,
    queryFn: () => apiClient.get('rootfolder').then(res => readJson<RootFolder[]>(res)),
    staleTime: 30_000,
  });
}

export async function addRootFolder(folder: string, section: string): Promise<RootFolder> {
  return apiClient.post('rootfolder', { json: { folder, section } }).then(res => readJson<RootFolder>(res));
}

export async function updateRootFolder(id: number, data: Partial<{ folder: string; section: string }>): Promise<void> {
  const response = await apiClient.put(`rootfolder/${id}`, { json: data });
  await readJson<unknown>(response);
}

export async function deleteRootFolder(id: number): Promise<void> {
  const response = await apiClient.delete(`rootfolder/${id}`);
  await readJson<unknown>(response);
}
