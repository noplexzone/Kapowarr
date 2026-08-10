import { runtimeConfig } from '@/app/runtime-config';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useShellStore } from './store';
import { queueQueryOptions, QUEUE_KEY } from '@/routes/activity/queue/-queue.api';
import { useSocketEvent } from '@/platform/socketio/socket';
import { systemAboutQueryOptions } from '@/routes/system/-system.api';
import { NavIcon } from './nav-icons';
import styles from './sidebar.module.css';

interface NavItem {
  label: string;
  to: string;
  badge?: number;
  children?: NavItem[];
  search?: Record<string, string>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/' },
  {
    label: 'Comics',
    to: '/comics',
    children: [
      { label: 'Library', to: '/comics' },
      { label: 'Add Volume', to: '/comics/add' },
    ],
  },
  {
    label: 'Manga',
    to: '/manga',
    children: [
      { label: 'Library', to: '/manga' },
      { label: 'Add Volume', to: '/manga/add' },
    ],
  },
  { label: 'Discovery', to: '/discovery' },
  { label: 'Library Import', to: '/import' },
  {
    label: 'Activity',
    to: '/activity/queue',
    children: [
      { label: 'Queue', to: '/activity/queue' },
      { label: 'History', to: '/activity/history' },
      { label: 'Comic Mismatches', to: '/activity/mismatches', search: { section: 'comic' } },
      { label: 'Manga Mismatches', to: '/activity/mismatches', search: { section: 'manga' } },
      { label: 'Blocklist', to: '/activity/blocklist' },
    ],
  },
  { label: 'Settings', to: '/settings' },
  {
    label: 'System',
    to: '/system/status',
    children: [
      { label: 'Status', to: '/system/status' },
      { label: 'Tasks', to: '/system/tasks' },
    ],
  },
];

// ── Collapsible group state (localStorage-persisted) ──────────────────

const GROUP_STORAGE_KEY = 'kapowarr_sidebar_groups';

const DEFAULT_EXPANDED: Record<string, boolean> = {
  Comics: true,
  Manga: true,
  Activity: false,
  System: false,
};

const THEMES: Record<string, string> = {
  Light: 'light',
  Dark: 'dark-mode',
  Batman: 'batman-mode',
  'Spider-Man': 'spiderman-mode',
  Invincible: 'invincible-mode',
  Superman: 'superman-mode',
  'Iron Man': 'ironman-mode',
  'Wonder Woman': 'wonderwoman-mode',
  'The Flash': 'flash-mode',
  'Green Lantern': 'greenlantern-mode',
  'Captain America': 'captainamerica-mode',
};

function loadGroupState(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(GROUP_STORAGE_KEY);
    if (saved) return { ...DEFAULT_EXPANDED, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return { ...DEFAULT_EXPANDED };
}

function saveGroupState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function isNavActive(item: NavItem, pathname: string, search: Record<string, unknown> = {}): boolean {
  if (item.to === '/') return pathname === '/';
  if (item.children?.some((child) => isSubActive(child, pathname, search))) return true;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function isSubActive(child: NavItem, pathname: string, search: Record<string, unknown> = {}): boolean {
  if (pathname !== child.to && !pathname.startsWith(`${child.to}/`)) return false;
  return !child.search || Object.entries(child.search).every(([key, value]) => search[key] === value);
}

function useQueueBadge(): number | undefined {
  const queryClient = useQueryClient();

  const { data: count } = useQuery({
    ...queueQueryOptions(),
    select: (queue: unknown[]) => queue.length,
    refetchInterval: 30_000,
  });

  useSocketEvent('queue_added', useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }, [queryClient]));

  useSocketEvent('queue_ended', useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }, [queryClient]));

  return count;
}

// ── Component ──────────────────────────────────────────────────────────

interface SidebarSearchProps {
  collapsed: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onExpand: () => void;
}

export function SidebarSearch({
  collapsed,
  query,
  onQueryChange,
  onSubmit,
  onExpand,
}: SidebarSearchProps) {
  const searchIcon = (
    <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );

  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.collapsedSearchButton}
        onClick={onExpand}
        aria-label="Open library search"
        title="Open library search"
      >
        {searchIcon}
      </button>
    );
  }

  return (
    <div className={styles.searchBar} role="search">
      {searchIcon}
      <input
        type="search"
        className={styles.searchInput}
        aria-label="Search library"
        placeholder="Search library…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim()) onSubmit();
        }}
        autoComplete="off"
      />
    </div>
  );
}

export interface SidebarProps {
  overlayOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ overlayOpen = false, onClose }: SidebarProps) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const theme = useShellStore((s) => s.theme);
  const setTheme = useShellStore((s) => s.setTheme);
  const queueBadge = useQueueBadge();
  const { data: about } = useQuery(systemAboutQueryOptions());
  const [query, setQuery] = useState('');
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>(loadGroupState);

  const toggleGroup = (label: string) => {
    setGroupExpanded((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      saveGroupState(next);
      return next;
    });
  };

  const handleThemeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      localStorage.setItem('kapowarr-theme', val);
      document.documentElement.dataset.theme = val;
      setTheme(val);
    },
    [setTheme],
  );

  const handleSearchSubmit = useCallback(() => {
    if (query.trim()) {
      navigate({ to: '/comics', search: { search: query.trim() } });
      onClose?.();
    }
  }, [navigate, query, onClose]);

  return (
    <aside
      className={clsx(
        styles.sidebar,
        sidebarCollapsed && !overlayOpen && styles.collapsed,
        overlayOpen && styles.overlayOpen,
      )}
    >
      <div className={styles.brand}>
        <img className={styles.brandIcon} src={runtimeConfig.faviconUrl} alt="Kapowarr" />
        {(!sidebarCollapsed || overlayOpen) && <span className={styles.brandText}>Kapowarr</span>}
        {overlayOpen && onClose && (
          <button
            type="button"
            className={styles.mobileClose}
            onClick={onClose}
            aria-label="Close navigation menu"
            title="Close menu"
          >
            ×
          </button>
        )}
      </div>

      <SidebarSearch
        collapsed={sidebarCollapsed && !overlayOpen}
        query={query}
        onQueryChange={setQuery}
        onSubmit={handleSearchSubmit}
        onExpand={toggleSidebar}
      />

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(item, pathname, search as Record<string, unknown>);
          const badge = item.label === 'Activity' ? queueBadge : item.badge;
          const hasChildren = item.children && item.children.length > 0;
          const isExpanded = hasChildren ? groupExpanded[item.label] ?? false : false;

          if (!hasChildren) {
            return (
              <div key={item.to + item.label} className={styles.navGroup}>
                <Link to={item.to as any} className={clsx(styles.navItem, active && styles.active)} onClick={onClose} title={sidebarCollapsed ? item.label : undefined} aria-current={active ? 'page' : undefined}>
                  <NavIcon name={item.label} className={styles.navIcon} />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                  {badge != null && badge > 0 && <span className={styles.badge}>{badge}</span>}
                </Link>
              </div>
            );
          }

          return (
            <div key={item.to + item.label} className={styles.navGroup}>
              {(!sidebarCollapsed || overlayOpen) ? (
                <div className={styles.navParent}>
                  <Link to={item.to as any} className={clsx(styles.navItem, active && styles.active)} onClick={onClose} title={sidebarCollapsed ? item.label : undefined}>
                    <NavIcon name={item.label} className={styles.navIcon} />
                    <span>{item.label}</span>
                    {badge != null && badge > 0 && <span className={styles.badge}>{badge}</span>}
                  </Link>
                  <button type="button" className={clsx(styles.chevron, isExpanded && styles.chevronOpen)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleGroup(item.label); }} aria-label={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`} aria-expanded={isExpanded}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              ) : (
                <Link to={item.to as any} className={clsx(styles.navItem, active && styles.active)} onClick={onClose} title={sidebarCollapsed ? item.label : undefined}>
                  <NavIcon name={item.label} className={styles.navIcon} />
                  {badge != null && badge > 0 && <span className={styles.badge}>{badge}</span>}
                </Link>
              )}

              <div className={clsx(styles.subNav, (!isExpanded || (sidebarCollapsed && !overlayOpen)) && styles.subNavCollapsed)} aria-hidden={!isExpanded || (sidebarCollapsed && !overlayOpen) || undefined} inert={isExpanded && (!sidebarCollapsed || overlayOpen) ? undefined : true}>
                {item.children!.map((child) => (
                  <Link key={`${child.to}:${JSON.stringify(child.search)}`} to={child.to as any} search={child.search as any} className={clsx(styles.subNavItem, isSubActive(child, pathname, search as Record<string, unknown>) && styles.subActive)} aria-current={isSubActive(child, pathname, search as Record<string, unknown>) ? 'page' : undefined} onClick={onClose} tabIndex={isExpanded && (!sidebarCollapsed || overlayOpen) ? 0 : -1} title={sidebarCollapsed && !overlayOpen ? child.label : undefined}>
                    <NavIcon name={child.label} className={styles.subNavIcon} />
                    <span>{child.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        className={styles.collapseToggle}
        onClick={toggleSidebar}
        title={sidebarCollapsed ? 'Pin sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Pin sidebar' : 'Collapse sidebar'}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {sidebarCollapsed ? (
            <>
              <polyline points="15 18 9 12 15 6" />
              <line x1="19" y1="4" x2="19" y2="20" />
            </>
          ) : (
            <>
              <polyline points="9 18 15 12 9 6" />
              <line x1="5" y1="4" x2="5" y2="20" />
            </>
          )}
        </svg>
      </button>

      {(!sidebarCollapsed || overlayOpen) && (
        <footer className={styles.footer}>
          <span className={styles.footerVersion}>
            Kapowarr {about?.version ?? '…'}
          </span>
          <select
            className={styles.footerThemeSelect}
            value={theme}
            onChange={handleThemeChange}
            title="Theme"
          >
            {Object.entries(THEMES).map(([label, value]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className={styles.footerAttribution}>
            Powered by{' '}
            <a href="https://comicvine.gamespot.com" target="_blank" rel="noopener noreferrer">
              ComicVine
            </a>
          </span>
        </footer>
      )}
    </aside>
  );
}
