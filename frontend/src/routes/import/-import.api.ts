import { apiClient, getUrlBase } from '@/app/api-client';
import type { BulkScanItem, ImportSelection } from './-import.types';

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
      if (trimmed) {
        yield JSON.parse(trimmed) as BulkScanItem;
      }
    }
  }

  if (buffer.trim()) {
    yield JSON.parse(buffer) as BulkScanItem;
  }
}

export async function importSelected(items: ImportSelection[]): Promise<void> {
  await apiClient.post('libraryimport/bulk', { json: items });
}

export async function deleteUnmatched(folders: string[]): Promise<void> {
  await apiClient.post('libraryimport/delete', { json: { folders } });
}
