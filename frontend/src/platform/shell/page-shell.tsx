import { type ReactNode, createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useShellStore } from './store';
import { Sidebar } from './sidebar';
import styles from './page-shell.module.css';

interface ShellContextValue {
  profile: number;
}

const ShellContext = createContext<ShellContextValue>({ profile: 1 });

export function useShell() {
  return useContext(ShellContext);
}

export interface PageShellProps {
  children: ReactNode;
}

export function PageShell({ children }: PageShellProps) {
  const theme = useShellStore((s) => s.theme);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidebar();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen, closeSidebar]);

  return (
    <div
      className={styles.shell}
      data-testid="application-shell"
      data-theme={theme}
      style={{
        '--nav-column-width': sidebarCollapsed ? '56px' : 'var(--nav-width)',
      } as React.CSSProperties}
    >
      <Sidebar overlayOpen={sidebarOpen} onClose={closeSidebar} />
      {sidebarOpen && (
        <div className={styles.backdrop} onClick={closeSidebar} />
      )}
      <button
        className={styles.hamburger}
        onClick={openSidebar}
        aria-label="Open navigation"
      >
        ≡
      </button>
      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}
