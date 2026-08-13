import { useState, useDeferredValue, useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import { AddModal } from '@/routes/add/-ui/add-page';
import { exactVolumeQueryOptions, rootFoldersQueryOptions, searchVolumesQueryOptions } from '@/routes/add/-add.api';
import { VOLUMES_KEY } from '@/routes/comics/-comics.api';
import { fetchDiscoveryVolumePage } from '../-discovery.api';
import { filterDiscoveryVolumes, getDiscoveryAddSelection } from '../-discovery.types';
import type { SearchResult } from '@/routes/add/-add.types';
import type { DiscoveryVolume, DiscoveryType, DiscoverySection } from '../-discovery.types';
import styles from './discovery-page.module.css';

interface DiscoveryPageProps {
  section: DiscoverySection;
  type: DiscoveryType;
  canonical?: boolean;
}

export function DiscoveryPage({ section, type, canonical = false }: DiscoveryPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [addSelection, setAddSelection] = useState<DiscoveryVolume | null>(null);
  const [searchSelection, setSearchSelection] = useState<SearchResult | null>(null);
  const [hideAlreadyAdded, setHideAlreadyAdded] = useState(false);
  const [rawAddSearch, setRawAddSearch] = useState('');
  const [addSearchMode, setAddSearchMode] = useState<'title' | 'publisher' | 'genre'>('title');
  const addSearch = useDeferredValue(rawAddSearch.trim());

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['discovery'] });
    // Brief visual feedback — the refetch will update isFetching
    setTimeout(() => setRefreshing(false), 600);
  }, [queryClient]);

  const setSection = (nextSection: DiscoverySection) => navigate({
    to: canonical ? '/discover' : '/discovery',
    search: (previous: Record<string, unknown>) => ({ ...previous, section: nextSection }),
  });
  const setType = (nextType: DiscoveryType) => navigate({
    to: canonical ? '/discover' : '/discovery',
    search: (previous: Record<string, unknown>) => canonical
      ? ({ ...previous, category: nextType })
      : ({ ...previous, type: nextType }),
  });

  const handleSearchSelect = (result: SearchResult) => {
    const existingId = result.id ?? result.already_added;
    if (existingId != null) {
      navigate({ to: '/volumes/$volumeId', params: { volumeId: String(existingId) } });
      return;
    }
    setSearchSelection(result);
  };

  const heading = getDiscoveryHeading(section, type);
  return (
    <div className={styles.page}>
      <h1 id="discover-heading" className={styles.srOnly}>{heading}</h1>

      <div className={styles.toolbar} aria-labelledby="discover-heading">
        <div className={styles.tabs}>
          <button
            className={`${styles.tab}${type === 'upcoming' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setType('upcoming')}
          >
            Upcoming
          </button>
          <button
            className={`${styles.tab}${type === 'new' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setType('new')}
          >
            New
          </button>
        </div>
        <div className={styles.toolbarRight}>
          <label className={styles.hideAddedToggle}>
            <input
              type="checkbox"
              checked={hideAlreadyAdded}
              onChange={(event) => setHideAlreadyAdded(event.target.checked)}
            />
            <span>Hide in library</span>
          </label>
          <div className={styles.sectionToggle}>
            <button
              className={`${styles.sectionBtn}${section === 'comic' ? ` ${styles.sectionActive}` : ''}`}
              onClick={() => setSection('comic')}
            >
              Comics
            </button>
            <button
              className={`${styles.sectionBtn}${section === 'manga' ? ` ${styles.sectionActive}` : ''}`}
              onClick={() => setSection('manga')}
            >
              Manga
            </button>
          </div>
          <button
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh from ComicVine"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <FloatingAddSearch
        section={section}
        mode={addSearchMode}
        onModeChange={setAddSearchMode}
        query={addSearch}
        rawQuery={rawAddSearch}
        onQueryChange={setRawAddSearch}
        onSelect={handleSearchSelect}
      />

      <VolumeGridView type={type} section={section} hideAlreadyAdded={hideAlreadyAdded} onAddVolume={setAddSelection} />

      {addSelection != null && (
        <DiscoveryAddModal
          volume={addSelection}
          section={section}
          onClose={() => setAddSelection(null)}
        />
      )}

      {searchSelection != null && (
        <SearchResultAddModal
          result={searchSelection}
          section={section}
          onClose={() => setSearchSelection(null)}
          onAdded={() => {
            setRawAddSearch('');
            setSearchSelection(null);
          }}
        />
      )}
    </div>
  );
}

const DISCOVERY_BATCH_SIZE = 50;

function VolumeGridView({ type, section, hideAlreadyAdded, onAddVolume }: { type: 'upcoming' | 'new'; section: DiscoverySection; hideAlreadyAdded: boolean; onAddVolume: (volume: DiscoveryVolume) => void }) {
  const navigate = useNavigate();
  const [pageOffset, setPageOffset] = useState(0);
  const [allVolumes, setAllVolumes] = useState<DiscoveryVolume[]>([]);
  const [total, setTotal] = useState(0);
  const { data: pageData, isFetching } = useQuery({
    queryKey: ['discovery', type, section, 'page', pageOffset],
    queryFn: () => fetchDiscoveryVolumePage(type, section, pageOffset, DISCOVERY_BATCH_SIZE),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    setPageOffset(0);
    setAllVolumes([]);
    setTotal(0);
  }, [type, section]);

  useEffect(() => {
    if (!pageData) return;
    setTotal(pageData.total);
    setAllVolumes((current) => {
      const base: DiscoveryVolume[] = pageData.offset === 0 ? [] : current;
      const seen = new Set(base.map((volume) => getDiscoveryCardKey(type, volume)));
      return [
        ...base,
        ...pageData.items.filter((volume: DiscoveryVolume) => {
          const key = getDiscoveryCardKey(type, volume);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
    });
  }, [pageData, type]);

  const volumes = filterDiscoveryVolumes(allVolumes, hideAlreadyAdded);
  const hasMore = allVolumes.length < total;

  useEffect(() => {
    if (!hasMore || isFetching) return;

    const onScroll = () => {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (remaining < 900) {
        setPageOffset(allVolumes.length);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [allVolumes.length, hasMore, isFetching]);

  const loadMore = () => setPageOffset(allVolumes.length);

  const handleClick = (vol: DiscoveryVolume) => {
    if (vol.already_added != null) {
      navigate({ to: '/volumes/$volumeId', params: { volumeId: String(vol.already_added) } });
      return;
    }
    onAddVolume(vol);
  };

  if (isFetching && allVolumes.length === 0) {
    return <div className={styles.empty}>Loading…</div>;
  }

  if (volumes.length === 0) {
    return <div className={styles.empty}>{allVolumes.length > 0 ? 'All visible titles are already in your library.' : `No ${type} titles found`}</div>;
  }

  return (
    <div className={styles.grid}>
      {volumes.map((vol) => (
        <VolumeCard key={getDiscoveryCardKey(type, vol)} volume={vol} onClick={handleClick} />
      ))}
      {hasMore && (
        <button type="button" className={styles.loadMoreSentinel} onClick={loadMore} disabled={isFetching}>
          {isFetching ? 'Loading more titles…' : 'Load more titles'}
        </button>
      )}
    </div>
  );
}

function getDiscoveryCardKey(type: 'upcoming' | 'new', volume: DiscoveryVolume): string {
  return [
    type,
    volume.metadata_source ?? 'comicvine',
    volume.metadata_id ?? volume.comicvine_id,
    volume.id ?? volume.issue_number ?? volume.cover_date ?? 'volume',
  ].join(':');
}

function VolumeCard({ volume, onClick }: { volume: DiscoveryVolume; onClick: (v: DiscoveryVolume) => void }) {
  const isAdded = volume.already_added != null;
  const coverSrc = volume.cover_link || null;

  return (
    <div className={styles.volumeCard}>
      <div className={styles.coverWrap}>
        {coverSrc ? (
          <img src={coverSrc} alt={volume.title} className={styles.cover} loading="lazy" />
        ) : (
          <div className={styles.coverPlaceholder}>📚</div>
        )}
        <div className={styles.overlayActions}>
          <button className={isAdded ? styles.overlayInLibrary : styles.overlayAddBtn} onClick={() => onClick(volume)}>
            {isAdded ? 'Open volume' : 'Add volume'}
          </button>
        </div>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{volume.title}</div>
        {volume.issue_number != null ? (
          <div className={styles.cardMeta}>
            {volume.issue_number ? `#${volume.issue_number}` : ''}
            {volume.cover_date ? ` · ${volume.cover_date}` : ''}
          </div>
        ) : (
          <div className={styles.cardMeta}>
            {[
              volume.year,
              volume.publisher,
              volume.issue_count != null ? `${volume.issue_count} issue${volume.issue_count !== 1 ? 's' : ''}` : null,
              volume.date_added,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function FloatingAddSearch({ section, mode, onModeChange, query, rawQuery, onQueryChange, onSelect }: {
  section: DiscoverySection;
  mode: 'title' | 'publisher' | 'genre';
  onModeChange: (mode: 'title' | 'publisher' | 'genre') => void;
  query: string;
  rawQuery: string;
  onQueryChange: (query: string) => void;
  onSelect: (result: SearchResult) => void;
}) {
  const { data: results = [], isFetching } = useQuery({
    ...searchVolumesQueryOptions(query, section, 'comicvine'),
    enabled: query.length >= 2,
  });
  const visibleResults = results.slice(0, 6);

  const searchLabel = mode === 'publisher' ? 'Search by publisher' : mode === 'genre' ? 'Search by genre keyword' : `Search to add ${section === 'manga' ? 'manga' : 'comics'}`;

  return (
    <div className={styles.addSearchPanel}>
      <div className={styles.addSearchHeader}>
        <div>
          <strong>Add new {section === 'manga' ? 'manga' : 'comics'}</strong>
          <span>Search ComicVine by title, publisher, or genre keyword.</span>
        </div>
        <div className={styles.discoveryModeChips} aria-label="Add search method">
          {(['title', 'publisher', 'genre'] as const).map((option) => (
            <button key={option} type="button" className={mode === option ? styles.modeChipActive : styles.modeChip} onClick={() => onModeChange(option)}>
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.floatingSearchWrap}>
      {query.length >= 2 && (
        <div className={styles.floatingResults} role="listbox" aria-label={`Add ${section === 'manga' ? 'manga' : 'comics'} search results`}>
          {isFetching && visibleResults.length === 0 ? (
            <div className={styles.floatingResultStatus}>Searching…</div>
          ) : visibleResults.length === 0 ? (
            <div className={styles.floatingResultStatus}>No matches found</div>
          ) : visibleResults.map((result) => (
            <button
              key={`${result.metadata_source ?? 'comicvine'}:${result.metadata_id ?? result.comicvine_id}`}
              type="button"
              className={styles.floatingResult}
              onClick={() => onSelect(result)}
            >
              <span className={styles.floatingResultTitle}>{result.title}</span>
              <span className={styles.floatingResultMeta}>{[result.year, result.publisher].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
      <label className={styles.srOnly} htmlFor="discover-add-search">
        Search to add {section === 'manga' ? 'manga' : 'comics'}
      </label>
      <input
        id="discover-add-search"
        className={styles.floatingSearchInput}
        type="search"
        value={rawQuery}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={`${searchLabel}…`}
      />
      </div>
    </div>
  );
}

function SearchResultAddModal({
  result,
  section,
  onClose,
  onAdded,
}: {
  result: SearchResult;
  section: DiscoverySection;
  onClose: () => void;
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const selection = {
    metadata_source: result.metadata_source ?? 'comicvine',
    metadata_id: result.metadata_id ?? String(result.comicvine_id),
    metadata_language: result.metadata_language ?? undefined,
    title: result.title,
  };
  const exact = useQuery(exactVolumeQueryOptions(selection, section));
  const { data: rootFolders = [], isPending: rootFoldersPending } = useQuery(rootFoldersQueryOptions());

  if (exact.isPending || rootFoldersPending) {
    return (
      <DialogFrame open onOpenChange={(open) => !open && onClose()}>
        <DialogHeader title={`Add ${result.title}`} onClose={onClose} />
        <DialogBody><div className={styles.empty}>Loading add settings…</div></DialogBody>
      </DialogFrame>
    );
  }

  if (exact.isError) {
    return (
      <DialogFrame open onOpenChange={(open) => !open && onClose()}>
        <DialogHeader title={`Add ${result.title}`} onClose={onClose} />
        <DialogBody><div className={styles.empty}>Could not load add settings: {exact.error.message}</div></DialogBody>
      </DialogFrame>
    );
  }

  const hydratedResult = {
    ...exact.data,
    metadata_language: result.metadata_language ?? exact.data.metadata_language,
  };

  return (
    <AddModal
      result={hydratedResult}
      rootFolders={rootFolders}
      section={section}
      onClose={onClose}
      onAdded={() => {
        void queryClient.invalidateQueries({ queryKey: ['discovery'] });
        void queryClient.invalidateQueries({ queryKey: ['volumes', 'search'] });
        void queryClient.invalidateQueries({ queryKey: VOLUMES_KEY });
        onAdded();
      }}
    />
  );
}

function DiscoveryAddModal({ volume, section, onClose }: { volume: DiscoveryVolume; section: DiscoverySection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const selection = getDiscoveryAddSelection(volume);
  const exact = useQuery(exactVolumeQueryOptions(selection, section));
  const { data: rootFolders = [] } = useQuery(rootFoldersQueryOptions());

  if (exact.isPending) {
    return (
      <DialogFrame open onOpenChange={(open) => !open && onClose()}>
        <DialogHeader title={`Add ${volume.title}`} onClose={onClose} />
        <DialogBody><div className={styles.empty}>Loading add settings…</div></DialogBody>
      </DialogFrame>
    );
  }

  if (exact.isError) {
    return (
      <DialogFrame open onOpenChange={(open) => !open && onClose()}>
        <DialogHeader title={`Add ${volume.title}`} onClose={onClose} />
        <DialogBody><div className={styles.empty}>Could not load add settings: {exact.error.message}</div></DialogBody>
      </DialogFrame>
    );
  }

  return (
    <AddModal
      result={exact.data}
      rootFolders={rootFolders}
      section={section}
      onClose={onClose}
      onAdded={() => {
        void queryClient.invalidateQueries({ queryKey: ['discovery'] });
        void queryClient.invalidateQueries({ queryKey: VOLUMES_KEY });
        onClose();
      }}
    />
  );
}


export function getDiscoveryHeading(section: DiscoverySection, type: DiscoveryType): string {
  const media = section === 'manga' ? 'Manga' : 'Comics';
  if (type === 'new') return `New ${media}`;
  return `Upcoming ${media}`;
}
