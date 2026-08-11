import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/platform/socketio/socket';
import { SYSTEM_TASKS_KEY, systemTasksQueryOptions } from '@/routes/system/-system.api';
import type { SystemTask } from '@/routes/system/-system.types';
import styles from './task-notifications.module.css';

type TaskNoticeTone = 'info' | 'success' | 'danger';

interface TaskEndedPayload {
  action?: string | null;
  volume_id?: number | null;
  issue_id?: number | null;
  message?: string | null;
}

interface TaskNotice {
  id: string;
  tone: TaskNoticeTone;
  title: string;
  message: string;
  detail?: string | null;
  createdAt: number;
}

export function TaskNotificationCenter() {
  const queryClient = useQueryClient();
  const { data: tasks } = useQuery({
    ...systemTasksQueryOptions(),
    refetchInterval: 5000,
  });
  const [dismissedActiveId, setDismissedActiveId] = useState<number | null>(null);
  const panelId = useId();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notices, setNotices] = useState<TaskNotice[]>([]);
  const lastActiveTask = useRef<SystemTask | null>(null);

  const activeTask = useMemo(
    () => tasks?.find((task) => task.status === 'running') ?? null,
    [tasks],
  );
  const queuedCount = tasks?.filter((task) => task.status === 'queued').length ?? 0;

  useEffect(() => {
    if (activeTask) {
      lastActiveTask.current = activeTask;
      if (dismissedActiveId !== null && dismissedActiveId !== activeTask.id) {
        setDismissedActiveId(null);
      }
    }
  }, [activeTask, dismissedActiveId]);

  const refreshTasks = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SYSTEM_TASKS_KEY });
  }, [queryClient]);

  useSocketEvent('task_added', refreshTasks);
  useSocketEvent('task_status', refreshTasks);
  useSocketEvent<TaskEndedPayload>('task_ended', useCallback((payload) => {
    const finishedTask = lastActiveTask.current;
    const message = payload.message || finishedTask?.message || '';
    const failed = /error|failed|permission denied/i.test(message);
    const notice: TaskNotice = {
      id: `${Date.now()}-${payload.action ?? finishedTask?.action ?? 'task'}`,
      tone: failed ? 'danger' : 'success',
      title: failed ? 'Task failed' : 'Task completed',
      message: formatTaskLabel(finishedTask, payload),
      detail: failed ? message : null,
      createdAt: Date.now(),
    };
    setNotices((items) => [notice, ...items].slice(0, 12));
    lastActiveTask.current = null;
    setDismissedActiveId(null);
    refreshTasks();
  }, [refreshTasks]));

  const showActiveToast = activeTask && dismissedActiveId !== activeTask.id;
  const visibleNotices = notices.slice(0, showActiveToast ? 1 : 2);
  if (!activeTask && notices.length === 0) return null;

  return (
    <section className={styles.region} aria-label="Task notifications" aria-live="polite">
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.historyButton}
          aria-expanded={notificationsOpen}
          aria-controls={panelId}
          onClick={() => setNotificationsOpen((open) => !open)}
        >
          Notifications
          <span>{notices.length}</span>
        </button>
      </div>

      {notificationsOpen && (
        <div id={panelId} className={styles.historyPanel}>
          <div className={styles.historyHeader}>
            <h2>Task notifications</h2>
            {notices.length > 0 && (
              <button type="button" onClick={() => setNotices([])}>Clear all</button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className={styles.empty}>No previous task notifications.</p>
          ) : (
            <ol className={styles.historyList}>
              {notices.map((notice) => (
                <li key={notice.id} data-tone={notice.tone}>
                  <div>
                    <strong>{notice.title}</strong>
                    <span>{notice.message}</span>
                    {notice.detail && <small>{notice.detail}</small>}
                    <time>{formatNoticeTime(notice.createdAt)}</time>
                  </div>
                  <button
                    type="button"
                    aria-label={`Dismiss ${notice.message}`}
                    onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {showActiveToast && (
        <TaskToast
          tone="info"
          title={activeTask.status === 'running' ? 'Task running' : 'Task queued'}
          message={formatTaskStatus(activeTask)}
          progress={activeTask.progress}
          queuedCount={queuedCount}
          currentFile={activeTask.progress?.current_file}
          onDismiss={() => setDismissedActiveId(activeTask.id)}
        />
      )}
      {visibleNotices.map((notice) => (
        <TaskToast
          key={notice.id}
          tone={notice.tone}
          title={notice.title}
          message={notice.message}
          currentFile={notice.detail}
          onDismiss={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}
        />
      ))}
    </section>
  );
}

function TaskToast({
  tone,
  title,
  message,
  progress,
  queuedCount,
  currentFile,
  onDismiss,
}: {
  tone: TaskNoticeTone;
  title: string;
  message: string;
  progress?: SystemTask['progress'];
  queuedCount?: number;
  currentFile?: string | null;
  onDismiss: () => void;
}) {
  const total = progress?.total_count ?? null;
  const processed = progress?.processed_count ?? null;
  const percent = total && processed !== null
    ? Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
    : null;

  return (
    <article className={styles.toast} data-tone={tone}>
      <div className={styles.header}>
        <div>
          <p className={styles.title}>{title}</p>
          <p className={styles.message}>{message}</p>
        </div>
        <button type="button" className={styles.dismiss} aria-label="Dismiss task notification" onClick={onDismiss}>×</button>
      </div>
      {currentFile && <p className={styles.detail}>{currentFile}</p>}
      {percent !== null && (
        <div className={styles.progress} aria-label={`${percent}% complete`}>
          <span style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
      <div className={styles.footer}>
        {typeof queuedCount === 'number' && queuedCount > 0 && (
          <span>{queuedCount} queued behind this</span>
        )}
        <Link to="/system/status" className={styles.openLink}>Open tasks</Link>
      </div>
    </article>
  );
}

export function formatTaskStatus(task: SystemTask): string {
  if (task.action === 'refresh_and_scan' && task.progress?.phase === 'scanning_files') {
    const current = task.progress.processed_count;
    const total = task.progress.total_count;
    const title = task.volume_title ?? 'volume';
    if (total) return `Scanning ${current}/${total} ${title}`;
    return `Scanning ${title}`;
  }

  if (task.message) return task.message;
  if (task.volume_title) return `${task.display_title} — ${task.volume_title}`;
  return task.display_title;
}

function formatTaskLabel(task: SystemTask | null, payload: TaskEndedPayload): string {
  if (task) {
    if (task.volume_title) return `${task.display_title} — ${task.volume_title}`;
    return task.display_title;
  }
  if (payload.action) return payload.action.replace(/_/g, ' ');
  return 'Task';
}

function formatNoticeTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
