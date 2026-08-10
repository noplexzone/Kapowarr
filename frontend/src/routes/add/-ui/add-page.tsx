import { useState, useEffect, useCallback } from 'react';
import { useQuery, useSuspenseQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button, Badge } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import {
  searchVolumesQueryOptions,
  exactVolumeQueryOptions,
  rootFoldersQueryOptions,
  addVolume,
  type AddVolumePayload,
  type MetadataSourceFilter,
} from '../-add.api';
import type { SearchResult } from '../-add.types';
import { getUrlBase } from '@/app/api-client';
import styles from './add-page.module.css';

interface AddSelection { metadata_source: 'comicvine' | 'mangadex'; metadata_id: string; title: string; metadata_language?: string }
interface AddPageProps { section: 'comic' | 'manga'; selection?: AddSelection }

export function AddPage({ section, selection }: AddPageProps) {
  const navigate = useNavigate();
  const [rawQuery, setRawQuery] = useState(selection?.title ?? '');
  const [query, setQuery] = useState(selection?.title ?? '');
  const [modalResult, setModalResult] = useState<SearchResult | null>(null);
  const [metadataSource, setMetadataSource] = useState<MetadataSourceFilter>(selection?.metadata_source ?? 'comicvine');

  useEffect(() => {
    setMetadataSource(selection?.metadata_source ?? 'comicvine');
  }, [section, selection?.metadata_source]);

  useEffect(() => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) {
      setQuery('');
      return;
    }

    const timeoutId = window.setTimeout(() => setQuery(trimmed), 300);
    return () => window.clearTimeout(timeoutId);
  }, [rawQuery]);

  const triggerSearch = useCallback(() => {
    const trimmed = rawQuery.trim();
    setQuery(trimmed.length >= 2 ? trimmed : '');
  }, [rawQuery]);

  const { data: results = [], isFetching } = useQuery({
    ...searchVolumesQueryOptions(query, section, metadataSource),
    enabled: query.length >= 2,
  });
  const { data: exactSelection } = useQuery(
    exactVolumeQueryOptions(selection, section),
  );

  const { data: rootFolders = [] } = useSuspenseQuery(rootFoldersQueryOptions());

  useEffect(() => {
    if (!exactSelection || modalResult) return;
    setModalResult({
      ...exactSelection,
      metadata_language: selection?.metadata_language ?? exactSelection.metadata_language,
    });
  }, [selection?.metadata_language, exactSelection, modalResult]);

  const sectionLabel = section === 'manga' ? 'Manga' : 'Comics';
  const placeholder = `Search ${sectionLabel}…`;

  const openModal = useCallback((result: SearchResult) => {
    if ((result.id ?? result.already_added) != null) {
      navigate({
        to: '/volumes/$volumeId',
        params: { volumeId: String(result.id ?? result.already_added) },
      });
      return;
    }
    setModalResult(result);
  }, [navigate, section]);

  return (
    <div className={styles.page}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder={placeholder}
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') triggerSearch();
          }}
          autoFocus
        />
        <div className={styles.sectionToggle}>
          {section === 'manga' ? (
            <label className={styles.sourceField}>
              <span className={styles.sourceLabel}>Source</span>
              <select
                className={styles.sourceSelect}
                value={metadataSource}
                onChange={(e) => {
                  setMetadataSource(e.target.value as MetadataSourceFilter);
                  setQuery(rawQuery.trim().length >= 2 ? rawQuery.trim() : '');
                }}
              >
                <option value="comicvine">ComicVine</option>
                <option value="mangadex">MangaDex</option>
              </select>
            </label>
          ) : (
            <Badge tone="info">ComicVine</Badge>
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
          section={section}
          onClose={() => setModalResult(null)}
          onAdded={(id) => {
            setModalResult(null);
            navigate({ to: '/volumes/$volumeId', params: { volumeId: String(id) } });
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
  rootFolders: { id: number; folder: string; section: 'comic' | 'manga' }[];
  section: 'comic' | 'manga';
  onClose: () => void;
  onAdded: (id: number) => void;
}

function AddModal({ result, rootFolders, section, onClose, onAdded }: AddModalProps) {
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
      metadata_id: result.metadata_id,
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
              <label className={styles.formLabel}>Root Folder</label>
              <select
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


            {result.metadata_source === 'mangadex' && result.available_languages?.length ? (
              <div className={styles.formField}>
                <label className={styles.formLabel}>MangaDex Language</label>
                <select
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
            disabled={mutation.isPending || sectionRootFolders.length === 0}
          >
            {mutation.isPending ? 'Adding…' : 'Add Volume'}
          </Button>
        </div>
      </DialogFooter>
    </DialogFrame>
  );
}
