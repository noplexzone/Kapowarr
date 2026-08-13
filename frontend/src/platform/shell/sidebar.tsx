import { runtimeConfig } from '@/app/runtime-config';
import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { systemAboutQueryOptions } from '@/routes/system/-system.api';
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
              search={(item.label === 'Comics' || item.label === 'Manga') ? getStoredLibrarySearch() as never : undefined}
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
        <Link to="/changelog" className={styles.footerVersion}>Kapowarr {about?.version ?? '…'}</Link>
        <Link to="/system/status">System status</Link>
      </footer>
    </aside>
  );
}
