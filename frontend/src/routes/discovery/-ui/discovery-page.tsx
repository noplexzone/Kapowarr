import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Badge, Button } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import { AddModal, ExactAddReview } from '@/routes/add/-ui/add-page';
import { exactVolumeQueryOptions, rootFoldersQueryOptions, searchVolumesPageQueryOptions, searchVolumesQueryOptions } from '@/routes/add/-add.api';
import { VOLUMES_KEY } from '@/routes/comics/-comics.api';
import { getUrlBase } from '@/app/api-client';
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
  const [hideAlreadyAdded, setHideAlreadyAdded] = useState(false);
  const [rawAddSearch, setRawAddSearch] = useState('');

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

  const heading = getDiscoveryHeading(section, type);
  const subheading = getDiscoverySubheading(section, type);

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="discover-heading">
        <p className={styles.kicker}>Discover</p>
        <h1 id="discover-heading">{heading}</h1>
        <p>{subheading}</p>
      </section>

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
        </div>
        <div className={styles.toolbarRight}>
          {            <label className={styles.hideAddedToggle}>
              <input
                type="checkbox"
                checked={hideAlreadyAdded}
                onChange={(event) => setHideAlreadyAdded(event.target.checked)}
              />
              <span>Hide in library</span>
            </label>
          }
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

      <DiscoverSearchCombobox section={section} rawQuery={rawAddSearch} onQueryChange={setRawAddSearch} />

      <VolumeGridView type={type} section={section} hideAlreadyAdded={hideAlreadyAdded} onAddVolume={setAddSelection} />

      {addSelection != null && (
        <DiscoveryAddModal
          volume={addSelection}
          section={section}
          onClose={() => setAddSelection(null)}
        />
      )}

    </div>
  );
}

const DISCOVERY_BATCH_SIZE = 50;
const SEARCH_PAGE_SIZE = 30;

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
              volume.issue_count == null ? 'Issue count unavailable' : `${volume.issue_count} issue${volume.issue_count !== 1 ? 's' : ''}`,
              volume.date_added,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function useDebouncedValue(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeoutId);
  }, [value, delay]);
  return debounced;
}

function getResultIdentity(result: Pick<SearchResult, 'metadata_source' | 'metadata_id' | 'comicvine_id'>): string {
  return `${result.metadata_source ?? 'comicvine'}:${result.metadata_id ?? result.comicvine_id}`;
}

function getAddRouteParams(result: SearchResult) {
  return { source: result.metadata_source ?? 'comicvine', metadataId: result.metadata_id ?? String(result.comicvine_id) } as const;
}

function getAddRouteSearch(section: DiscoverySection, result: SearchResult) {
  return { section, title: result.title, language: result.metadata_language ?? undefined };
}

function formatIssueCount(result: { issue_count?: number | null }, section: DiscoverySection): string {
  if (section === 'manga') return '';
  if (result.issue_count == null) return 'Issue count unavailable';
  return `${result.issue_count} issue${result.issue_count === 1 ? '' : 's'}`;
}

function formatSearchMeta(result: SearchResult, section: DiscoverySection): string {
  return [result.year, result.publisher, result.volume_number != null ? `Vol. ${result.volume_number}` : null, formatIssueCount(result, section), result.metadata_source === 'mangadex' ? 'MangaDex' : 'ComicVine'].filter(Boolean).join(' · ');
}

export function DiscoverSearchCombobox({ section, rawQuery, onQueryChange }: { section: DiscoverySection; rawQuery: string; onQueryChange: (query: string) => void }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = rawQuery.trim();
  const debouncedQuery = useDebouncedValue(query, 300);
  const enabled = debouncedQuery.length >= 2;
  const { data: results = [], isFetching, isError } = useQuery({
    ...searchVolumesQueryOptions(debouncedQuery, section, 'all'),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((result) => {
      const key = getResultIdentity(result);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [results]);
  const listboxId = `discover-add-suggestions-${section}`;
  const activeDescendant = open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const optionCount = suggestions.length + (query.length >= 2 ? 1 : 0);

  useEffect(() => {
    if (query.length < 2) { setOpen(false); setActiveIndex(-1); return; }
    if (enabled && (suggestions.length > 0 || isFetching || isError)) setOpen(true);
  }, [enabled, isError, isFetching, query.length, suggestions.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setActiveIndex(-1); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const goToAllResults = useCallback(() => {
    if (query.length < 2) return;
    setOpen(false);
    navigate({ to: '/discover/search', search: { section, q: query } });
  }, [navigate, query, section]);

  const openResult = useCallback((result: SearchResult) => {
    setOpen(false);
    navigate({ to: '/discover/add/$source/$metadataId', params: getAddRouteParams(result), search: getAddRouteSearch(section, result) });
  }, [navigate, section]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(query.length >= 2); setActiveIndex((current) => Math.min(current + 1, Math.max(optionCount - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(query.length >= 2); setActiveIndex((current) => Math.max(current - 1, 0)); }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActiveIndex(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); if (open && activeIndex >= 0 && activeIndex < suggestions.length) openResult(suggestions[activeIndex]); else goToAllResults(); }
  };

  return (
    <div className={styles.addSearchPanel} ref={rootRef}>
      <div className={styles.addSearchHeader}><div><strong>Add new {section === 'manga' ? 'manga' : 'comics'}</strong><span>Search series titles, then review the exact metadata record before adding.</span></div></div>
      <div className={styles.floatingSearchWrap}>
        <label className={styles.srOnly} htmlFor="discover-add-search">Search to add {section === 'manga' ? 'manga' : 'comics'}</label>
        <input id="discover-add-search" className={styles.floatingSearchInput} type="search" role="combobox" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={activeDescendant} aria-autocomplete="list" value={rawQuery} onFocus={() => { if (query.length >= 2 && (suggestions.length > 0 || isFetching || isError)) setOpen(true); }} onChange={(event) => { onQueryChange(event.target.value); setActiveIndex(-1); if (event.target.value.trim().length < 2) setOpen(false); }} onKeyDown={handleKeyDown} placeholder={`Search ${section === 'manga' ? 'manga' : 'comics'} titles…`} />
        <div className={styles.floatingStatusSlot} aria-live="polite">{query.length >= 2 && isFetching ? 'Searching…' : isError ? 'Search failed' : '\u00a0'}</div>
        {open && query.length >= 2 && <div id={listboxId} className={styles.floatingResults} role="listbox" aria-label={`Add ${section === 'manga' ? 'manga' : 'comics'} search suggestions`}>
          {isError ? <div className={styles.floatingResultStatus}>Could not load suggestions.</div> : null}
          {!isError && suggestions.map((result, index) => <button id={`${listboxId}-option-${index}`} key={getResultIdentity(result)} type="button" role="option" aria-selected={activeIndex === index} className={`${styles.floatingResult}${activeIndex === index ? ` ${styles.floatingResultActive}` : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => openResult(result)}><span className={styles.floatingResultTitle}>{result.title}</span><span className={styles.floatingResultMeta}>{formatSearchMeta(result, section)}</span></button>)}
          {!isError && suggestions.length === 0 && !isFetching ? <div className={styles.floatingResultStatus}>No matches found</div> : null}
          <button id={`${listboxId}-option-${suggestions.length}`} type="button" role="option" aria-selected={activeIndex === suggestions.length} className={`${styles.floatingResult} ${styles.viewAllResult}${activeIndex === suggestions.length ? ` ${styles.floatingResultActive}` : ''}`} onMouseEnter={() => setActiveIndex(suggestions.length)} onClick={goToAllResults}>View all results for “{query}”</button>
        </div>}
      </div>
    </div>
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



function proxiedMangaDexCover(url: string): string {
  const base = getUrlBase().replace(/\/$/, '');
  return `${base}/api/mangadex/cover-proxy?url=${encodeURIComponent(url)}`;
}

function getCoverSrc(result: SearchResult): string | null {
  if (result.cover_link) return /^https:\/\/uploads\.mangadex\.org\/covers\//i.test(result.cover_link) ? proxiedMangaDexCover(result.cover_link) : result.cover_link;
  if (result.cover_url) {
    if (/^https:\/\/uploads\.mangadex\.org\/covers\//i.test(result.cover_url)) return proxiedMangaDexCover(result.cover_url);
    if (/^https?:\/\//i.test(result.cover_url)) return result.cover_url;
    return `${getUrlBase()}/api/${result.cover_url.replace(/^\/+/, '')}`;
  }
  return null;
}

function SearchResultCard({ result, section, onOpen }: { result: SearchResult; section: DiscoverySection; onOpen: (result: SearchResult) => void }) {
  const isAdded = (result.id ?? result.already_added) != null;
  const coverSrc = getCoverSrc(result);
  return <article className={`${styles.searchResultCard}${isAdded ? ` ${styles.added}` : ''}`}><div className={styles.searchResultCoverWrap}>{coverSrc ? <img src={coverSrc} alt={result.title} className={styles.searchResultCover} loading="lazy" /> : <div className={styles.coverPlaceholder}>📚</div>}</div><div className={styles.searchResultBody}><div className={styles.searchResultTopline}><Badge tone="neutral">{result.metadata_source === 'mangadex' ? 'MangaDex' : 'ComicVine'}</Badge>{isAdded && <Badge tone="success">In Library</Badge>}</div><h2>{result.title}</h2><p className={styles.searchResultMeta}>{formatSearchMeta(result, section)}</p>{result.status && <p className={styles.searchResultMeta}>{String(result.status)}</p>}{result.completion && <p className={styles.searchResultMeta}>Completion: {String(result.completion)}</p>}</div><div className={styles.searchResultActions}><Button variant={isAdded ? 'secondary' : 'primary'} onClick={() => onOpen(result)}>{isAdded ? 'Open' : 'Add'}</Button></div></article>;
}

export function DiscoverSearchResultsPage({ section, q, page }: { section: DiscoverySection; q: string; page: number }) {
  const navigate = useNavigate();
  const offset = (page - 1) * SEARCH_PAGE_SIZE;
  const query = q.trim();
  const { data, isFetching, isError, error, refetch } = useQuery({ ...searchVolumesPageQueryOptions(query, section, 'all', offset, SEARCH_PAGE_SIZE), enabled: query.length >= 2, placeholderData: keepPreviousData, staleTime: 5 * 60_000 });
  const items = data?.items ?? [];
  const openResult = (result: SearchResult) => {
    const existingId = result.id ?? result.already_added;
    if (existingId != null) { navigate({ to: '/volumes/$volumeId', params: { volumeId: String(existingId) } }); return; }
    navigate({ to: '/discover/add/$source/$metadataId', params: getAddRouteParams(result), search: getAddRouteSearch(section, result) });
  };
  if (query.length < 2) return <div className={styles.searchPage}><div className={styles.empty}>Type at least 2 characters to search.</div></div>;
  return <div className={styles.searchPage}><section className={styles.hero} aria-labelledby="discover-search-heading"><p className={styles.kicker}>Discover Search</p><h1 id="discover-search-heading">Results for “{query}”</h1><p>{section === 'manga' ? 'Manga' : 'Comic'} series and volumes from metadata providers.</p></section>{isError ? <div className={styles.empty} role="alert"><span>Could not load search results: {error.message}</span><Button onClick={() => void refetch()}>Retry</Button></div> : null}{!isError && isFetching && !data ? <div className={styles.empty} role="status">Loading results…</div> : null}{!isError && data && items.length === 0 ? <div className={styles.empty}>No results found for “{query}”.</div> : null}{!isError && items.length > 0 ? <div className={styles.searchResults}>{items.map((result) => <SearchResultCard key={getResultIdentity(result)} result={result} section={section} onOpen={openResult} />)}</div> : null}{data ? <div className={styles.paginationRow}><Button variant="secondary" disabled={page <= 1 || isFetching} onClick={() => navigate({ to: '/discover/search', search: { section, q: query, page: page - 1 } })}>Previous</Button><span>{data.total} results</span><Button variant="secondary" disabled={!data.has_more || isFetching} onClick={() => navigate({ to: '/discover/search', search: { section, q: query, page: page + 1 } })}>Next</Button></div> : null}{isFetching && data ? <div className={styles.inlineStatus} role="status">Refreshing results…</div> : null}</div>;
}

export function DiscoverExactAddPage({ section, source, metadataId, title, language }: { section: DiscoverySection; source: 'comicvine' | 'mangadex'; metadataId: string; title?: string; language?: string }) {
  return <ExactAddReview section={section} selection={{ metadata_source: source, metadata_id: metadataId, title, metadata_language: language }} searchFallbackTo="/discover/search" />;
}

export function getDiscoveryHeading(section: DiscoverySection, type: DiscoveryType): string {
  const media = section === 'manga' ? 'Manga' : 'Comics';
  if (type === 'new') return `New ${media}`;
  return `Upcoming ${media}`;
}

export function getDiscoverySubheading(section: DiscoverySection, type: DiscoveryType): string {
  const media = section === 'manga' ? 'manga' : 'comics';
  if (type === 'new') return `Browse newly indexed ${media}, keep library-owned titles visible, and add from verified metadata.`;
  return `Review upcoming ${media} releases with poster-first actions and direct add/open controls.`;
}
