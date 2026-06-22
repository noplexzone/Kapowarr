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
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{queue.length} item{queue.length !== 1 ? 's' : ''} in queue</span>
        <Button
          variant="secondary"
          onClick={() => clearMutation.mutate()}
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

function statusTone(status: string): 'info' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'downloading':
    case 'importing':
    case 'seeding':
      return 'success';
    case 'completed': return 'success';
    case 'failed': return 'danger';
    default: return 'neutral';
  }
}

function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  return status
    .split(/[_-]/g)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatBytes(bytes: number): string {
  if (bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '—';
  return `${formatBytes(bps)}/s`;
}

function resolveProgress(entry: QueueEntry): number {
  if (entry.progress_is_percent !== false) return Math.round(entry.progress);
  if (entry.size > 0) return Math.round((entry.progress / entry.size) * 100);
  return 0;
}

function QueueRow({ entry, index, total, onMove, onRemove }: QueueRowProps) {
  const pct = resolveProgress(entry);
  const isDownloading = entry.status === 'downloading';

  return (
    <tr>
      <td>
        <Badge tone={statusTone(entry.status)}>
          {formatStatus(entry.status)}
        </Badge>
        {entry.task_label && (
          <div className={styles.taskLabel}>{entry.task_label}</div>
        )}
      </td>
      <td>
        <Link to="/comics" search={{ sort: 'title', filter: '', view: 'posters', offset: 0 }} className={styles.titleLink}>
          {entry.title}
        </Link>
      </td>
      <td>
        <Badge tone="neutral">{entry.source_name}</Badge>
      </td>
      <td>
        <span className={styles.sizeSpeed}>{formatBytes(entry.size)}</span>
      </td>
      <td>
        <span className={styles.sizeSpeed}>{formatSpeed(entry.speed)}</span>
      </td>
      <td className={styles.progressCell}>
        {isDownloading ? (
          <>
            <div className={styles.progressWrap}>
              <Progress value={pct} tone="success" className={styles.progressBar} />
              <span className={styles.progressText}>{pct}%</span>
            </div>
          </>
        ) : (
          <span className={styles.progressText}>—</span>
        )}
      </td>
      <td>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => onMove('up')} disabled={index === 0} title="Move up">↑</Button>
          <Button variant="ghost" onClick={() => onMove('down')} disabled={index === total - 1} title="Move down">↓</Button>
          <Button variant="ghost" onClick={() => onRemove(false)} title="Remove">✕</Button>
          <Button variant="ghost" onClick={() => onRemove(true)} title="Remove & Blocklist">⊗</Button>
        </div>
      </td>
    </tr>
  );
}
