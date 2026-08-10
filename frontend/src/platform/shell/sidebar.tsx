import { runtimeConfig } from '@/app/runtime-config';
import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { systemAboutQueryOptions } from '@/routes/system/-system.api';
import { NavIcon } from './nav-icons';
import { getActivePrimary, PRIMARY_NAV } from './navigation';
import styles from './sidebar.module.css';

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
              className={styles.navItem}
              data-active={isActive || undefined}
              aria-current={isActive && !item.parent ? 'page' : undefined}
            >
              <NavIcon name={item.label} className={styles.navIcon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <footer className={styles.footer}>
        <span className={styles.footerVersion}>Kapowarr {about?.version ?? '…'}</span>
        <Link to="/system/status">System status</Link>
      </footer>
    </aside>
  );
}
