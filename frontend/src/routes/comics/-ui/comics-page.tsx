import { useState, useCallback, useEffect, useRef } from 'react';
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
  FILTER_LABELS,
  VIEW_LABELS,
  STORAGE_KEY_SORT,
  STORAGE_KEY_VIEW,
  STORAGE_KEY_FILTER,
  STORAGE_KEY_SEARCH,
} from '../-comics.types';
import { ComicCard } from './comic-card';
import { ComicTableRow } from './comic-table-row';
import { getSelectionScopeKey, runBounded } from '../-comics.helpers';
import styles from './comics-page.module.css';

interface ComicsPageProps {
  section?: SectionType;
}

function setStorageVal(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* storage full, silently ignore */ }
}


export function ComicsPage({ section = 'comic' }: ComicsPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const search = useSearch({ strict: false }) as VolumesSearch;
  const { data } = useSuspenseQuery(volumeListQueryOptions(1, search, section));

  const [view, setView] = useState<ViewOption>(search.view);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [manageMode, setManageMode] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const selectionScopeKey = getSelectionScopeKey(section, search);

  // Local search text for instant typing; debounced sync to URL/query
  const [searchText, setSearchText] = useState(search.search ?? '');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external URL search into local state (e.g. browser back/forward)
  useEffect(() => {
    setSearchText(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionScopeKey]);

  // Debounced: flush local text to URL after 350ms of inactivity
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = searchText.trim();
      const current = search.search ?? '';
      if (trimmed !== current) {
        setStorageVal(STORAGE_KEY_SEARCH, trimmed || undefined);
        navigate({
          to: section === 'comic' ? '/comics' : '/manga',
          search: (prev: any) => ({
            ...prev,
            search: trimmed || undefined,
            offset: 0,
          }),
        });
      }
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSearch = useCallback(
    (patch: Record<string, unknown>) => {
      // Persist to localStorage
      if ('sort' in patch) setStorageVal(STORAGE_KEY_SORT, patch.sort);
      if ('view' in patch) setStorageVal(STORAGE_KEY_VIEW, patch.view);
      if ('filter' in patch) setStorageVal(STORAGE_KEY_FILTER, patch.filter);
      if ('search' in patch) setStorageVal(STORAGE_KEY_SEARCH, patch.search);

      const resetsPage = ('sort' in patch || 'filter' in patch || 'search' in patch)
        && !('offset' in patch);
      navigate({
        to: section === 'comic' ? '/comics' : '/manga',
        search: (prev: any) => ({
          ...prev,
          ...patch,
          ...(resetsPage ? { offset: 0 } : {}),
        }),
      });
    },
    [navigate, section],
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

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.searchBar}>
            <label className={styles.srOnly} htmlFor={`${section}-library-search`}>Search library</label>
            <input
              id={`${section}-library-search`}
              className={styles.searchInput}
              type="search"
              placeholder={`Search ${section === 'comic' ? 'comics' : 'manga'}…`}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {search.search && <span className={styles.searchCount}>{total} results</span>}
          </div>

          <div className={styles.viewToggle}>
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
            value={search.sort}
            onChange={(e) => updateSearch({ sort: e.target.value })}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {SORT_LABELS[opt] ?? opt.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.toolbarRight}>
          <Button variant={manageMode ? 'primary' : 'secondary'} aria-pressed={manageMode} onClick={() => { setManageMode((value) => { if (value) setSelectedIds(new Set()); return !value; }); }}>
            {manageMode ? 'Done Managing' : 'Manage'}
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

      {actionMessage && <StatusBanner>{actionMessage}</StatusBanner>}

      {manageMode && (
        <div className={styles.massBar} data-testid="bulk-toolbar">
          <span>{selectedIds.size} selected</span>
          <Button variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>Clear Selection</Button>
          <Button
            variant="ghost"
            disabled={pendingAction !== null}
            onClick={() => {
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
          >Delete</Button>
          <Button
            variant="ghost"
            disabled={pendingAction !== null}
            onClick={() => runSelected(
              'monitor-selected',
              (id) => setVolumeMonitored(id, true),
              'Monitored',
            )}
          >Monitor</Button>
          <Button
            variant="ghost"
            disabled={pendingAction !== null}
            onClick={() => runSelected(
              'unmonitor-selected',
              (id) => setVolumeMonitored(id, false),
              'Unmonitored',
            )}
          >Unmonitor</Button>
          <Button
            variant="ghost"
            disabled={pendingAction !== null}
            onClick={() => runSelected(
              'scan-selected',
              (id) => runVolumeTask(id, 'refresh_and_scan'),
              'Queued refresh and scan for',
            )}
          >Refresh &amp; Scan</Button>
          <Button
            variant="ghost"
            disabled={pendingAction !== null}
            onClick={() => runSelected(
              'search-selected',
              (id) => runVolumeTask(id, 'auto_search'),
              'Queued search for',
            )}
          >Auto Search</Button>
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
              selectionVisible={manageMode || selectedIds.size > 0}
              pending={pendingAction === `search-${v.id}` || pendingAction === `monitor-${v.id}`}
              onSelect={toggleSelect}
              onMonitor={(id, monitored) => performAction(
                `monitor-${id}`,
                () => setVolumeMonitored(id, monitored),
                `${v.title} is now ${monitored ? 'monitored' : 'unmonitored'}.`,
              )}
              onSearch={(id) => performAction(
                `search-${id}`,
                () => runVolumeTask(id, 'auto_search'),
                `Search queued for ${v.title}.`,
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
