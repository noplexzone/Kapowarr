import { apiClient, getUrlBase } from '@/app/api-client';
import type { MismatchItem, MismatchSelection } from './-mismatch.types';

const API_KEY_STORAGE_KEY = 'kapowarr_api_key';

export async function* scanMismatch(
  section: 'comic' | 'manga',
): AsyncGenerator<MismatchItem> {
  const base = getUrlBase();
  const apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  const params = new URLSearchParams({
    folder_filter: '',
    quick: 'true',
    section,
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
        yield JSON.parse(trimmed) as MismatchItem;
      }
    }
  }

  if (buffer.trim()) {
    yield JSON.parse(buffer) as MismatchItem;
  }
}

export async function matchItems(items: MismatchSelection[]): Promise<void> {
  await apiClient.post('libraryimport/bulk', { json: items });
}

export async function deleteFolders(folders: string[]): Promise<void> {
  await apiClient.post('libraryimport/delete', { json: { folders } });
}
