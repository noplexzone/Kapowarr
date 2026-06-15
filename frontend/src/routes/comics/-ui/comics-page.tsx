import { useState, useCallback, useEffect, useRef } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
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

export function ComicsPage({ section = 'comic' }: ComicsPageProps) {
  const navigate = useNavigate();

  // Read raw URL params to detect what's actually in the URL (not schema-parsed defaults)
  const rawParams = new URLSearchParams(window.location.search);
  const rawSort = rawParams.get('sort');
  const rawView = rawParams.get('view');
  const rawFilter = rawParams.get('filter');

  // Hydrate from localStorage when no URL param is present
  const [hydrated] = useState(() => {
    const patch: Record<string, unknown> = {};
    if (!rawSort) {
      const stored = getStorageVal<string | null>(STORAGE_KEY_SORT, null);
      if (stored && SORT_OPTIONS.includes(stored as any)) patch.sort = stored;
    }
    if (!rawView) {
      const stored = getStorageVal<string | null>(STORAGE_KEY_VIEW, null);
      if (stored && VIEW_OPTIONS.includes(stored as any)) patch.view = stored;
    }
    if (!rawFilter) {
      const stored = getStorageVal<string | null>(STORAGE_KEY_FILTER, null);
      if (stored && FILTER_OPTIONS.includes(stored as any)) patch.filter = stored;
    }
    return patch;
  });

  // Defer navigation to localStorage defaults in a useEffect so React hooks are stable
  const hydrationDone = useRef(false);
  useEffect(() => {
    if (hydrationDone.current) return;
    hydrationDone.current = true;
    if (Object.keys(hydrated).length > 0) {
      navigate({ to: section === 'comic' ? '/comics' : '/manga', search: (prev: any) => ({ ...prev, ...hydrated }), replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After hydration navigation, fetch with merged params
  const search = { sort: rawSort, view: rawView, filter: rawFilter };
  const validated = volumesSearchSchema.parse(search);
  const { data } = useSuspenseQuery(volumeListQueryOptions(1, validated, section));

  const [view, setView] = useState<ViewOption>(validated.view);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const updateSearch = useCallback(
    (patch: Record<string, unknown>) => {
      // Persist to localStorage
      if ('sort' in patch) setStorageVal(STORAGE_KEY_SORT, patch.sort);
      if ('view' in patch) setStorageVal(STORAGE_KEY_VIEW, patch.view);
      if ('filter' in patch) setStorageVal(STORAGE_KEY_FILTER, patch.filter);

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

          <input
            className={styles.search}
            type="search"
            placeholder="Search volumes..."
            defaultValue={validated.search}
            onChange={(e) => updateSearch({ search: e.target.value || undefined })}
          />
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

      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Volumes</span>
          <span className={styles.statValue}>{total}</span>
        </div>
      </div>
    </div>
  );
}
