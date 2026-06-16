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
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/' },
  {
    label: 'Comics',
    to: '/comics',
    children: [
      { label: 'Library', to: '/comics' },
      { label: 'Add Volume', to: '/comics/add' },
      { label: 'Mismatch Review', to: '/mismatch-review' },
    ],
  },
  {
    label: 'Manga',
    to: '/manga',
    children: [
      { label: 'Library', to: '/manga' },
      { label: 'Add Volume', to: '/manga/add' },
      { label: 'Mismatch Review', to: '/manga/mismatch-review' },
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

function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  const base = item.to.split('?')[0];
  return pathname.startsWith(base.split('/').slice(0, 2).join('/'));
}

function isSubActive(child: NavItem, pathname: string): boolean {
  const path = child.to.split('?')[0];
  return pathname === path || pathname.startsWith(path + '/');
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

export interface SidebarProps {
  overlayOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ overlayOpen = false, onClose }: SidebarProps) {
  const { pathname } = useLocation();
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

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && query.trim()) {
        navigate({ to: '/comics', search: { search: query.trim() } });
        onClose?.();
      }
    },
    [navigate, query, onClose],
  );

  return (
    <aside
      className={clsx(
        styles.sidebar,
        sidebarCollapsed && styles.collapsed,
        overlayOpen && styles.overlayOpen,
      )}
    >
      <div className={styles.brand}>
        <img className={styles.brandIcon} src="/ui/favicon.svg" alt="Kapowarr" />
        {!sidebarCollapsed && <span className={styles.brandText}>Kapowarr</span>}
      </div>

      <div className={styles.searchBar}>
        <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {!sidebarCollapsed && (
          <input type="text" className={styles.searchInput} placeholder="Search library…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleSearchKeyDown} autoComplete="off" />
        )}
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(item, pathname);
          const badge = item.label === 'Activity' ? queueBadge : item.badge;
          const hasChildren = item.children && item.children.length > 0;
          const isExpanded = hasChildren ? groupExpanded[item.label] ?? false : false;

          if (!hasChildren) {
            return (
              <div key={item.to + item.label} className={styles.navGroup}>
                <Link to={item.to as any} className={clsx(styles.navItem, active && styles.active)} onClick={onClose} title={sidebarCollapsed ? item.label : undefined}>
                  <NavIcon name={item.label} className={styles.navIcon} />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                  {badge != null && badge > 0 && <span className={styles.badge}>{badge}</span>}
                </Link>
              </div>
            );
          }

          return (
            <div key={item.to + item.label} className={styles.navGroup}>
              {!sidebarCollapsed ? (
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

              <div className={clsx(styles.subNav, (!isExpanded || sidebarCollapsed) && styles.subNavCollapsed)} aria-hidden={!isExpanded || sidebarCollapsed || undefined} inert={isExpanded && !sidebarCollapsed ? undefined : true}>
                {item.children!.map((child) => (
                  <Link key={child.to} to={child.to as any} className={clsx(styles.subNavItem, isSubActive(child, pathname) && styles.subActive)} onClick={onClose} tabIndex={isExpanded && !sidebarCollapsed ? 0 : -1} title={sidebarCollapsed ? child.label : undefined}>
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

      {!sidebarCollapsed && (
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
