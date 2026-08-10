import { apiClient, getUrlBase, readJson } from '@/app/api-client';
import type { BulkScanItem, ImportSelection } from './-import.types';

interface BulkScanWireItem {
  folder: unknown;
  file_title: unknown;
  cv_id: unknown;
  id_type?: unknown;
  match_type?: unknown;
}

function normalizeScanEvent(value: unknown): BulkScanItem | null {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid library-import scan event');
  }

  const event = value as Record<string, unknown>;
  if (event.type === 'status') return null;
  if ('type' in event) throw new Error('Invalid library-import scan event type');

  const item = event as unknown as BulkScanWireItem;
  if (typeof item.folder !== 'string' || item.folder.length === 0) {
    throw new Error('Invalid folder in library-import scan result');
  }
  if (typeof item.file_title !== 'string' || item.file_title.length === 0) {
    throw new Error('Invalid file_title in library-import scan result');
  }
  if (item.cv_id !== null && (!Number.isInteger(item.cv_id) || (item.cv_id as number) <= 0)) {
    throw new Error('Invalid cv_id in library-import scan result');
  }
  if (item.id_type !== undefined && item.id_type !== null && typeof item.id_type !== 'string') {
    throw new Error('Invalid id_type in library-import scan result');
  }
  if (
    item.match_type !== undefined
    && item.match_type !== null
    && item.match_type !== 'comicinfo'
    && item.match_type !== 'title'
  ) {
    throw new Error('Invalid match_type in library-import scan result');
  }

  const idType = (item.id_type as string | null | undefined) ?? null;
  const matchType = (item.match_type as BulkScanItem['match_type'] | undefined) ?? null;
  const matched = item.cv_id !== null;
  if (matched ? idType === null || matchType === null : idType !== null || matchType !== null) {
    throw new Error('Inconsistent match classification in library-import scan result');
  }

  return {
    folder: item.folder,
    file_title: item.file_title,
    ...(matched ? { cv_id: item.cv_id as number } : {}),
    id_type: idType,
    match_type: matchType,
    matched,
  };
}

function parseScanLine(line: string): BulkScanItem | null {
  return normalizeScanEvent(JSON.parse(line) as unknown);
}

export async function* scanBulk(
  folderFilter = '',
  fuzzyFallback = false,
  quick = false,
): AsyncGenerator<BulkScanItem> {
  const base = getUrlBase();
  const apiKey = localStorage.getItem('kapowarr_api_key') ?? '';
  const params = new URLSearchParams({
    folder_filter: folderFilter,
    fuzzy_fallback: String(fuzzyFallback),
    quick: String(quick),
  });

  const response = await fetch(`${base}/api/libraryimport/bulk?${params}`, {
    headers: apiKey ? { 'X-Api-Key': apiKey } : {},
  });

  if (!response.ok || !response.body) {
    throw new Error(`Scan failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const item = parseScanLine(trimmed);
      if (item) yield item;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const item = parseScanLine(buffer);
    if (item) yield item;
  }
}

export async function importSelected(items: ImportSelection[]): Promise<void> {
  await apiClient.post('libraryimport/bulk', { json: items });
}

export async function deleteUnmatched(folders: string[]): Promise<void> {
  const response = await apiClient.post('libraryimport/delete', { json: folders });
  await readJson<unknown>(response);
}
