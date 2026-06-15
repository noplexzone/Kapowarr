import { Link, useLocation } from '@tanstack/react-router';
import clsx from 'clsx';
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

function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  const base = item.to.split('?')[0];
  return pathname.startsWith(base.split('/').slice(0, 2).join('/'));
}

function isSubActive(child: NavItem, pathname: string): boolean {
  const path = child.to.split('?')[0];
  return pathname === path || pathname.startsWith(path + '/');
}

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img className={styles.brandIcon} src="/ui/favicon.svg" alt="Kapowarr" />
        <span className={styles.brandText}>Kapowarr</span>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(item, pathname);

          return (
            <div key={item.to + item.label} className={styles.navGroup}>
              <Link
                to={item.to as any}
                className={clsx(styles.navItem, active && styles.active)}
              >
                {item.label}
                {item.badge != null && item.badge > 0 && (
                  <span className={styles.badge}>{item.badge}</span>
                )}
              </Link>
              {item.children && (
                <div className={styles.subNav}>
                  {item.children.map((child) => (
                    <Link
                      key={child.to}
                      to={child.to as any}
                      className={clsx(
                        styles.subNavItem,
                        isSubActive(child, pathname) && styles.subActive,
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={styles.footer}>Powered by ComicVine</div>
    </aside>
  );
}
