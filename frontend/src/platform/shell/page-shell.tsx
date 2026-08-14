import { type ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useShellStore } from './store';
import { Sidebar } from './sidebar';
import { MobileNavigation } from './mobile-navigation';
import { TaskNotificationCenter } from './task-notifications';
import { ACTIVITY_NAV } from './navigation';
import styles from './page-shell.module.css';

export function PageShell({ children }: { children: ReactNode }) {
  const theme = useShellStore((state) => state.theme);
  const { pathname } = useLocation();

  return (
    <div className={styles.shell} data-theme={theme} data-testid="application-shell">
      <Sidebar />
      <main className={styles.content}>
        {pathname.startsWith('/activity/') && (
          <nav className={styles.sectionNav} aria-label="Activity sections">
            {ACTIVITY_NAV.map(([label, to]) => (
              <Link
                key={to}
                to={to as never}
                search
                data-current={pathname === to || undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
      <TaskNotificationCenter />
      <MobileNavigation />
    </div>
  );
}
