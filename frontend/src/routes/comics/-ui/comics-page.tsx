import { useState, useCallback, useEffect, useRef } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import { volumeListQueryOptions } from '../-comics.api';
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

  const search = useSearch({ strict: false }) as VolumesSearch;
  const { data } = useSuspenseQuery(volumeListQueryOptions(1, search, section));

  const [view, setView] = useState<ViewOption>(search.view);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Local search text for instant typing; debounced sync to URL/query
  const [searchText, setSearchText] = useState(search.search ?? '');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external URL search into local state (e.g. browser back/forward)
  useEffect(() => {
    setSearchText(search.search ?? '');
  }, [search.search]);

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
            value={search.filter}
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
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        {search.search && (
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
