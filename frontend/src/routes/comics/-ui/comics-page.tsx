import { useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import { Pagination } from '@/components/pagination/pagination';
import { EmptyState, StatusBanner } from '@/components/patterns';
import {
  deleteLibraryVolume,
  runLibraryTask,
  runVolumeTask,
  setVolumeMonitored,
  volumeListQueryOptions,
  VOLUMES_KEY,
} from '../-comics.api';
import { type ViewOption, type SectionType, type VolumesSearch } from '../-comics.types';
import {
  SORT_OPTIONS,
  FILTER_OPTIONS,
  VIEW_OPTIONS,
  SORT_LABELS,
  DIRECTION_LABELS,
  COMPLETION_DIRECTION_LABELS,
  FILTER_LABELS,
  VIEW_LABELS,
  STORAGE_KEY_SORT,
  STORAGE_KEY_VIEW,
  STORAGE_KEY_FILTER,
  STORAGE_KEY_SEARCH,
} from '../-comics.types';
import { ComicCard } from './comic-card';
import { ComicTableRow } from './comic-table-row';
import { getMissingCount, getSelectionScopeKey, getStoredSortPreference, hasMissingIssues, runBounded } from '../-comics.helpers';
import styles from './comics-page.module.css';

interface ComicsPageProps {
  section?: SectionType;
  canonical?: boolean;
}

function setStorageVal(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* storage full, silently ignore */ }
}


export function ComicsPage({ section = 'comic', canonical = false }: ComicsPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = canonical ? '/library' : section === 'comic' ? '/comics' : '/manga';

  const rawSearch = useSearch({ strict: false }) as any;
  const search: VolumesSearch = canonical ? {
    sort: rawSearch.sort,
    filter: rawSearch.monitoring === 'unmonitored' ? 'unmonitored' : rawSearch.monitoring === 'monitored' ? 'monitored' : rawSearch.status === 'missing' ? 'wanted' : rawSearch.status === 'upcoming' ? 'upcoming' : '',
    view: rawSearch.view === 'list' ? 'table' : 'posters',
    search: rawSearch.q,
    offset: Math.max(0, (rawSearch.page ?? 1) - 1),
    direction: rawSearch.direction === 'desc' ? 'desc' : 'asc',
  } : rawSearch as VolumesSearch;
  const { data } = useSuspenseQuery(volumeListQueryOptions(1, search, section));

  const [view, setView] = useState<ViewOption>(search.view);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [manageMode, setManageMode] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const selectionScopeKey = getSelectionScopeKey(section, search);

  // Local search text for instant typing; debounced sync to URL/query
  const initialSearchText = search.search ?? '';
  const [searchText, setSearchText] = useState(initialSearchText);
  const searchTextRef = useRef(initialSearchText);
  const routeSearchRef = useRef(initialSearchText);
  const searchDirtyRef = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchNavigationSequenceRef = useRef(0);
  const latestSettledSearchSequenceRef = useRef(0);
  const externalSearchNavigationRef = useRef<string | null>(null);
  const pendingSearchNavigationsRef = useRef<Array<{
    sequence: number;
    value: string;
  }>>([]);

  const navigateSearch = useCallback((trimmed: string) => {
    const sequence = searchNavigationSequenceRef.current + 1;
    searchNavigationSequenceRef.current = sequence;
    pendingSearchNavigationsRef.current.push({ sequence, value: trimmed });
    setStorageVal(STORAGE_KEY_SEARCH, trimmed || undefined);
    navigate({
      to: route,
      search: (prev: any) => canonical
        ? ({ ...prev, section, q: trimmed || undefined, page: 1 })
        : ({ ...prev, search: trimmed || undefined, offset: 0 }),
    });
  }, [canonical, navigate, route, section]);

  useEffect(() => {
    const markExternalNavigation = () => {
      const params = new URLSearchParams(window.location.search);
      externalSearchNavigationRef.current = params.get(
        canonical ? 'q' : 'search',
      ) ?? '';
    };
    window.addEventListener('popstate', markExternalNavigation);
    return () => window.removeEventListener('popstate', markExternalNavigation);
  }, [canonical]);

  // Sync genuine external URL changes, but never replace a newer local draft.
  useEffect(() => {
    const routeSearch = search.search ?? '';
    routeSearchRef.current = routeSearch;

    const externalSearch = externalSearchNavigationRef.current;
    if (externalSearch !== null) {
      externalSearchNavigationRef.current = null;
      if (externalSearch === routeSearch) {
        pendingSearchNavigationsRef.current = [];
        latestSettledSearchSequenceRef.current = searchNavigationSequenceRef.current;
        searchDirtyRef.current = false;
        searchTextRef.current = routeSearch;
        setSearchText(routeSearch);
        return;
      }
    }

    const pending = pendingSearchNavigationsRef.current;
    let pendingIndex = -1;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].value === routeSearch) {
        pendingIndex = index;
        break;
      }
    }
    if (pendingIndex >= 0) {
      const [settled] = pending.splice(pendingIndex, 1);
      if (settled.sequence < latestSettledSearchSequenceRef.current) {
        const desiredSearch = searchTextRef.current.trim();
        if (routeSearch !== desiredSearch) navigateSearch(desiredSearch);
        return;
      }
      latestSettledSearchSequenceRef.current = settled.sequence;
    }

    if (searchTextRef.current.trim() === routeSearch) {
      searchDirtyRef.current = false;
      return;
    }
    if (searchDirtyRef.current) return;

    searchTextRef.current = routeSearch;
    setSearchText(routeSearch);
  }, [navigateSearch, search.search]);

  useEffect(() => {
    setView(search.view);
  }, [search.view]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionScopeKey]);

  useEffect(() => {
    if (!canonical || typeof window === 'undefined') return;
    const hasSortParam = new URLSearchParams(window.location.search).has('sort');
    if (hasSortParam) return;
    const storedSort = getStoredSortPreference(window.localStorage, STORAGE_KEY_SORT);
    if (storedSort && storedSort !== search.sort) {
      navigate({
        to: route,
        search: (previous: any) => ({ ...previous, section, sort: storedSort, page: 1 }),
        replace: true,
      });
    }
  }, [canonical, navigate, search.sort, section]);

  // Debounced: flush local text to URL after 350ms of inactivity
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = searchText.trim();
      const current = routeSearchRef.current;
      if (trimmed !== current) navigateSearch(trimmed);
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [navigateSearch, searchText]);

  const updateSearch = useCallback(
    (patch: Record<string, unknown>) => {
      // Persist to localStorage
      if ('sort' in patch) setStorageVal(STORAGE_KEY_SORT, patch.sort);
      if ('view' in patch) setStorageVal(STORAGE_KEY_VIEW, patch.view);
      if ('filter' in patch) setStorageVal(STORAGE_KEY_FILTER, patch.filter);
      if ('search' in patch) setStorageVal(STORAGE_KEY_SEARCH, patch.search);

      const resetsPage = ('sort' in patch || 'direction' in patch || 'filter' in patch || 'search' in patch)
        && !('offset' in patch);
      if (canonical) {
        const canonicalPatch: Record<string, unknown> = {};
        if ('sort' in patch) canonicalPatch.sort = patch.sort;
        if ('view' in patch) canonicalPatch.view = patch.view === 'table' ? 'list' : 'grid';
        if ('direction' in patch) canonicalPatch.direction = patch.direction;
        if ('search' in patch) canonicalPatch.q = patch.search;
        if ('offset' in patch) canonicalPatch.page = Number(patch.offset) + 1;
        if ('filter' in patch) {
          canonicalPatch.status = patch.filter === 'wanted' ? 'missing' : patch.filter === 'upcoming' ? 'upcoming' : 'all';
          canonicalPatch.monitoring = patch.filter === 'unmonitored' ? 'unmonitored' : patch.filter === 'monitored' ? 'monitored' : 'all';
        }
        if (resetsPage) canonicalPatch.page = 1;
        navigate({ to: route, search: (prev: any) => ({ ...prev, section, ...canonicalPatch }) });
      } else {
        navigate({ to: section === 'comic' ? '/comics' : '/manga', search: (prev: any) => ({ ...prev, ...patch, ...(resetsPage ? { offset: 0 } : {}) }) });
      }
    },
    [canonical, navigate, route, section],
  );

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const performAction = useCallback(async (
    name: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    if (pendingAction) return;
    setPendingAction(name);
    setActionMessage('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: VOLUMES_KEY });
      setActionMessage(success);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, queryClient]);

  const runSelected = useCallback(async (
    name: string,
    action: (id: number) => Promise<unknown>,
    successVerb: string,
  ) => {
    const ids = [...selectedIds];
    await performAction(name, async () => {
      const results = await runBounded(ids, 4, action);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) {
        throw new Error(`${failures.length} of ${ids.length} selected volumes failed.`);
      }
      setSelectedIds(new Set());
    }, `${successVerb} ${ids.length} selected volume${ids.length === 1 ? '' : 's'}.`);
  }, [performAction, selectedIds]);


  const volumes = data?.volumes ?? [];
  const total = data?.total ?? 0;
  const selectedVolumes = volumes.filter((volume) => selectedIds.has(volume.id));
  const selectedMissingVolumes = selectedVolumes.filter(hasMissingIssues);
  const selectedMissingIds = selectedMissingVolumes.map((volume) => volume.id);
  const selectedMissingIssues = selectedMissingVolumes.reduce((sum, volume) => sum + getMissingCount(volume), 0);
  const hasSelection = selectedIds.size > 0;
  const selectedLabel = `${selectedIds.size} selected`;
  const bulkActionDisabled = pendingAction !== null || !hasSelection;
  const missingBulkDisabled = pendingAction !== null || selectedMissingIds.length === 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.srOnly}>{section === 'comic' ? 'Comic Library' : 'Manga Library'}</h1>
      <div className={styles.libraryHeader}>
        <div className={styles.primaryControls}>
          <div className={styles.sectionToggle} aria-label="Library section">
            {(['comic', 'manga'] as const).map((option) => (
              <Button
                key={option}
                variant={section === option ? 'primary' : 'ghost'}
                aria-pressed={section === option}
                onClick={() => navigate({
                  to: '/library',
                  search: (previous: any) => ({
                    ...previous,
                    section: option,
                    page: 1,
                  }),
                })}
              >
                {option === 'comic' ? 'Comics' : 'Manga'}
              </Button>
            ))}
          </div>
          <div className={styles.searchBar}>
            <label className={styles.srOnly} htmlFor={`${section}-library-search`}>Search library</label>
            <input
              id={`${section}-library-search`}
              className={styles.searchInput}
              type="search"
              placeholder={`Search ${section === 'comic' ? 'comics' : 'manga'}…`}
              value={searchText}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const nextSearchText = e.target.value;
                searchTextRef.current = nextSearchText;
                searchDirtyRef.current = nextSearchText.trim() !== routeSearchRef.current;
                setSearchText(nextSearchText);
              }}
            />
            {search.search && <span className={styles.searchCount}>{total} results</span>}
          </div>

          <div className={styles.toolbarRight}>
            <Button variant={manageMode ? 'primary' : 'secondary'} aria-pressed={manageMode} onClick={() => { setManageMode((value) => { if (value) setSelectedIds(new Set()); return !value; }); }}>
              {manageMode ? 'Done' : 'Manage'}
            </Button>
            <Button
              variant="secondary"
              disabled={pendingAction !== null}
              onClick={() => performAction(
                'update-all',
                () => runLibraryTask('update_all'),
                'Library update queued.',
              )}
            >
              {pendingAction === 'update-all' ? 'Queuing…' : 'Update All'}
            </Button>
            <Button
              variant="secondary"
              disabled={pendingAction !== null}
              onClick={() => performAction(
                'search-all',
                () => runLibraryTask('search_all'),
                'Library search queued.',
              )}
            >
              {pendingAction === 'search-all' ? 'Queuing…' : 'Search All'}
            </Button>
          </div>
        </div>

        <div className={styles.secondaryControls}>
          <div className={styles.viewToggle} aria-label="Library view">
            {VIEW_OPTIONS.map((opt) => (
              <Button
                key={opt}
                variant={view === opt ? 'primary' : 'ghost'}
                onClick={() => {
                  setView(opt);
                  updateSearch({ view: opt });
                }}
              >
                {opt === 'posters' ? '▦' : '☰'} {VIEW_LABELS[opt] ?? opt}
              </Button>
            ))}
          </div>

          <div className={styles.filterChips} aria-label="Library filter">
            {FILTER_OPTIONS.map((opt) => (
              <Button
                key={opt || 'all'}
                className={styles.filterChip}
                variant={search.filter === opt ? 'primary' : 'ghost'}
                aria-pressed={search.filter === opt}
                onClick={() => updateSearch({ filter: opt })}
              >
                {FILTER_LABELS[opt] ?? (opt || 'All')}
              </Button>
            ))}
          </div>

          <select
            className={styles.select}
            aria-label="Sort library"
            value={search.sort}
            onChange={(e) => updateSearch({ sort: e.target.value })}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {SORT_LABELS[opt] ?? opt.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          <div className={styles.directionGroup} aria-label="Sort direction">
            {(['asc', 'desc'] as const).map((direction) => (
              <Button
                key={direction}
                variant={search.direction === direction ? 'primary' : 'ghost'}
                aria-pressed={search.direction === direction}
                title={search.sort === 'completion' ? COMPLETION_DIRECTION_LABELS[direction] : DIRECTION_LABELS[direction]}
                onClick={() => updateSearch({ direction })}
              >
                {direction === 'asc' ? 'Ascending' : 'Descending'}
              </Button>
            ))}
          </div>
        </div>

      </div>

      {actionMessage && <StatusBanner>{actionMessage}</StatusBanner>}

      {manageMode && (
        <div className={styles.massBar} data-testid="bulk-toolbar" aria-label={`${section === 'comic' ? 'Comics' : 'Manga'} bulk actions`}>
          <div className={styles.massSummary}>
            <strong>{selectedLabel}</strong>
            <span>Scope: current {section === 'comic' ? 'Comics' : 'Manga'} results</span>
          </div>
          <Button variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={!hasSelection}>Clear Selection</Button>
          <Button
            variant="secondary"
            disabled={bulkActionDisabled}
            onClick={() => {
              if (!hasSelection) return;
              const selectedNames = volumes
                .filter((volume) => selectedIds.has(volume.id))
                .map((volume) => volume.title)
                .join(', ');
              if (window.confirm(
                `Remove ${selectedIds.size} volume${selectedIds.size === 1 ? '' : 's'} from Kapowarr?\n\n${selectedNames}\n\nMedia folders will be preserved.`,
              )) {
                void runSelected('delete-selected', deleteLibraryVolume, 'Removed');
              }
            }}
          >Delete Selected</Button>
          <Button
            variant="secondary"
            disabled={bulkActionDisabled}
            onClick={() => runSelected(
              'monitor-selected',
              (id) => setVolumeMonitored(id, true),
              'Monitored',
            )}
          >Monitor Selected</Button>
          <Button
            variant="secondary"
            disabled={bulkActionDisabled}
            onClick={() => runSelected(
              'unmonitor-selected',
              (id) => setVolumeMonitored(id, false),
              'Unmonitored',
            )}
          >Unmonitor Selected</Button>
          <Button
            variant="secondary"
            disabled={bulkActionDisabled}
            onClick={() => runSelected(
              'scan-selected',
              (id) => runVolumeTask(id, 'refresh_and_scan'),
              'Queued refresh and scan for',
            )}
          >Refresh &amp; Scan Selected</Button>
          <Button
            variant="secondary"
            disabled={missingBulkDisabled}
            title={selectedMissingIds.length > 0 ? `${selectedMissingIssues} missing issue${selectedMissingIssues === 1 ? '' : 's'} across selected volumes` : 'Select volumes with missing issues'}
            onClick={() => performAction(
              'search-selected-missing',
              async () => {
                const results = await runBounded(selectedMissingIds, 4, (id) => runVolumeTask(id, 'auto_search'));
                const failures = results.filter((result) => result.status === 'rejected');
                if (failures.length) {
                  throw new Error(`${failures.length} of ${selectedMissingIds.length} selected missing volumes failed to queue.`);
                }
                setSelectedIds(new Set());
              },
              `Queued missing search for ${selectedMissingIds.length} selected volume${selectedMissingIds.length === 1 ? '' : 's'}.`,
            )}
          >Search Missing Selected</Button>
        </div>
      )}

      {volumes.length === 0 ? (
        <EmptyState
          title={search.search || search.filter ? 'No matching volumes' : 'Library is empty'}
          description={search.search || search.filter
            ? 'Clear the search or filters to see the rest of the library.'
            : 'Add or import a volume to start building this library.'}
        />
      ) : view === 'posters' ? (
        <div className={styles.posterGrid}>
          {volumes.map((v) => (
            <ComicCard
              key={v.id}
              volume={v}
              selected={selectedIds.has(v.id)}
              manageMode={manageMode}
              selectionVisible={manageMode || selectedIds.size > 0}
              pending={pendingAction === `search-${v.id}`}
              onSelect={toggleSelect}
              onMonitor={(id, monitored) => performAction(
                `monitor-${id}`,
                () => setVolumeMonitored(id, monitored),
                `${monitored ? 'Monitored' : 'Unmonitored'} ${v.title}.`,
              )}
              onSearch={(id) => performAction(
                `search-${id}`,
                () => runVolumeTask(id, 'auto_search'),
                `Missing search queued for ${v.title}.`,
              )}
            />
          ))}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thCheck}> </th>
                <th>Title</th>
                <th>Year</th>
                <th>Volume</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {volumes.map((v) => (
                <ComicTableRow
                  key={v.id}
                  volume={v}
                  selected={selectedIds.has(v.id)}
                  selectionVisible={manageMode || selectedIds.size > 0}
                  onSelect={toggleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={data.offset}
        pageSize={data.page_size}
        total={total}
        onPageChange={(offset) => updateSearch({ offset })}
      />

      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Volumes</span>
          <span className={styles.statValue}>{total}</span>
        </div>
      </div>
    </div>
  );
}
