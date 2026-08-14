import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Badge, Button } from '@/components/primitives';
import { ExactAddReview } from '@/routes/add/-ui/add-page';
import { searchVolumesPageQueryOptions, searchVolumesQueryOptions } from '@/routes/add/-add.api';
import { getUrlBase } from '@/app/api-client';
import { browseDiscoveryQueryOptions, discoveryCapabilitiesQueryOptions, discoveryShelfInfiniteQueryOptions } from '../-discovery.api';
import { DISCOVER_AUTOMATIC_PAGE_LIMIT, DISCOVER_INITIAL_PAGE_SIZE, dedupeDiscoveryItems, getDiscoveryCardKey } from '../-discovery.types';
import type { SearchResult } from '@/routes/add/-add.types';
import type { BrowseFilters, DiscoveryCapabilities, DiscoveryVolume, DiscoveryType, DiscoverySection } from '../-discovery.types';
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

      <DiscoverLanding section={section} type={type} />

    </div>
  );
}

const SEARCH_PAGE_SIZE = 30;

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


function openDiscoveryAdd(navigate: ReturnType<typeof useNavigate>, section: DiscoverySection, volume: DiscoveryVolume) {
  if (volume.already_added != null) {
    navigate({ to: '/volumes/$volumeId', params: { volumeId: String(volume.already_added) } });
    return;
  }
  navigate({
    to: '/discover/add/$source/$metadataId',
    params: { source: volume.metadata_source ?? 'comicvine', metadataId: volume.metadata_id ?? String(volume.comicvine_id) },
    search: { section, title: volume.title, language: volume.metadata_language ?? undefined },
  });
}

function DiscoverLanding({ section }: { section: DiscoverySection; type: DiscoveryType }) {
  const { data: capabilities } = useQuery(discoveryCapabilitiesQueryOptions(section));
  const shelves = section === 'comic'
    ? [
        { title: 'Recently Started', description: 'Series whose first known issue date is inside the last 12 months.', type: 'new' as DiscoveryType, viewAll: '/discover/browse?section=comic&sort=recently_started' },
        { title: 'Upcoming Series Launches', description: 'Future issue #1 releases only, not ordinary ongoing-series issues.', type: 'upcoming' as DiscoveryType, viewAll: '/discover/browse?section=comic&sort=year' },
        { title: 'Recently Active', description: 'ComicVine recently-updated order; not a global popularity score.', type: 'trending' as DiscoveryType, viewAll: '/discover/browse?section=comic&sort=trending' },
      ]
    : [
        { title: 'Recently Updated Manga', description: 'MangaDex-backed catalog browsing keeps manga separate from ComicVine.', type: 'recently-updated' as DiscoveryType, viewAll: '/discover/browse?section=manga&sort=recently_updated' },
        { title: 'Recently Started Manga', description: 'MangaDex year-sorted series; chapter counts are not shown as issues.', type: 'new' as DiscoveryType, viewAll: '/discover/browse?section=manga&sort=year' },
      ];
  return <main className={styles.discoverMain} aria-label="Discover curated shelves">{shelves.map((shelf) => <DiscoveryShelf key={shelf.title} section={section} {...shelf} />)}<BrowseShortcuts section={section} capabilities={capabilities} /></main>;
}

function DiscoveryShelf({ title, description, type, section, viewAll }: { title: string; description?: string; type: DiscoveryType; section: DiscoverySection; viewAll?: string }) {
  const navigate = useNavigate();
  const query = useInfiniteQuery(discoveryShelfInfiniteQueryOptions(type, section, 12));
  const items = dedupeDiscoveryItems((query.data?.pages ?? []).flatMap(page => page.items)).slice(0, 12);
  return <section className={styles.shelf} aria-labelledby={`${section}-${type}-heading`}><header className={styles.shelfHeader}><div><h2 id={`${section}-${type}-heading`}>{title}</h2>{description && <p>{description}</p>}</div>{viewAll && <a className={styles.viewAllLink} href={viewAll}>View All</a>}</header>{query.isPending ? <div className={styles.empty}>Loading…</div> : query.isError ? <div className={styles.empty}>Could not load shelf <Button onClick={() => void query.refetch()}>Retry</Button></div> : items.length === 0 ? <div className={styles.empty}>No {title.toLowerCase()} found.</div> : <div className={styles.shelfScroller}>{items.map(volume => <DiscoveryCatalogCard key={getDiscoveryCardKey(volume)} section={section} volume={volume} onOpen={() => openDiscoveryAdd(navigate, section, volume)} />)}</div>}</section>;
}

function BrowseShortcuts({ section, capabilities }: { section: DiscoverySection; capabilities?: DiscoveryCapabilities }) {
  const decades = capabilities?.decades ?? [];
  const publishers = section === 'comic' ? capabilities?.publishers ?? [] : [];
  return <section className={styles.browsePanel} aria-label={`Browse ${section === 'manga' ? 'manga' : 'comics'}`}><header className={styles.shelfHeader}><div><h2>Browse All {section === 'manga' ? 'Manga' : 'Comics'}</h2><p>Only filters backed by current provider behavior are shown.</p></div><a className={styles.viewAllLink} href={`/discover/browse?section=${section}`}>Open Catalog</a></header>{publishers.length > 0 && <div className={styles.shortcutGroup}><h3>Browse Publishers</h3><div className={styles.shortcutChips}>{publishers.slice(0, 8).map(item => <a key={item.value} className={styles.modeChip} href={`/discover/browse?section=comic&publisher=${encodeURIComponent(item.value)}`}>{item.label}</a>)}</div></div>}<div className={styles.shortcutGroup}><h3>{section === 'manga' ? 'Browse Manga Filters' : 'Browse by Decade'}</h3><div className={styles.shortcutChips}>{section === 'manga' ? ['ongoing','completed','hiatus','cancelled'].map(status => <a key={status} className={styles.modeChip} href={`/discover/browse?section=manga&status=${status}`}>{status}</a>) : decades.slice(0, 8).map(item => <a key={item.value} className={styles.modeChip} href={`/discover/browse?section=${section}&decade=${item.value}`}>{item.label}</a>)}</div></div><p className={styles.sourceFinePrint}>{capabilities?.deferred_filters.join(', ') || 'Unsupported'} filters are absent rather than accepted and ignored.</p></section>;
}

function DiscoveryCatalogCard({ volume, section, onOpen }: { volume: DiscoveryVolume; section: DiscoverySection; onOpen: () => void }) {
  const isAdded = volume.already_added != null;
  const title = volume.volume_title || volume.title;
  const coverSrc = volume.cover_link || volume.cover_url || null;
  const issueText = section === 'manga' ? null : volume.issue_count == null ? 'Issue count unavailable' : `${volume.issue_count} issue${volume.issue_count === 1 ? '' : 's'}`;
  return <article className={styles.volumeCard}><div className={styles.coverWrap}>{coverSrc ? <img src={coverSrc} alt={title} className={styles.cover} loading="lazy" /> : <div className={styles.coverPlaceholder}>📚</div>}<div className={styles.overlayActions}><button className={isAdded ? styles.overlayInLibrary : styles.overlayAddBtn} onClick={onOpen}>{isAdded ? 'Open' : 'Add'}</button></div></div><div className={styles.cardBody}><h3 className={styles.cardTitle}>{title}</h3><div className={styles.cardMeta}>{[volume.year, volume.publisher, issueText, volume.status, volume.metadata_source_label ?? volume.metadata_source].filter(Boolean).join(' · ')}</div></div></article>;
}

export function DiscoveryBrowsePage({ search }: { search: BrowseFilters }) {
  const navigate = useNavigate();
  const [localQuery, setLocalQuery] = useState(search.q ?? '');
  const [autoPages, setAutoPages] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const requestedOffsets = useRef(new Set<number>());
  const query = useInfiniteQuery(browseDiscoveryQueryOptions(search, DISCOVER_INITIAL_PAGE_SIZE));
  const items = dedupeDiscoveryItems((query.data?.pages ?? []).flatMap(page => page.items));
  useEffect(() => { setLocalQuery(search.q ?? ''); setAutoPages(0); requestedOffsets.current = new Set([0]); }, [search.section, search.q, search.publisher, search.decade, search.status, search.tags, search.demographic, search.original_language, search.year, search.author, search.artist, search.content_rating, search.sort]);
  useEffect(() => { const timer = window.setTimeout(() => { if ((search.q ?? '') !== localQuery.trim()) navigate({ to: '/discover/browse' as never, search: { ...search, q: localQuery.trim() || undefined } as never }); }, 350); return () => window.clearTimeout(timer); }, [localQuery, navigate, search]);
  useEffect(() => { if (items.length) setAnnouncement(`${items.length} Discover results loaded`); }, [items.length]);
  const update = useCallback((patch: Partial<BrowseFilters>) => navigate({ to: '/discover/browse' as never, search: { ...search, ...patch } as never }), [navigate, search]);
  const fetchNext = useCallback(async (auto = false) => { const pages = query.data?.pages ?? []; const lastPage = pages[pages.length - 1]; const nextOffset = lastPage ? lastPage.offset + lastPage.page_size : 0; if (requestedOffsets.current.has(nextOffset) || query.isFetchingNextPage || !query.hasNextPage) return; requestedOffsets.current.add(nextOffset); try { await query.fetchNextPage(); if (auto) setAutoPages(v => v + 1); } catch { requestedOffsets.current.delete(nextOffset); } }, [query]);
  return <div className={styles.page}><section className={styles.searchFirst}><h1>Browse All {search.section === 'manga' ? 'Manga' : 'Comics'}</h1><div className={styles.searchRow}><input className={styles.floatingSearchInput} type="search" aria-label="Search catalog" value={localQuery} onChange={e => setLocalQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') update({ q: localQuery.trim() || undefined }); }} placeholder={`Search all ${search.section === 'manga' ? 'manga' : 'comics'}…`} /><select className={styles.select} aria-label="Sort catalog" value={search.sort} onChange={e => update({ sort: e.target.value as BrowseFilters['sort'] })}><option value="trending">Recently Active</option><option value="title">Title</option><option value="year">Year</option><option value="recently_started">Recently Started</option><option value="recently_updated">Recently Updated</option></select></div></section><BrowseFilters search={search} onChange={update} />{query.isPending ? <div className={styles.empty}>Loading catalog…</div> : query.isError ? <div className={styles.empty}>Could not load catalog: {query.error.message}<Button onClick={() => void query.refetch()}>Retry</Button></div> : <div className={styles.grid}>{items.map(volume => <DiscoveryCatalogCard key={getDiscoveryCardKey(volume)} section={search.section} volume={volume} onOpen={() => openDiscoveryAdd(navigate, search.section, volume)} />)}</div>}<LoadMoreTrigger hasMore={Boolean(query.hasNextPage)} isFetching={query.isFetchingNextPage} autoPages={autoPages} onLoadMore={fetchNext} /><div aria-live="polite" className={styles.srOnly}>{announcement}</div></div>;
}

function BrowseFilters({ search, onChange }: { search: BrowseFilters; onChange: (patch: Partial<BrowseFilters>) => void }) {
  const active = Object.entries(search).filter(([key, value]) => !['section', 'sort', 'q'].includes(key) && value);
  return <div className={styles.filters}><span>Filters</span>{search.section === 'comic' ? <><input className={styles.filterInput} value={search.publisher ?? ''} onChange={e => onChange({ publisher: e.target.value || undefined })} placeholder="Publisher" /><input className={styles.filterInput} value={search.decade ?? ''} onChange={e => onChange({ decade: e.target.value || undefined })} placeholder="Decade, e.g. 2020" /><input className={styles.filterInput} value={search.character ?? ''} onChange={e => onChange({ character: e.target.value || undefined, genre: undefined })} placeholder="Character" /><input className={styles.filterInput} value={search.genre ?? ''} onChange={e => onChange({ genre: e.target.value || undefined, character: undefined })} placeholder="Genre" /></> : <><select className={styles.filterInput} aria-label="Manga status" value={search.status ?? ''} onChange={e => onChange({ status: e.target.value || undefined })}><option value="">Any status</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="hiatus">Hiatus</option><option value="cancelled">Cancelled</option></select><select className={styles.filterInput} aria-label="Manga demographic" value={search.demographic ?? ''} onChange={e => onChange({ demographic: e.target.value || undefined })}><option value="">Any demographic</option><option value="shounen">Shounen</option><option value="shoujo">Shoujo</option><option value="josei">Josei</option><option value="seinen">Seinen</option></select><input className={styles.filterInput} value={search.original_language ?? ''} onChange={e => onChange({ original_language: e.target.value || undefined })} placeholder="Original language, e.g. ja" /><input className={styles.filterInput} value={search.year ?? ''} onChange={e => onChange({ year: e.target.value || undefined })} placeholder="Year" /></>}{active.map(([key, value]) => <button key={key} className={styles.filterChip} onClick={() => onChange({ [key]: undefined } as Partial<BrowseFilters>)}>{key}: {String(value)} ×</button>)}</div>;
}

function LoadMoreTrigger({ hasMore, isFetching, autoPages, onLoadMore }: { hasMore: boolean; isFetching: boolean; autoPages: number; onLoadMore: (auto?: boolean) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shouldAutoLoad = hasMore && autoPages < DISCOVER_AUTOMATIC_PAGE_LIMIT;
  useEffect(() => { if (!shouldAutoLoad || isFetching || !ref.current) return; const observer = new IntersectionObserver((entries) => { if (entries.some(entry => entry.isIntersecting)) onLoadMore(true); }, { root: ref.current.closest('[data-app-scroller]') ?? null, rootMargin: '800px 0px' }); observer.observe(ref.current); return () => observer.disconnect(); }, [isFetching, onLoadMore, shouldAutoLoad]);
  if (!hasMore) return <div className={styles.empty}>End of catalog</div>;
  return <div ref={ref} className={styles.loadMoreWrap}>{shouldAutoLoad ? <span>{isFetching ? 'Loading more…' : 'More results load automatically'}</span> : <button className={styles.loadMoreSentinel} disabled={isFetching} onClick={() => onLoadMore(false)}>{isFetching ? 'Loading more…' : 'Load More'}</button>}</div>;
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
