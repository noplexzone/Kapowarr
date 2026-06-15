import { apiClient } from '@/app/api-client';
import type { MismatchItem, MismatchSelection } from './-mismatch.types';

export interface BackendVolume {
  id: number;
  comicvine_id: number;
  title: string;
  year: number;
  publisher: string;
  folder: string;
  issue_count: number;
  issues_downloaded: number;
  monitored: boolean;
}

function isMismatch(folder: string, title: string): boolean {
  if (!folder || !title) return false;
  const parts = folder.replace(/\\/g, '/').split('/');
  const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || '';
  const nf = folderBase.toLowerCase()
    .replace(/\(\d{4}\)/g, '').replace(/[:\\*?"<>|,]/g, '')
    .replace(/'/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nt = title.toLowerCase()
    .replace(/\(\d{4}\)/g, '').replace(/[:\\*?"<>|,]/g, '')
    .replace(/'/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!nf || !nt) return false;
  return !nf.includes(nt) && !nt.includes(nf);
}

const FOREIGN_SIGNALS = [
  'verlag', 'deutschland', 'deutsch', 'gmbh',
  'éditions', 'editeur', 'française',
  'editore', 'edizioni', 'planeta',
  'carlsen', 'egmont ehapa', 'splitter', 'cross cult',
  'glenat', 'glénat',
];

function isForeignPublisher(publisher: string): boolean {
  if (!publisher) return false;
  const p = publisher.toLowerCase();
  return FOREIGN_SIGNALS.some(sig => p.includes(sig));
}

export async function* scanMismatch(
  _section: 'comic' | 'manga',
): AsyncGenerator<MismatchItem> {
  // Fetch all volumes from /volumes endpoint and filter for mismatches
  // client-side, matching the old folder_check.js approach.
  const response = await apiClient.get('volumes', {
    searchParams: { section: _section },
  });
  const raw = await response.json() as { error: string | null; result: BackendVolume[] };
  const volumes = raw.result ?? [];

  for (const v of volumes) {
    const nameMismatch = isMismatch(v.folder, v.title);
    const langFlag = isForeignPublisher(v.publisher);
    if (nameMismatch || langFlag) {
      yield {
        folder: v.folder,
        file_title: v.title,
        issue_count: v.issue_count ?? 0,
        cv_id: v.comicvine_id,
        status: nameMismatch ? ('unmatched' as const) : ('unknown' as const),
      };
    }
  }
}

export async function matchItems(items: MismatchSelection[]): Promise<void> {
  await apiClient.post('libraryimport/bulk', { json: items });
}

export async function deleteFolders(folders: string[]): Promise<void> {
  await apiClient.post('libraryimport/delete', { json: { folders } });
}
