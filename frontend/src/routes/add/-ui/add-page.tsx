import { useState, useDeferredValue, useCallback } from 'react';
import { useQuery, useSuspenseQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button, Badge } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import {
  searchVolumesQueryOptions,
  rootFoldersQueryOptions,
  addVolume,
  type AddVolumePayload,
  type MetadataSourceFilter,
} from '../-add.api';
import type { SearchResult } from '../-add.types';
import { getUrlBase } from '@/app/api-client';
import styles from './add-page.module.css';

interface AddPageProps {
  section: 'comic' | 'manga';
}

export function AddPage({ section }: AddPageProps) {
  const navigate = useNavigate();
  const [rawQuery, setRawQuery] = useState('');
  const query = useDeferredValue(rawQuery);
  const [modalResult, setModalResult] = useState<SearchResult | null>(null);
  const [metadataSource, setMetadataSource] = useState<MetadataSourceFilter>(section === 'manga' ? 'all' : 'comicvine');

  const { data: results = [], isFetching } = useQuery({
    ...searchVolumesQueryOptions(query, section, metadataSource),
    enabled: query.length >= 2,
  });

  const { data: rootFolders = [] } = useSuspenseQuery(rootFoldersQueryOptions());

  const sectionLabel = section === 'manga' ? 'Manga' : 'Comics';
  const placeholder = `Search ${sectionLabel}…`;

  const openModal = useCallback((result: SearchResult) => {
    if ((result.id ?? result.already_added) != null) {
      navigate({ to: '/comics', search: { sort: 'title', filter: '', view: 'posters', offset: 0 } });
      return;
    }
    setModalResult(result);
  }, [navigate]);

  return (
    <div className={styles.page}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder={placeholder}
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          autoFocus
        />
        <div className={styles.sectionToggle}>
          <Badge tone={section === 'comic' ? 'info' : 'neutral'}>{sectionLabel}</Badge>
          {section === 'manga' && (
            <select
              className={styles.sourceSelect}
              value={metadataSource}
              onChange={(e) => setMetadataSource(e.target.value as MetadataSourceFilter)}
              title="Metadata source"
            >
              <option value="all">All sources</option>
              <option value="comicvine">ComicVine</option>
              <option value="mangadex">MangaDex</option>
            </select>
          )}
        </div>
      </div>

      {results.length === 0 && query.length >= 2 && !isFetching ? (
        <div className={styles.empty}>No results found for &ldquo;{query}&rdquo;</div>
      ) : results.length === 0 && query.length < 2 ? (
        <div className={styles.empty}>Type at least 2 characters to search</div>
      ) : (
        <div className={styles.results}>
          {results.map((result) => (
            <ResultCard
              key={`${result.metadata_source ?? 'comicvine'}:${result.metadata_id ?? result.comicvine_id}`}
              result={result}
              onClick={openModal}
            />
          ))}
        </div>
      )}

      {modalResult && (
        <AddModal
          result={modalResult}
          rootFolders={rootFolders}
          onClose={() => setModalResult(null)}
          onAdded={(_id) => {
            setModalResult(null);
            navigate({ to: '/comics', search: { sort: 'recently_added', filter: '', view: 'posters', offset: 0 } });
          }}
        />
      )}
    </div>
  );
}

interface ResultCardProps {
  result: SearchResult;
  onClick: (result: SearchResult) => void;
}

function getCoverSrc(result: SearchResult): string | null {
  if (result.cover_link) return result.cover_link;
  if (result.cover_url) {
    if (/^https?:\/\//i.test(result.cover_url)) return result.cover_url;
    const base = getUrlBase();
    return `${base}/api/${result.cover_url.replace(/^\/+/, '')}`;
  }
  return null;
}

function ResultCard({ result, onClick }: ResultCardProps) {
  const isAdded = (result.id ?? result.already_added) != null;
  const coverSrc = getCoverSrc(result);

  return (
    <div
      className={`${styles.resultCard}${isAdded ? ` ${styles.added}` : ''}`}
      onClick={() => onClick(result)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(result)}
    >
      <div className={styles.coverWrap}>
        {coverSrc ? (
          <img src={coverSrc} alt={result.title} className={styles.cover} loading="lazy" />
        ) : (
          <div className={styles.coverPlaceholder}>📚</div>
        )}
        {isAdded && <div className={styles.addedBadge}>✓</div>}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{result.title}</div>
        <div className={styles.cardMeta}>
          {result.year ?? '—'} · {result.issue_count ? `${result.issue_count} vols` : `Vol. ${result.volume_number}`}
        </div>
        <div className={styles.cardMeta}>{result.publisher} · {result.metadata_source === 'mangadex' ? 'MangaDex' : 'ComicVine'}</div>
      </div>
    </div>
  );
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
  rootFolders: { id: number; folder: string }[];
  onClose: () => void;
  onAdded: (id: number) => void;
}

function AddModal({ result, rootFolders, onClose, onAdded }: AddModalProps) {
  const defaultFolder = rootFolders[0]?.id ?? 0;

  const [rootFolderId, setRootFolderId] = useState(defaultFolder);
  const [volumeFolder, setVolumeFolder] = useState(result.title.replace(/[/\\:*?"<>|]/g, ''));
  const [monitorVolume, setMonitorVolume] = useState(true);
  const [monitorIssues, setMonitorIssues] = useState(true);
  const [monitoringScheme, setMonitoringScheme] = useState('all');
  const [specialVersion, setSpecialVersion] = useState('');
  const [autoSearch, setAutoSearch] = useState(true);

  const mutation = useMutation({
    mutationFn: (payload: AddVolumePayload) => addVolume(payload),
    onSuccess: (data) => onAdded(data.id),
  });

  const handleSubmit = () => {
    mutation.mutate({
      comicvine_id: result.comicvine_id,
      metadata_source: result.metadata_source ?? 'comicvine',
      metadata_id: result.metadata_id,
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
              <label className={styles.formLabel}>Root Folder</label>
              <select
                className={styles.formSelect}
                value={rootFolderId}
                onChange={(e) => setRootFolderId(Number(e.target.value))}
              >
                {rootFolders.map((rf) => (
                  <option key={rf.id} value={rf.id}>{rf.folder}</option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Volume Folder</label>
              <input
                className={styles.formInput}
                type="text"
                value={volumeFolder}
                onChange={(e) => setVolumeFolder(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Monitoring Scheme</label>
              <select
                className={styles.formSelect}
                value={monitoringScheme}
                onChange={(e) => setMonitoringScheme(e.target.value)}
              >
                {MONITORING_SCHEMES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Special Version</label>
              <select
                className={styles.formSelect}
                value={specialVersion}
                onChange={(e) => setSpecialVersion(e.target.value)}
              >
                {SPECIAL_VERSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.formRow}>
              <span className={styles.formRowLabel}>Monitor Volume</span>
              <input
                type="checkbox"
                checked={monitorVolume}
                onChange={(e) => setMonitorVolume(e.target.checked)}
              />
            </div>

            <div className={styles.formRow}>
              <span className={styles.formRowLabel}>Monitor Issues</span>
              <input
                type="checkbox"
                checked={monitorIssues}
                onChange={(e) => setMonitorIssues(e.target.checked)}
              />
            </div>

            <div className={styles.formRow}>
              <span className={styles.formRowLabel}>Auto Search</span>
              <input
                type="checkbox"
                checked={autoSearch}
                onChange={(e) => setAutoSearch(e.target.checked)}
              />
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className={styles.footerActions}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={mutation.isPending || rootFolders.length === 0}
          >
            {mutation.isPending ? 'Adding…' : 'Add Volume'}
          </Button>
        </div>
      </DialogFooter>
    </DialogFrame>
  );
}
