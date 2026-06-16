import { useState, useCallback, useRef, useEffect } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import { volumeListQueryOptions } from '../-comics.api';
import { volumesSearchSchema, type ViewOption, type SectionType } from '../-comics.types';
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
import styles from './comics-page.module.css';

interface ComicsPageProps {
  section?: SectionType;
}

function getStorageVal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* corrupt storage, ignore */ }
  return fallback;
}

function setStorageVal(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* storage full, silently ignore */ }
}

/** Read URL params from the live address bar and fold in localStorage
 *  preferences for any param the URL didn't supply.  URL wins. */
function buildMergedSearch(routerSearch: Record<string, unknown>): Record<string, unknown> {
  const urlParams = new URLSearchParams(window.location.search);
  const merged = { ...routerSearch };

  if (!urlParams.has('sort')) {
    const stored = getStorageVal<string | null>(STORAGE_KEY_SORT, null);
    if (stored && (SORT_OPTIONS as readonly string[]).includes(stored)) merged.sort = stored;
  }
  if (!urlParams.has('view')) {
    const stored = getStorageVal<string | null>(STORAGE_KEY_VIEW, null);
    if (stored && (VIEW_OPTIONS as readonly string[]).includes(stored)) merged.view = stored;
  }
  if (!urlParams.has('filter')) {
    const stored = getStorageVal<string | null>(STORAGE_KEY_FILTER, null);
    if (stored && (FILTER_OPTIONS as readonly string[]).includes(stored)) merged.filter = stored;
  }
  if (!urlParams.has('search')) {
    const stored = getStorageVal<string | null>(STORAGE_KEY_SEARCH, null);
    if (stored) merged.search = stored;
  }

  return merged;
}

export function ComicsPage({ section = 'comic' }: ComicsPageProps) {
  const navigate = useNavigate();

  // Merge localStorage preferences into URL search params on initial render.
  // URL params take priority over localStorage (explicit ?sort=title wins).
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const mergedSearch = buildMergedSearch(rawSearch);
  const validated = volumesSearchSchema.parse(mergedSearch);
  const { data } = useSuspenseQuery(volumeListQueryOptions(1, validated, section));

  // Sync URL to localStorage values on first mount so the address bar
  // reflects the user's saved preferences.
  const urlSynced = useRef(false);
  useEffect(() => {
    if (urlSynced.current) return;
    const urlParams = new URLSearchParams(window.location.search);
    const sync: Record<string, unknown> = {};
    if (!urlParams.has('sort') && mergedSearch.sort && mergedSearch.sort !== 'title') {
      sync.sort = mergedSearch.sort;
    }
    if (!urlParams.has('view') && mergedSearch.view && mergedSearch.view !== 'posters') {
      sync.view = mergedSearch.view;
    }
    if (Object.keys(sync).length > 0) {
      urlSynced.current = true;
      navigate({
        to: section === 'comic' ? '/comics' : '/manga',
        search: (prev: any) => ({ ...prev, ...sync }),
        replace: true,
      });
    }
  }, []); // eslint-disable-line

  const [view, setView] = useState<ViewOption>(validated.view);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const updateSearch = useCallback(
    (patch: Record<string, unknown>) => {
      // Persist to localStorage
      if ('sort' in patch) setStorageVal(STORAGE_KEY_SORT, patch.sort);
      if ('view' in patch) setStorageVal(STORAGE_KEY_VIEW, patch.view);
      if ('filter' in patch) setStorageVal(STORAGE_KEY_FILTER, patch.filter);
      if ('search' in patch) setStorageVal(STORAGE_KEY_SEARCH, patch.search);

      navigate({ to: section === 'comic' ? '/comics' : '/manga', search: (prev: any) => ({ ...prev, ...patch }) });
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

  const volumes = data?.volumes ?? [];
  const total = data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.viewToggle}>
            {VIEW_OPTIONS.map((opt) => (
              <Button
                key={opt}
                variant={view === opt ? 'primary' : 'ghost'}
                onClick={() => {
                  setView(opt);
                  setStorageVal(STORAGE_KEY_VIEW, opt);
                }}
              >
                {opt === 'posters' ? '▦' : '☰'} {VIEW_LABELS[opt] ?? opt}
              </Button>
            ))}
          </div>

          <select
            className={styles.select}
            value={validated.filter}
            onChange={(e) => updateSearch({ filter: e.target.value })}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {FILTER_LABELS[opt] ?? (opt || 'All')}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={validated.sort}
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
          <Button variant="secondary">Update All</Button>
          <Button variant="secondary">Search All</Button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.massBar}>
          <span>{selectedIds.size} selected</span>
          <Button variant="ghost">Delete</Button>
          <Button variant="ghost">Monitor</Button>
          <Button variant="ghost">Unmonitor</Button>
          <Button variant="ghost">Refresh &amp; Scan</Button>
          <Button variant="ghost">Auto Search</Button>
        </div>
      )}

      {volumes.length === 0 ? (
        <div className={styles.empty}>
          <p>Library is empty</p>
        </div>
      ) : view === 'posters' ? (
        <div className={styles.posterGrid}>
          {volumes.map((v) => (
            <ComicCard
              key={v.id}
              volume={v}
              onSearch={(_id) => {/* TODO */}}
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
                  onSelect={toggleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Floating bottom search bar */}
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search volumes..."
          value={validated.search ?? ''}
          onChange={(e) => updateSearch({ search: e.target.value || undefined })}
        />
        {validated.search && (
          <span className={styles.searchCount}>
            {total} result{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Volumes</span>
          <span className={styles.statValue}>{total}</span>
        </div>
      </div>
    </div>
  );
}
