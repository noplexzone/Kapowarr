import { useState } from 'react';
import { useQuery, useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button, Badge } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import {
  exactVolumeQueryOptions,
  rootFoldersQueryOptions,
  addVolume,
  type AddVolumePayload,
} from '../-add.api';
import type { SearchResult } from '../-add.types';
import { getUrlBase } from '@/app/api-client';
import styles from '@/routes/discovery/-ui/discovery-page.module.css';

export interface AddSelection { metadata_source: 'comicvine' | 'mangadex'; metadata_id: string; title?: string; metadata_language?: string }
function proxiedMangaDexCover(url: string): string {
  const base = getUrlBase().replace(/\/$/, '');
  return `${base}/api/mangadex/cover-proxy?url=${encodeURIComponent(url)}`;
}

function getCoverSrc(result: SearchResult): string | null {
  if (result.cover_link) {
    if (/^https:\/\/uploads\.mangadex\.org\/covers\//i.test(result.cover_link)) {
      return proxiedMangaDexCover(result.cover_link);
    }
    return result.cover_link;
  }
  if (result.cover_url) {
    if (/^https:\/\/uploads\.mangadex\.org\/covers\//i.test(result.cover_url)) {
      return proxiedMangaDexCover(result.cover_url);
    }
    if (/^https?:\/\//i.test(result.cover_url)) return result.cover_url;
    const base = getUrlBase();
    return `${base}/api/${result.cover_url.replace(/^\/+/, '')}`;
  }
  return null;
}

export function ExactAddReview({ section, selection, searchFallbackTo = '/add' }: { section: 'comic' | 'manga'; selection: AddSelection; searchFallbackTo?: '/add' | '/discover/search' }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rootFolders = [] } = useSuspenseQuery(rootFoldersQueryOptions());
  const exact = useQuery(exactVolumeQueryOptions(selection, section));

  if (exact.isPending) return <div className={styles.empty} role="status">Loading {selection.title ?? selection.metadata_id} from {selection.metadata_source}…</div>;
  if (exact.isError) return <div className={styles.empty} role="alert">
    <h1>Could not load {selection.title ?? 'selected item'}</h1>
    <p>Provider: {selection.metadata_source}</p>
    <p>Metadata ID: {selection.metadata_id}</p>
    <p>{exact.error.message}</p>
    <Button onClick={() => void exact.refetch()}>Retry</Button>
    {selection.title && <Button variant="secondary" onClick={() => navigate(searchFallbackTo === '/discover/search' ? { to: '/discover/search', search: { section, q: selection.title } } : { to: '/add', search: { section, title: selection.title } })}>Search by title instead</Button>}
  </div>;
  const result = exact.data;
  const existingId = result.id ?? result.already_added;
  if (existingId != null) return <div className={styles.empty}><Badge tone="success">In Library</Badge><Button onClick={() => navigate({ to: '/volumes/$volumeId', params: { volumeId: String(existingId) } })}>Open Volume</Button></div>;
  return <div className={styles.page} data-testid="exact-add-review">
    <AddModal result={{ ...result, metadata_language: selection.metadata_language ?? result.metadata_language }} rootFolders={rootFolders} section={section} onClose={() => history.back()} onAdded={(id) => {
      void queryClient.invalidateQueries({ queryKey: ['volumes', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate({ to: '/volumes/$volumeId', params: { volumeId: String(id) } });
    }} />
  </div>;
}

const MONITORING_SCHEMES = [
  { value: 'all', label: 'All Issues' },
  { value: 'missing', label: 'Missing Only' },
  { value: 'none', label: 'None' },
];

const SPECIAL_VERSION_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'tpb', label: 'TPB' },
  { value: 'one_shot', label: 'One-Shot' },
  { value: 'hard_cover', label: 'Hard Cover' },
  { value: 'epic_collection', label: 'Epic Collection' },
];

interface AddModalProps {
  result: SearchResult;
  rootFolders: { id: number; folder: string; section: 'comic' | 'manga' }[];
  section: 'comic' | 'manga';
  onClose: () => void;
  onAdded: (id: number) => void;
}

export function AddModal({ result, rootFolders, section, onClose, onAdded }: AddModalProps) {
  const sectionRootFolders = rootFolders.filter((rf) => rf.section === section);
  const defaultFolder = sectionRootFolders[0]?.id ?? 0;

  const defaultVolumeFolder = result.metadata_source === 'mangadex' && result.year
    ? `${result.title} (${result.year})`
    : result.title;

  const [rootFolderId, setRootFolderId] = useState(defaultFolder);
  const [volumeFolder, setVolumeFolder] = useState(defaultVolumeFolder.replace(/[/\\:*?"<>|]/g, ''));
  const [monitorVolume, setMonitorVolume] = useState(true);
  const [monitorIssues, setMonitorIssues] = useState(true);
  const [monitoringScheme, setMonitoringScheme] = useState('all');
  const [specialVersion, setSpecialVersion] = useState('');
  const [metadataLanguage, setMetadataLanguage] = useState(
    result.metadata_language ?? result.available_languages?.[0] ?? 'en'
  );
  const [autoSearch, setAutoSearch] = useState(true);

  const mutation = useMutation({
    mutationFn: (payload: AddVolumePayload) => addVolume(payload),
    onSuccess: (data) => onAdded(data.id),
  });

  const handleSubmit = () => {
    mutation.mutate({
      comicvine_id: result.comicvine_id,
      metadata_source: result.metadata_source ?? 'comicvine',
      metadata_id: result.metadata_id ?? undefined,
      metadata_language: result.metadata_source === 'mangadex' ? metadataLanguage : undefined,
      root_folder_id: rootFolderId,
      monitor_volume: monitorVolume,
      monitor_issues: monitorIssues,
      monitoring_scheme: monitoringScheme,
      volume_folder: volumeFolder,
      special_version: specialVersion || undefined,
      auto_search: autoSearch,
    });
  };

  const coverSrc = getCoverSrc(result);

  return (
    <DialogFrame open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader
        title={`Add ${result.title}`}
        meta={<Badge tone="neutral">{result.metadata_source === 'mangadex' ? 'MangaDex' : (result.year ?? '—')}</Badge>}
        onClose={onClose}
      />
      <DialogBody>
        <div className={styles.modalGrid}>
          {coverSrc && (
            <img src={coverSrc} alt={result.title} className={styles.modalCover} />
          )}
          <div className={styles.modalForm}>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="add-root-folder">Root Folder</label>
              <select
                id="add-root-folder"
                className={styles.formSelect}
                value={rootFolderId}
                onChange={(e) => setRootFolderId(Number(e.target.value))}
              >
                {sectionRootFolders.map((rf) => (
                  <option key={rf.id} value={rf.id}>{rf.folder}</option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="add-volume-folder">Volume Folder</label>
              <input
                id="add-volume-folder"
                className={styles.formInput}
                type="text"
                value={volumeFolder}
                onChange={(e) => setVolumeFolder(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="add-monitoring-scheme">Monitoring Scheme</label>
              <select
                id="add-monitoring-scheme"
                className={styles.formSelect}
                value={monitoringScheme}
                onChange={(e) => setMonitoringScheme(e.target.value)}
              >
                {MONITORING_SCHEMES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>


            {result.metadata_source === 'mangadex' && result.available_languages?.length ? (
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="add-metadata-language">MangaDex Language</label>
                <select
                id="add-metadata-language"
                  className={styles.formSelect}
                  value={metadataLanguage}
                  onChange={(e) => setMetadataLanguage(e.target.value)}
                >
                  {result.available_languages.map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="add-special-version">Special Version</label>
              <select
                id="add-special-version"
                className={styles.formSelect}
                value={specialVersion}
                onChange={(e) => setSpecialVersion(e.target.value)}
              >
                {SPECIAL_VERSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <label className={styles.formRow}>
              <span className={styles.formRowLabel}>Monitor Volume</span>
              <input
                type="checkbox"
                checked={monitorVolume}
                onChange={(e) => setMonitorVolume(e.target.checked)}
              />
            </label>

            <label className={styles.formRow}>
              <span className={styles.formRowLabel}>Monitor Issues</span>
              <input
                type="checkbox"
                checked={monitorIssues}
                onChange={(e) => setMonitorIssues(e.target.checked)}
              />
            </label>

            <label className={styles.formRow}>
              <span className={styles.formRowLabel}>Auto Search</span>
              <input
                type="checkbox"
                checked={autoSearch}
                onChange={(e) => setAutoSearch(e.target.checked)}
              />
            </label>

            {mutation.isError && (
              <div className={styles.modalError} role="alert">
                Could not add volume: {mutation.error.message}
              </div>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className={styles.footerActions}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={mutation.isPending || sectionRootFolders.length === 0}
          >
            {mutation.isPending ? 'Adding…' : 'Add Volume'}
          </Button>
        </div>
      </DialogFooter>
    </DialogFrame>
  );
}
