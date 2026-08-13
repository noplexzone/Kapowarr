import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { DialogBody, DialogFrame, DialogHeader } from '@/components/dialog';
import { AddModal } from '@/routes/add/-ui/add-page';
import { exactVolumeQueryOptions, rootFoldersQueryOptions, searchVolumesQueryOptions } from '@/routes/add/-add.api';
import { VOLUMES_KEY } from '@/routes/comics/-comics.api';
import type { SearchResult } from '@/routes/add/-add.types';
import {
  browseDiscoveryQueryOptions,
  discoveryCapabilitiesQueryOptions,
  discoveryShelfInfiniteQueryOptions,
} from '../-discovery.api';
import {
  DISCOVER_AUTOMATIC_PAGE_LIMIT,
  DISCOVER_INITIAL_PAGE_SIZE,
  dedupeDiscoveryItems,
  getDiscoveryAddSelection,
  getDiscoveryCardKey,
} from '../-discovery.types';
import type { BrowseFilters, DiscoveryCapabilities, DiscoverySection, DiscoveryType, DiscoveryVolume } from '../-discovery.types';
import styles from './discovery-page.module.css';

interface DiscoveryPageProps {
  section: DiscoverySection;
  category?: 'landing' | DiscoveryType;
  q?: string;
  canonical?: boolean;
}

export function DiscoveryPage({ section, category = 'landing', q = '' }: DiscoveryPageProps) {
  const navigate = useNavigate();
  const [addSelection, setAddSelection] = useState<DiscoveryVolume | null>(null);
  const [searchSelection, setSearchSelection] = useState<SearchResult | null>(null);
  const goSection = (next: DiscoverySection) => navigate({ to: '/discover', search: (prev: Record<string, unknown>) => ({ ...prev, section: next }) });
  const topSearch = (next: string) => navigate({ to: '/discover/browse', search: { section, q: next || undefined, sort: section === 'manga' ? 'recently_updated' : 'trending' } });

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
      <DiscoverSearch section={section} q={q} onSearch={topSearch} onSectionChange={goSection} onSelect={handleSearchSelect} />
      {section === 'manga' ? (
        <MangaDiscoverPage onAddVolume={setAddSelection} />
      ) : (
        <ComicDiscoverPage onAddVolume={setAddSelection} />
      )}
      {addSelection != null && <AddReviewDrawer volume={addSelection} section={section} onClose={() => setAddSelection(null)} />}
      {searchSelection != null && (
        <SearchResultAddModal
          result={searchSelection}
          section={section}
          onClose={() => setSearchSelection(null)}
          onAdded={() => setSearchSelection(null)}
        />
      )}
      <span className={styles.srOnly}>Discover automatic loading appends up to {DISCOVER_AUTOMATIC_PAGE_LIMIT} pages before showing Load More.</span>
      {category !== 'landing' && <ShelfFocus category={category} section={section} onAddVolume={setAddSelection} />}
    </div>
  );
}

export function ComicDiscoverPage({ onAddVolume }: { onAddVolume: (volume: DiscoveryVolume) => void }) {
  const { data: capabilities } = useQuery(discoveryCapabilitiesQueryOptions('comic'));
  return (
    <main className={styles.discoverMain} aria-label="Comic Discover">
      <DiscoveryShelf title="Recently Started" description="Series whose first known issue date is inside the last 12 months." type="new" section="comic" onAddVolume={onAddVolume} viewAll="/discover/browse?section=comic&sort=recently_started" />
      <DiscoveryShelf title="Upcoming Series Launches" description="Future issue #1 releases only, not ordinary ongoing-series issues." type="upcoming" section="comic" onAddVolume={onAddVolume} viewAll="/discover/browse?section=comic&sort=year" />
      <DiscoveryShelf title="Trending" description="ComicVine recently-updated order; not a global popularity score." type="trending" section="comic" onAddVolume={onAddVolume} viewAll="/discover/browse?section=comic&sort=trending" />
      <BrowseShortcuts section="comic" capabilities={capabilities} />
    </main>
  );
}

export function MangaDiscoverPage({ onAddVolume }: { onAddVolume: (volume: DiscoveryVolume) => void }) {
  const { data: capabilities } = useQuery(discoveryCapabilitiesQueryOptions('manga'));
  return (
    <main className={styles.discoverMain} aria-label="Manga Discover">
      <DiscoveryShelf title="Recently Started Manga" description="Current bounded manga records from available providers; richer MangaDex catalog facets wait for Phase 6." type="new" section="manga" onAddVolume={onAddVolume} viewAll="/discover/browse?section=manga&sort=recently_started" />
      <DiscoveryShelf title="Recently Updated Manga" description="Provider activity for manga records; not a ComicVine publisher mirror UI." type="recently-updated" section="manga" onAddVolume={onAddVolume} viewAll="/discover/browse?section=manga&sort=recently_updated" />
      <BrowseShortcuts section="manga" capabilities={capabilities} />
    </main>
  );
}

function ShelfFocus({ category, section, onAddVolume }: { category: DiscoveryType | 'landing'; section: DiscoverySection; onAddVolume: (volume: DiscoveryVolume) => void }) {
  if (category === 'landing') return null;
  const title = category === 'new' ? 'Recently Started' : category === 'upcoming' ? 'Upcoming Series Launches' : 'Trending';
  return <DiscoveryShelf title={title} type={category} section={section} onAddVolume={onAddVolume} expanded />;
}

function DiscoverSearch({ section, q, onSearch, onSectionChange, onSelect }: { section: DiscoverySection; q?: string; onSearch: (q: string) => void; onSectionChange: (section: DiscoverySection) => void; onSelect: (result: SearchResult) => void }) {
  const [raw, setRaw] = useState(q ?? '');
  const query = useDeferredValue(raw.trim());
  const source = section === 'manga' ? 'mangadex' : 'comicvine';
  const { data: results = [], isFetching } = useQuery({
    ...searchVolumesQueryOptions(query, section, source),
    enabled: query.length >= 2,
  });
  return (
    <section className={styles.searchFirst} aria-label="Discover search and media section">
      <div className={styles.searchRow}>
        <div className={styles.floatingSearchWrap}>
          <label className={styles.srOnly} htmlFor="discover-search">Search {section === 'manga' ? 'manga' : 'comics'}</label>
          <input id="discover-search" className={styles.floatingSearchInput} type="search" value={raw} onChange={(event) => setRaw(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(raw.trim()); }} placeholder={`Search ${section === 'manga' ? 'MangaDex manga' : 'ComicVine comics'}…`} />
          {query.length >= 2 && (
            <div className={styles.floatingResults} role="listbox" aria-label="Discover search results">
              {isFetching && results.length === 0 ? <div className={styles.floatingResultStatus}>Searching…</div> : results.slice(0, 6).map((result) => (
                <button key={`${result.metadata_source ?? source}:${result.metadata_id ?? result.comicvine_id}`} type="button" className={styles.floatingResult} onClick={() => onSelect(result)}>
                  <span className={styles.floatingResultTitle}>{result.title}</span>
                  <span className={styles.floatingResultMeta}>{[result.year, result.publisher].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.sectionToggle} aria-label="Discover section">
          <button className={`${styles.sectionBtn}${section === 'comic' ? ` ${styles.sectionActive}` : ''}`} onClick={() => onSectionChange('comic')}>Comics</button>
          <button className={`${styles.sectionBtn}${section === 'manga' ? ` ${styles.sectionActive}` : ''}`} onClick={() => onSectionChange('manga')}>Manga</button>
        </div>
      </div>
      <p className={styles.sourceFinePrint}>Unsupported Character and Genre filters are intentionally absent until Metron-backed Phase 6 data exists.</p>
    </section>
  );
}

function DiscoveryShelf({ title, description, type, section, onAddVolume, viewAll, expanded = false }: { title: string; description?: string; type: DiscoveryType; section: DiscoverySection; onAddVolume: (volume: DiscoveryVolume) => void; viewAll?: string; expanded?: boolean }) {
  const query = useInfiniteQuery(discoveryShelfInfiniteQueryOptions(type, section, DISCOVER_INITIAL_PAGE_SIZE));
  const items = dedupeDiscoveryItems((query.data?.pages ?? []).flatMap(page => page.items));
  return (
    <section className={styles.shelf} aria-labelledby={`${section}-${type}-heading`}>
      <header className={styles.shelfHeader}>
        <div><h2 id={`${section}-${type}-heading`}>{title}</h2>{description && <p>{description}</p>}</div>
        {viewAll && <Link className={styles.viewAllLink} to={viewAll}>View All</Link>}
      </header>
      {query.isPending ? <EmptyState label="Loading…" /> : query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : items.length === 0 ? <EmptyState label={`No ${title.toLowerCase()} found`} /> : (
        <div className={expanded ? styles.grid : styles.shelfScroller}>
          {items.slice(0, expanded ? undefined : 12).map((volume) => <DiscoveryCard key={getDiscoveryCardKey(volume)} volume={volume} onAction={onAddVolume} />)}
        </div>
      )}
    </section>
  );
}

function BrowseShortcuts({ section, capabilities }: { section: DiscoverySection; capabilities?: DiscoveryCapabilities }) {
  const decades = capabilities?.decades ?? [];
  const publishers = section === 'comic' ? capabilities?.publishers ?? [] : [];
  const characters = section === 'comic' ? capabilities?.characters ?? [] : [];
  const genres = section === 'comic' ? capabilities?.genres ?? [] : [];
  return (
    <section className={styles.browsePanel} aria-label={`Browse ${section === 'manga' ? 'manga' : 'comics'}`}>
      <header className={styles.shelfHeader}><div><h2>Browse All {section === 'manga' ? 'Manga' : 'Comics'}</h2><p>Only filters backed by current provider or indexed data are shown.</p></div><Link className={styles.viewAllLink} to="/discover/browse" search={{ section }}>Open Catalog</Link></header>
      {publishers.length > 0 && <ShortcutGroup title="Browse Publishers" items={publishers.map(f => ({ label: f.label, href: `/discover/browse?section=comic&publisher=${encodeURIComponent(f.value)}` }))} />}
      {characters.length > 0 && <ShortcutGroup title="Browse Characters" items={characters.map(f => ({ label: f.label, href: `/discover/browse?section=comic&character=${encodeURIComponent(f.value)}` }))} />}
      {genres.length > 0 && <ShortcutGroup title="Browse Genres" items={genres.map(f => ({ label: f.label, href: `/discover/browse?section=comic&genre=${encodeURIComponent(f.value)}` }))} />}
      <ShortcutGroup title="Browse by Decade" items={decades.map(f => ({ label: f.label, href: `/discover/browse?section=${section}&decade=${f.value}` }))} />
      <p className={styles.sourceFinePrint}>{capabilities?.deferred_filters.join(', ') || 'Character and Genre'} deferred to Phase 6 rather than displayed empty.</p>
    </section>
  );
}

function ShortcutGroup({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return <div className={styles.shortcutGroup}><h3>{title}</h3><div className={styles.shortcutChips}>{items.map((item) => <Link key={item.href} className={styles.modeChip} to={item.href}>{item.label}</Link>)}</div></div>;
}

export function DiscoveryBrowsePage({ search }: { search: BrowseFilters }) {
  const navigate = useNavigate();
  const query = useInfiniteQuery(browseDiscoveryQueryOptions(search, DISCOVER_INITIAL_PAGE_SIZE));
  const [autoPages, setAutoPages] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const items = dedupeDiscoveryItems((query.data?.pages ?? []).flatMap(page => page.items));
  const hasMore = Boolean(query.hasNextPage);
  const update = (patch: Partial<BrowseFilters>) => navigate({ to: '/discover/browse', search: { ...search, ...patch } });
  useEffect(() => { setAnnouncement(items.length ? `${items.length} Discover results loaded` : ''); }, [items.length]);
  return (
    <div className={styles.page}>
      <BrowseToolbar search={search} onChange={update} />
      <BrowseFilters search={search} onChange={update} />
      <div className={styles.grid}>
        {items.map((volume) => <DiscoveryCard key={getDiscoveryCardKey(volume)} volume={volume} onAction={() => undefined} />)}
      </div>
      {query.isPending && <EmptyState label="Loading catalog…" />}
      {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : (
        <LoadMoreTrigger
          hasMore={hasMore}
          isFetching={query.isFetchingNextPage}
          autoPages={autoPages}
          onAutoPage={() => setAutoPages((v) => v + 1)}
          onLoadMore={() => void query.fetchNextPage()}
        />
      )}
      <div aria-live="polite" className={styles.srOnly}>{announcement}</div>
    </div>
  );
}

function BrowseToolbar({ search, onChange }: { search: BrowseFilters; onChange: (patch: Partial<BrowseFilters>) => void }) {
  return <section className={styles.searchFirst}><h1 className={styles.srOnly}>Browse All {search.section === 'manga' ? 'Manga' : 'Comics'}</h1><div className={styles.searchRow}><input className={styles.floatingSearchInput} type="search" value={search.q ?? ''} onChange={(e) => onChange({ q: e.target.value || undefined })} placeholder={`Search all ${search.section === 'manga' ? 'manga' : 'comics'}…`} /><select className={styles.select} aria-label="Sort catalog" value={search.sort} onChange={(e) => onChange({ sort: e.target.value as BrowseFilters['sort'] })}><option value="trending">Trending</option><option value="title">Title</option><option value="year">Year</option><option value="recently_started">Recently Started</option><option value="recently_updated">Recently Updated</option></select></div></section>;
}

function BrowseFilters({ search, onChange }: { search: BrowseFilters; onChange: (patch: Partial<BrowseFilters>) => void }) {
  const active = Object.entries(search).filter(([key, value]) => !['section', 'sort'].includes(key) && value);
  return <div className={styles.filters}><span>Filters</span>{search.section === 'comic' && <input className={styles.filterInput} value={search.publisher ?? ''} onChange={(e) => onChange({ publisher: e.target.value || undefined })} placeholder="Publisher" />}<input className={styles.filterInput} value={search.decade ?? ''} onChange={(e) => onChange({ decade: e.target.value || undefined })} placeholder="Decade, e.g. 2020" />{search.section === 'comic' && <input className={styles.filterInput} value={search.character ?? ''} onChange={(e) => onChange({ character: e.target.value || undefined })} placeholder="Character" />} {search.section === 'comic' && <input className={styles.filterInput} value={search.genre ?? ''} onChange={(e) => onChange({ genre: e.target.value || undefined })} placeholder="Genre" />}{active.map(([key, value]) => <button key={key} className={styles.filterChip} onClick={() => onChange({ [key]: undefined } as Partial<BrowseFilters>)}>{key}: {String(value)} ×</button>)}<span className={styles.sourceFinePrint}>Character and Genre not shown unless locally indexed Metron enrichment exists.</span></div>;
}

function LoadMoreTrigger({ hasMore, isFetching, autoPages, onAutoPage, onLoadMore }: { hasMore: boolean; isFetching: boolean; autoPages: number; onAutoPage: () => void; onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shouldAutoLoad = hasMore && autoPages < DISCOVER_AUTOMATIC_PAGE_LIMIT;
  useEffect(() => {
    if (!shouldAutoLoad || isFetching || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onAutoPage();
        onLoadMore();
      }
    }, { root: ref.current.closest('[data-app-scroller]') ?? null, rootMargin: '800px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [isFetching, onAutoPage, onLoadMore, shouldAutoLoad]);
  if (!hasMore) return <div className={styles.empty}>End of catalog</div>;
  return <div ref={ref} className={styles.loadMoreWrap}>{shouldAutoLoad ? <span>{isFetching ? 'Loading more…' : 'More results load automatically'}</span> : <button className={styles.loadMoreSentinel} disabled={isFetching} onClick={onLoadMore}>{isFetching ? 'Loading more…' : 'Load More'}</button>}</div>;
}

function DiscoveryCard({ volume, onAction }: { volume: DiscoveryVolume; onAction: (volume: DiscoveryVolume) => void }) {
  const navigate = useNavigate();
  const isAdded = volume.already_added != null;
  const title = volume.volume_title || volume.title;
  const open = () => isAdded ? navigate({ to: '/volumes/$volumeId', params: { volumeId: String(volume.already_added) } }) : onAction(volume);
  return <article className={styles.volumeCard}><div className={styles.coverWrap}>{volume.cover_link ? <img src={volume.cover_link} alt={title} className={styles.cover} loading="lazy" /> : <div className={styles.coverPlaceholder}>📚</div>}<div className={styles.overlayActions}><button className={isAdded ? styles.overlayInLibrary : styles.overlayAddBtn} onClick={open}>{isAdded ? 'Open' : 'Add'}</button></div></div><div className={styles.cardBody}><h3 className={styles.cardTitle}>{title}</h3><div className={styles.cardMeta}>{[volume.year, volume.publisher, volume.issue_count != null ? `${volume.issue_count} issue${volume.issue_count === 1 ? '' : 's'}` : null, volume.status, volume.metadata_source_label ?? volume.metadata_source, volume.source_note?.includes('Metron') ? 'Metron enriched' : null].filter(Boolean).join(' · ')}</div>{volume.issue_number && <div className={styles.cardMeta}>#{volume.issue_number}{volume.cover_date ? ` · ${volume.cover_date}` : ''}</div>}</div></article>;
}

function EmptyState({ label }: { label: string }) { return <div className={styles.empty}>{label}</div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className={styles.empty}>Could not load Discover: {message}<br /><button className={styles.loadMoreSentinel} onClick={onRetry}>Retry</button></div>; }

function AddReviewDrawer({ volume, section, onClose }: { volume: DiscoveryVolume; section: DiscoverySection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const exact = useQuery(exactVolumeQueryOptions(getDiscoveryAddSelection(volume), section));
  const { data: rootFolders = [] } = useQuery(rootFoldersQueryOptions());
  if (exact.isPending) return <DialogFrame open onOpenChange={(open) => !open && onClose()}><DialogHeader title={`Add ${volume.title}`} onClose={onClose} /><DialogBody><EmptyState label="Loading add settings…" /></DialogBody></DialogFrame>;
  if (exact.isError) return <DialogFrame open onOpenChange={(open) => !open && onClose()}><DialogHeader title={`Add ${volume.title}`} onClose={onClose} /><DialogBody><ErrorState message={exact.error.message} onRetry={() => void exact.refetch()} /></DialogBody></DialogFrame>;
  return <AddModal result={exact.data} rootFolders={rootFolders} section={section} onClose={onClose} onAdded={() => { void queryClient.invalidateQueries({ queryKey: ['discovery'] }); void queryClient.invalidateQueries({ queryKey: VOLUMES_KEY }); onClose(); }} />;
}

function SearchResultAddModal({ result, section, onClose, onAdded }: { result: SearchResult; section: DiscoverySection; onClose: () => void; onAdded: () => void }) {
  const queryClient = useQueryClient();
  const exact = useQuery(exactVolumeQueryOptions({ metadata_source: result.metadata_source ?? 'comicvine', metadata_id: result.metadata_id ?? String(result.comicvine_id), metadata_language: result.metadata_language ?? undefined, title: result.title }, section));
  const { data: rootFolders = [], isPending: rootFoldersPending } = useQuery(rootFoldersQueryOptions());
  if (exact.isPending || rootFoldersPending) return <DialogFrame open onOpenChange={(open) => !open && onClose()}><DialogHeader title={`Add ${result.title}`} onClose={onClose} /><DialogBody><EmptyState label="Loading add settings…" /></DialogBody></DialogFrame>;
  if (exact.isError) return <DialogFrame open onOpenChange={(open) => !open && onClose()}><DialogHeader title={`Add ${result.title}`} onClose={onClose} /><DialogBody><ErrorState message={exact.error.message} onRetry={() => void exact.refetch()} /></DialogBody></DialogFrame>;
  const hydratedResult = { ...exact.data, metadata_language: result.metadata_language ?? exact.data.metadata_language };
  return <AddModal result={hydratedResult} rootFolders={rootFolders} section={section} onClose={onClose} onAdded={() => { void queryClient.invalidateQueries({ queryKey: ['discovery'] }); void queryClient.invalidateQueries({ queryKey: ['volumes', 'search'] }); void queryClient.invalidateQueries({ queryKey: VOLUMES_KEY }); onAdded(); }} />;
}

export function getDiscoveryHeading(section: DiscoverySection, _type: DiscoveryType | 'landing'): string { return `${section === 'manga' ? 'Manga' : 'Comics'} Discover`; }
export function getDiscoverySubheading(section: DiscoverySection, _type: DiscoveryType | 'landing'): string { return section === 'manga' ? 'Manga provider-appropriate discovery.' : 'Hybrid comic shelves and Browse All catalog.'; }
