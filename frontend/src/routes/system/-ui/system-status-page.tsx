import { useRef, useEffect } from 'react';
import { useSuspenseQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import { systemAboutQueryOptions, downloadLogs, fetchLogTail } from '../-system.api';
import styles from './system-status-page.module.css';

export function SystemStatusPage() {
  const { data: about } = useSuspenseQuery(systemAboutQueryOptions());
  const { data: logTail } = useQuery({
    queryKey: ['system', 'logs', 'tail'],
    queryFn: fetchLogTail,
    refetchInterval: 5_000,
    staleTime: 0,
  });

  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logTail]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>System Status</h1>
        <Button variant="secondary" onClick={downloadLogs}>
          Download Logs
        </Button>
      </div>

      <div className={styles.infoGrid}>
        <InfoRow label="Version" value={about.version} to="/changelog" />
        <InfoRow label="Python Version" value={about.python_version} />
        <InfoRow label="Database Version" value={about.database_version} />
        <InfoRow label="Platform" value={about.platform} />
        {about.start_time && (
          <InfoRow label="Start Time" value={new Date(about.start_time).toLocaleString()} />
        )}
        {about.uptime != null && (
          <InfoRow label="Uptime" value={formatUptime(Number(about.uptime))} />
        )}
      </div>

      <div className={styles.logSection}>
        <h2 className={styles.logTitle}>Live Logs</h2>
        <pre ref={logRef} className={styles.logOutput}>{logTail ?? 'Loading logs…'}</pre>
      </div>
    </div>
  );
}

function InfoRow({ label, value, to }: { label: string; value: string | number | undefined; to?: '/changelog' }) {
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoLabel}>{label}</span>
      {to ? <Link to={to} className={styles.infoValue}>{value ?? '—'}</Link> : <span className={styles.infoValue}>{value ?? '—'}</span>}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}
