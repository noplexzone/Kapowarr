import type { ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import styles from './route-state.module.css';

export function RoutePending() {
  return <div className={styles.state} role="status">Loading…</div>;
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
      <a href="/ui/">Return to dashboard</a>
    </div>
  );
}
