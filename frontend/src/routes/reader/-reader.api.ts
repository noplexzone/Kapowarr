import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson, getUrlBase } from '@/app/api-client';
import type { FileInfo } from './-reader.types';

export function fileInfoQueryOptions(fileId: number) {
  return queryOptions({
    queryKey: ['file', 'info', fileId],
    queryFn: () => fetchFileInfo(fileId),
    staleTime: 60_000,
    enabled: fileId > 0,
  });
}

async function fetchFileInfo(fileId: number): Promise<FileInfo> {
  const response = await apiClient.get(`files/${fileId}/info`);
  return readJson<FileInfo>(response);
}

export function pageUrl(fileId: number, page: number): string {
  return `${getUrlBase()}/api/files/${fileId}/page/${page}`;
}

export function rawFileUrl(fileId: number): string {
  return `${getUrlBase()}/api/files/${fileId}/raw`;
}
