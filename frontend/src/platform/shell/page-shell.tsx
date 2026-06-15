import { type ReactNode, createContext, useContext } from 'react';
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

  return (
    <div className={styles.shell} data-theme={theme}>
      <Sidebar />
      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}
