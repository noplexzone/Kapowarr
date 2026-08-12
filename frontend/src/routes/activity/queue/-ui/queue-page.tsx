import { useCallback } from 'react';
import { useSuspenseQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge, Button, Progress } from '@/components/primitives';
import { useSocketEvent } from '@/platform/socketio/socket';
import {
  queueQueryOptions,
  QUEUE_KEY,
  moveDownload,
  removeDownload,
  clearQueue,
} from '../-queue.api';
import type { QueueEntry } from '../-queue.types';
import styles from './queue-page.module.css';

export function QueuePage() {
  const queryClient = useQueryClient();
  const { data: queue = [] } = useSuspenseQuery(queueQueryOptions());

  useSocketEvent('queue_added', useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }, [queryClient]));

  useSocketEvent<Partial<QueueEntry> & { id: number }>('queue_status', useCallback((data) => {
    queryClient.setQueryData<QueueEntry[]>(QUEUE_KEY, (old) =>
      old?.map((entry) => entry.id === data.id ? { ...entry, ...data } : entry),
    );
  }, [queryClient]));

  useSocketEvent<{ id: number }>('queue_ended', useCallback((data) => {
    queryClient.setQueryData<QueueEntry[]>(QUEUE_KEY, (old) =>
      old?.filter((entry) => entry.id !== data.id),
    );
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }, [queryClient]));

  const clearMutation = useMutation({
    mutationFn: clearQueue,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
  });

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>Activity Queue</p>
          <h1>Downloads</h1>
          <p>Live download, import, and recovery state for the current queue.</p>
        </div>
        <div className={styles.summary} aria-label="Queue summary">
          <strong>{queue.length}</strong>
          <span>item{queue.length !== 1 ? 's' : ''} queued</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{queue.length} item{queue.length !== 1 ? 's' : ''} in queue</span>
        <Button
          variant="secondary"
          onClick={() => {
            if (window.confirm('Remove every item from the queue?')) clearMutation.mutate();
          }}
          disabled={queue.length === 0 || clearMutation.isPending}
        >
          Remove All
        </Button>
      </div>

      {queue.length === 0 ? (
        <div className={styles.empty}>Queue is empty</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Title</th>
                <th>Source</th>
                <th>Size</th>
                <th>Speed</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry, idx) => (
                <QueueRow
                  key={entry.id}
                  entry={entry}
                  index={idx}
                  total={queue.length}
                  onMove={(dir) => {
                    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
                    moveDownload(entry.id, newIdx).then(() =>
                      queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
                    );
                  }}
                  onRemove={(blocklist) => {
                    if (blocklist && !window.confirm(`Remove and blocklist “${entry.title}”?`)) return;
                    removeDownload(entry.id, blocklist).then(() =>
                      queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
                    );
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface QueueRowProps {
  entry: QueueEntry;
  index: number;
  total: number;
  onMove: (dir: 'up' | 'down') => void;
  onRemove: (blocklist: boolean) => void;
}

export function statusTone(status: string): 'info' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'downloading':
    case 'importing':
    case 'seeding':
      return 'success';
    case 'completed': return 'success';
    case 'failed':
    case 'canceled':
      return 'danger';
    default: return 'neutral';
  }
}

export function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  return status
    .split(/[_-]/g)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatSpeed(bps: number): string {
  if (bps <= 0) return '—';
  return `${formatBytes(bps)}/s`;
}

export function resolveProgress(entry: QueueEntry): number {
  if (entry.progress_is_percent !== false) return Math.max(0, Math.min(100, Math.round(entry.progress)));
  if (entry.size > 0) return Math.max(0, Math.min(100, Math.round((entry.progress / entry.size) * 100)));
  return 0;
}

export function progressLabel(entry: QueueEntry): string {
  if (entry.progress_is_percent === false) {
    return entry.size > 0 ? `${formatBytes(entry.progress)} of ${formatBytes(entry.size)}` : formatBytes(entry.progress);
  }
  return `${resolveProgress(entry)}% complete`;
}

export function QueueRow({ entry, index, total, onMove, onRemove }: QueueRowProps) {
  const pct = resolveProgress(entry);
  const isActive = ['downloading', 'importing', 'seeding'].includes(entry.status);

  return (
    <tr className={styles.queueRow} data-status={entry.status}>
      <td data-label="Status">
        <div className={styles.statusBlock}>
          <Badge tone={statusTone(entry.status)}>{formatStatus(entry.status)}</Badge>
          {entry.task_label && <div className={styles.taskLabel}>{entry.task_label}</div>}
        </div>
      </td>
      <td data-label="Title">
        <Link to="/volumes/$volumeId" params={{ volumeId: String(entry.volume_id) }} className={styles.titleLink}>
          {entry.title}
        </Link>
      </td>
      <td data-label="Source">
        <Badge tone="neutral">
          {entry.source_detail ? `${entry.source_name} / ${entry.source_detail}` : entry.source_name}
        </Badge>
      </td>
      <td data-label="Size">
        <span className={styles.sizeSpeed}>{formatBytes(entry.size)}</span>
      </td>
      <td data-label="Speed">
        <span className={styles.sizeSpeed}>{formatSpeed(entry.speed)}</span>
      </td>
      <td data-label="Progress" className={styles.progressCell}>
        {isActive ? (
          <div className={styles.progressWrap}>
            <Progress value={pct} tone="success" className={styles.progressBar} />
            <span className={styles.progressText}>{progressLabel(entry)}</span>
          </div>
        ) : (
          <span className={styles.progressText}>—</span>
        )}
      </td>
      <td data-label="Actions">
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => onMove('up')} disabled={index === 0} title="Move up">Move up</Button>
          <Button variant="ghost" onClick={() => onMove('down')} disabled={index === total - 1} title="Move down">Move down</Button>
          <Button variant="ghost" onClick={() => onRemove(false)} title="Remove">Remove</Button>
          <Button variant="ghost" onClick={() => onRemove(true)} title="Remove & blocklist">Remove & blocklist</Button>
        </div>
      </td>
    </tr>
  );
}
