import { useState, useDeferredValue, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import { AddModal } from '@/routes/add/-ui/add-page';
import { exactVolumeQueryOptions, rootFoldersQueryOptions, searchVolumesQueryOptions } from '@/routes/add/-add.api';
import { VOLUMES_KEY } from '@/routes/comics/-comics.api';
import {
  discoveryVolumeQueryOptions,
  storyArcsQueryOptions,
  storyArcDetailQueryOptions,
} from '../-discovery.api';
import { filterDiscoveryVolumes, getDiscoveryAddSelection } from '../-discovery.types';
import type { SearchResult } from '@/routes/add/-add.types';
import type { DiscoveryVolume, StoryArc, DiscoveryType, DiscoverySection } from '../-discovery.types';
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
  const [arcId, setArcId] = useState<number | null>(null);
  const [addSelection, setAddSelection] = useState<DiscoveryVolume | null>(null);
  const [searchSelection, setSearchSelection] = useState<SearchResult | null>(null);
  const [hideAlreadyAdded, setHideAlreadyAdded] = useState(false);
  const [rawArcSearch, setRawArcSearch] = useState('');
  const [rawAddSearch, setRawAddSearch] = useState('');
  const arcSearch = useDeferredValue(rawArcSearch);
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

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
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
          <button
            className={`${styles.tab}${type === 'story-arcs' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setType('story-arcs')}
          >
            Story Arcs
          </button>
        </div>
        <div className={styles.toolbarRight}>
          {type !== 'story-arcs' && (
            <label className={styles.hideAddedToggle}>
              <input
                type="checkbox"
                checked={hideAlreadyAdded}
                onChange={(event) => setHideAlreadyAdded(event.target.checked)}
              />
              <span>Hide in library</span>
            </label>
          )}
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
            ↻
          </button>
        </div>
      </div>

      {type === 'story-arcs' ? (
        <StoryArcsView
          section={section}
          query={arcSearch}
          rawQuery={rawArcSearch}
          onQueryChange={setRawArcSearch}
          onSelectArc={setArcId}
        />
      ) : (
        <VolumeGridView type={type} section={section} hideAlreadyAdded={hideAlreadyAdded} onAddVolume={setAddSelection} />
      )}

      {arcId != null && (
        <ArcDetailModal id={arcId} onClose={() => setArcId(null)} onAddVolume={setAddSelection} />
      )}

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
        />
      )}

      <FloatingAddSearch
        section={section}
        query={addSearch}
        rawQuery={rawAddSearch}
        onQueryChange={setRawAddSearch}
        onSelect={handleSearchSelect}
      />
    </div>
  );
}

function VolumeGridView({ type, section, hideAlreadyAdded, onAddVolume }: { type: 'upcoming' | 'new'; section: DiscoverySection; hideAlreadyAdded: boolean; onAddVolume: (volume: DiscoveryVolume) => void }) {
  const navigate = useNavigate();
  const { data: allVolumes = [], isFetching } = useQuery(discoveryVolumeQueryOptions(type, section));
  const volumes = filterDiscoveryVolumes(allVolumes, hideAlreadyAdded);

  const handleClick = (vol: DiscoveryVolume) => {
    if (vol.already_added != null) {
      navigate({ to: '/volumes/$volumeId', params: { volumeId: String(vol.already_added) } });
      return;
    }
    onAddVolume(vol);
  };

  if (isFetching && volumes.length === 0) {
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
            {isAdded ? '✓ Open in Library' : '+ Add'}
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

interface StoryArcsViewProps {
  section: DiscoverySection;
  query: string;
  rawQuery: string;
  onQueryChange: (q: string) => void;
  onSelectArc: (id: number) => void;
}

function StoryArcsView({ section, query, rawQuery, onQueryChange, onSelectArc }: StoryArcsViewProps) {
  const { data: arcs = [], isFetching } = useQuery(storyArcsQueryOptions(query, section));

  return (
    <div className={styles.arcsView}>
      <input
        className={styles.searchInput}
        type="search"
        aria-label="Search story arcs"
        placeholder="Search story arcs…"
        value={rawQuery}
        onChange={e => onQueryChange(e.target.value)}
        autoFocus
      />

      {rawQuery.length < 2 ? (
        <div className={styles.empty}>Type at least 2 characters to search</div>
      ) : isFetching ? (
        <div className={styles.empty}>Searching…</div>
      ) : arcs.length === 0 ? (
        <div className={styles.empty}>No story arcs found for &ldquo;{rawQuery}&rdquo;</div>
      ) : (
        <div className={styles.arcList}>
          {(arcs as StoryArc[]).map((arc) => (
            <div
              key={arc.id}
              className={styles.arcItem}
              onClick={() => onSelectArc(arc.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectArc(arc.id);
                }
              }}
            >
              <span className={styles.arcName}>{arc.name}</span>
              {arc.issue_count != null && (
                <Badge tone="neutral">{arc.issue_count} issues</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArcDetailModal({ id, onClose, onAddVolume }: { id: number; onClose: () => void; onAddVolume: (volume: DiscoveryVolume) => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(storyArcDetailQueryOptions(id));

  return (
    <DialogFrame open onOpenChange={open => !open && onClose()}>
      <DialogHeader title="Story Arc Volumes" onClose={onClose} />
      <DialogBody>
        {isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : !data || data.volumes.length === 0 ? (
          <div className={styles.empty}>No volumes found for this arc</div>
        ) : (
          <div className={styles.grid}>
            {data.volumes.map((vol) => (
              <VolumeCard
                key={vol.comicvine_id}
                volume={vol}
                onClick={() => {
                  if (vol.already_added != null) {
                    navigate({ to: '/volumes/$volumeId', params: { volumeId: String(vol.already_added) } });
                  } else {
                    onClose();
                    onAddVolume(vol);
                  }
                }}
              />
            ))}
          </div>
        )}
      </DialogBody>
    </DialogFrame>
  );
}

function FloatingAddSearch({ section, query, rawQuery, onQueryChange, onSelect }: {
  section: DiscoverySection;
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

  return (
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
        placeholder={`Search to add ${section === 'manga' ? 'manga' : 'comics'}…`}
      />
    </div>
  );
}

function SearchResultAddModal({ result, section, onClose }: { result: SearchResult; section: DiscoverySection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: rootFolders = [] } = useQuery(rootFoldersQueryOptions());

  return (
    <AddModal
      result={result}
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
