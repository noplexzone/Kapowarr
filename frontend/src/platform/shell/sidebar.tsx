import { runtimeConfig } from '@/app/runtime-config';
import { useCallback } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { systemAboutQueryOptions, systemTasksQueryOptions, SYSTEM_TASKS_KEY } from '@/routes/system/-system.api';
import type { SystemTask } from '@/routes/system/-system.types';
import { useSocketEvent } from '@/platform/socketio/socket';
import { NavIcon } from './nav-icons';
import { getActivePrimary, getStoredLibrarySearch, PRIMARY_NAV } from './navigation';
import styles from './sidebar.module.css';

interface ActiveNavItem {
  to: string;
  search?: Record<string, unknown>;
  children?: ActiveNavItem[];
}

export function isSubActive(
  item: ActiveNavItem,
  pathname: string,
  search: Record<string, unknown>,
): boolean {
  if (pathname !== item.to) return false;
  return Object.entries(item.search ?? {}).every(([key, value]) => search[key] === value);
}

export function isNavActive(
  item: ActiveNavItem,
  pathname: string,
  search: Record<string, unknown>,
): boolean {
  return isSubActive(item, pathname, search)
    || (item.children?.some((child) => isSubActive(child, pathname, search)) ?? false);
}

export function SidebarSearch({
  collapsed,
  query,
  onQueryChange,
  onSubmit,
  onExpand,
}: {
  collapsed: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onExpand: () => void;
}) {
  if (collapsed) {
    return <button type="button" aria-label="Open library search" onClick={onExpand}>⌕</button>;
  }
  return (
    <div role="search">
      <input
        type="search"
        aria-label="Search library"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim()) onSubmit();
        }}
      />
    </div>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();
  const active = getActivePrimary(pathname);
  const { data: about } = useQuery(systemAboutQueryOptions());

  return (
    <aside className={styles.sidebar}>
      <Link to="/home" className={styles.brand}>
        <img className={styles.brandIcon} src={runtimeConfig.faviconUrl} alt="" />
        <span className={styles.brandText}>Kapowarr</span>
      </Link>
      <nav className={styles.nav} aria-label="Primary navigation">
        {PRIMARY_NAV.map((item) => {
          const isActive = active === item.label;
          return (
            <Link
              key={item.label}
              to={item.to as never}
              search={item.label === 'Library' ? getStoredLibrarySearch() as never : undefined}
              activeOptions={item.parent ? { exact: true } : undefined}
              className={styles.navItem}
              data-active={isActive || undefined}
              activeProps={{ 'aria-current': item.parent ? false : 'page' }}
              aria-current={isActive && !item.parent ? 'page' : undefined}
            >
              <NavIcon name={item.label} className={styles.navIcon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <footer className={styles.footer}>
        <LiveTaskStatus />
        <span className={styles.footerVersion}>Kapowarr {about?.version ?? '…'}</span>
        <Link to="/system/status">System status</Link>
      </footer>
    </aside>
  );
}

function LiveTaskStatus() {
  const queryClient = useQueryClient();
  const { data: tasks } = useQuery({
    ...systemTasksQueryOptions(),
    refetchInterval: 5000,
  });
  const refreshTasks = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SYSTEM_TASKS_KEY });
  }, [queryClient]);

  useSocketEvent('task_added', refreshTasks);
  useSocketEvent('task_status', refreshTasks);
  useSocketEvent('task_ended', refreshTasks);

  const activeTask = tasks?.find((task) => task.status === 'running') ?? tasks?.[0];
  if (!activeTask) return null;

  const statusText = formatTaskStatus(activeTask);
  const progress = activeTask.progress;
  const total = progress?.total_count ?? null;
  const processed = progress?.processed_count ?? null;
  const percent = total && processed !== null
    ? Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
    : null;

  return (
    <Link
      to="/system/status"
      className={styles.liveTask}
      aria-label={`Current task: ${statusText}`}
      title={activeTask.progress?.current_file ?? activeTask.message ?? statusText}
    >
      <span className={styles.liveTaskLabel}>Now</span>
      <span className={styles.liveTaskText}>{statusText}</span>
      {percent !== null && (
        <span className={styles.liveTaskTrack} aria-hidden="true">
          <span className={styles.liveTaskBar} style={{ width: `${percent}%` }} />
        </span>
      )}
    </Link>
  );
}

function formatTaskStatus(task: SystemTask): string {
  if (task.action === 'refresh_and_scan' && task.progress?.phase === 'scanning_files') {
    const current = task.progress.processed_count;
    const total = task.progress.total_count;
    const title = task.volume_title ?? 'volume';
    if (total) return `Scanning ${current}/${total} ${title}`;
    return `Scanning ${title}`;
  }

  if (task.message) return task.message;
  if (task.volume_title) return `${task.display_title} — ${task.volume_title}`;
  return task.display_title;
}
