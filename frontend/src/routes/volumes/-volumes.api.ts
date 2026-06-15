import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type {
  VolumeDetailFull,
  ManualSearchResult,
  IssueHistoryEntry,
  RootFolder,
  ComicVineSearchResult,
} from './-volumes.types';

export const VOLUME_FULL_KEY = (id: number) =>
  ['volumes', 'full', id] as const;

export function volumeDetailFullQueryOptions(id: number) {
  return queryOptions({
    queryKey: VOLUME_FULL_KEY(id),
    queryFn: () => fetchVolumeDetailFull(id),
    staleTime: 30_000,
    enabled: id > 0,
  });
}

async function fetchVolumeDetailFull(id: number): Promise<VolumeDetailFull> {
  const response = await apiClient.get(`volumes/${id}`);
  return readJson<VolumeDetailFull>(response);
}

export async function deleteVolume(id: number): Promise<void> {
  await apiClient.delete(`volumes/${id}`);
}

export async function autoSearchVolume(id: number): Promise<void> {
  await apiClient.post(`volumes/${id}/download`);
}

export async function manualSearchVolume(id: number): Promise<void> {
  await apiClient.post(`volumes/${id}/manualsearch`);
}

// ── Per-issue actions ─────────────────────────────────────────────

export async function autoSearchIssue(
  volumeId: number,
  issueId: number,
): Promise<{ id: number }> {
  const response = await apiClient.post('system/tasks', {
    json: {
      cmd: 'auto_search_issue',
      volume_id: volumeId,
      issue_id: issueId,
    },
  });
  return readJson<{ id: number }>(response);
}

export async function manualSearchIssue(
  issueId: number,
): Promise<ManualSearchResult[]> {
  const response = await apiClient.get(`issues/${issueId}/manualsearch`);
  return readJson<ManualSearchResult[]>(response);
}

export async function fetchIssueHistory(
  issueId: number,
): Promise<IssueHistoryEntry[]> {
  const response = await apiClient.get('activity/history', {
    searchParams: { issue_id: issueId },
  });
  return readJson<IssueHistoryEntry[]>(response);
}

export async function downloadIssue(
  issueId: number,
  link: string,
  forceMatch: boolean,
  displayTitle: string,
): Promise<{ result: number | null; fail_reason: string | null }> {
  const response = await apiClient.post(`issues/${issueId}/download`, {
    json: { link, force_match: forceMatch, display_title: displayTitle },
  });
  return readJson<{ result: number | null; fail_reason: string | null }>(
    response,
  );
}

export async function addToBlocklist(
  link: string,
  displayTitle: string,
  volumeId: number,
  issueId: number | null,
): Promise<void> {
  await apiClient.post('blocklist', {
    json: {
      link,
      display_title: displayTitle,
      volume_id: volumeId,
      issue_id: issueId,
    },
  });
}

// ── Volume settings / Edit ──────────────────────────────────────

export async function updateVolume(
  id: number,
  data: Record<string, unknown>,
): Promise<void> {
  await apiClient.put(`volumes/${id}`, { json: data });
}

export async function fetchRootFolders(): Promise<RootFolder[]> {
  const response = await apiClient.get('rootfolder');
  return readJson<RootFolder[]>(response);
}

// ── Fix Match / ComicVine search ────────────────────────────────

export async function searchVolumes(
  query: string,
): Promise<ComicVineSearchResult[]> {
  const response = await apiClient.get('volumes/search', {
    searchParams: { query, section: 'comic' },
  });
  return readJson<ComicVineSearchResult[]>(response);
}

export async function rematchVolume(
  id: number,
  comicvineId: number,
  newTitle: string | null,
): Promise<{ task_id: number }> {
  const response = await apiClient.put(`volumes/${id}/rematch`, {
    json: { comicvine_id: comicvineId, new_title: newTitle },
  });
  return readJson<{ task_id: number }>(response);
}

// ── Volume tasks ─────────────────────────────────────────────────

export async function refreshVolume(volumeId: number): Promise<{ id: number }> {
  const response = await apiClient.post('system/tasks', {
    json: { cmd: 'refresh_and_scan', volume_id: volumeId },
  });
  return readJson<{ id: number }>(response);
}
