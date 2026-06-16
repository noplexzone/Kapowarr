import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type {
  VolumeDetailFull,
  ManualSearchResult,
  IssueHistoryEntry,
  RootFolder,
  ComicVineSearchResult,
  RenameEntry,
  IssueData,
  FileMatch,
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
  const raw = await readJson<Record<string, any>>(response);
  return toVolumeDetailFull(raw);
}

/** Transform raw backend volume detail into the SPA's VolumeDetailFull shape. */
function toVolumeDetailFull(raw: Record<string, any>): VolumeDetailFull {
  return {
    id: raw.id,
    comicvine_id: raw.comicvine_id,
    title: raw.title ?? '',
    year: raw.year ?? 0,
    publisher: raw.publisher ?? '',
    volume_number: raw.volume_number ?? 0,
    special_version: raw.special_version ?? '',
    section: raw.section ?? 'comic',
    description: raw.description ?? undefined,
    site_url: raw.site_url ?? undefined,
    monitored: Boolean(raw.monitored),
    monitor_new_issues: Boolean(raw.monitor_new_issues),
    folder: raw.folder ?? '',
    root_folder: raw.root_folder ?? 0,
    root_folder_path: raw.root_folder_path ?? '',
    issue_count: raw.issue_count ?? 0,
    issues_downloaded: raw.issues_downloaded ?? 0,
    cover: raw.cover ?? undefined,
    issues: Array.isArray(raw.issues)
      ? raw.issues.map((i: Record<string, any>) => ({
          id: i.id,
          issue_number: String(i.issue_number ?? ''),
          title: i.title ?? undefined,
          release_date: i.date ?? i.release_date ?? undefined,
          monitored: Boolean(i.monitored),
          downloaded: Boolean(
            Array.isArray(i.files) ? i.files.length > 0 : i.downloaded ?? false,
          ),
          size:
            typeof i.size === 'number' && i.size > 0
              ? i.size
              : Array.isArray(i.files)
                ? i.files.reduce((sum: number, f: any) => sum + (f.size ?? 0), 0)
                : 0,
          issue_folder: i.issue_folder ?? undefined,
          file_ids: Array.isArray(i.files)
            ? i.files.map((f: any) => f.id)
            : [],
          filenames: Array.isArray(i.files)
            ? i.files.map((f: any) => {
                const path: string = f.filepath ?? '';
                return path.split(/[/\\]/).pop() || path;
              })
            : [],
        }))
      : [],
  };
}

export async function deleteVolume(id: number): Promise<void> {
  await apiClient.delete(`volumes/${id}`);
}

export async function autoSearchVolume(
  id: number,
): Promise<{ id: number }> {
  const response = await apiClient.post('system/tasks', {
    json: { cmd: 'auto_search', volume_id: id },
  });
  return readJson<{ id: number }>(response);
}

export async function manualSearchVolume(
  id: number,
): Promise<ManualSearchResult[]> {
  const response = await apiClient.get(`volumes/${id}/manualsearch`, {
    timeout: 60000,
  });
  return readJson<ManualSearchResult[]>(response);
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
  const response = await apiClient.get(`issues/${issueId}/manualsearch`, {
    timeout: 60000,
  });
  return readJson<ManualSearchResult[]>(response);
}

export async function deleteIssue(issueId: number): Promise<void> {
  await apiClient.delete(`issues/${issueId}`);
}

export async function forceMatchIssue(
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

export async function downloadVolume(
  volumeId: number,
  link: string,
  displayTitle: string,
): Promise<{ result: number | null; fail_reason: string | null }> {
  const response = await apiClient.post(`volumes/${volumeId}/download`, {
    json: { link, force_match: false, display_title: displayTitle },
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

export async function fetchRenamePreview(
  volumeId: number,
): Promise<RenameEntry[]> {
  const response = await apiClient.get(`volumes/${volumeId}/rename`);
  const data = await readJson<Record<string, string>>(response);
  return Object.entries(data).map(([before, after]) => ({ before, after }));
}

export async function submitRename(
  volumeId: number,
  filepaths: string[],
): Promise<{ id: number }> {
  const response = await apiClient.post('system/tasks', {
    json: {
      cmd: 'mass_rename',
      volume_id: volumeId,
      filepath_filter: filepaths,
    },
  });
  return readJson<{ id: number }>(response);
}

// ── Issue management ──────────────────────────────────────────

export async function fetchIssueData(issueId: number): Promise<IssueData> {
  const response = await apiClient.get(`issues/${issueId}`);
  return readJson<IssueData>(response);
}

export async function fetchManualMatch(
  volumeId: number,
): Promise<FileMatch[]> {
  const response = await apiClient.get(`volumes/${volumeId}/manualmatch`);
  return readJson<FileMatch[]>(response);
}

export async function submitManualMatch(
  volumeId: number,
  matches: FileMatch[],
): Promise<void> {
  await apiClient.put(`volumes/${volumeId}/manualmatch`, { json: matches });
}

export async function deleteFile(fileId: number): Promise<void> {
  await apiClient.delete(`files/${fileId}`);
}
