import { runtimeConfig } from '@/app/runtime-config';
import { useEffect, useState } from 'react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import styles from './route-state.module.css';

export function RoutePending() {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setVisible(true), 150); return () => window.clearTimeout(timer); }, []);
  return visible ? <div className={styles.state} role="status">Loading…</div> : null;
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : 'This page could not be loaded.';
  return (
    <div className={styles.state} role="alert">
      <h2>Could not load this page</h2>
      <p>{message}</p>
      <Button variant="primary" onClick={reset}>Retry</Button>
    </div>
  );
}

export function RouteNotFound() {
  return (
    <div className={styles.state}>
      <h2>Page not found</h2>
      <p>The requested Kapowarr page does not exist.</p>
      <a href={runtimeConfig.routerBasePath}>Return to dashboard</a>
    </div>
  );
}
