import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/platform/socketio/socket';
import { SYSTEM_TASKS_KEY, systemTasksQueryOptions } from '@/routes/system/-system.api';
import type { SystemTask, SystemTaskProgress } from '@/routes/system/-system.types';
import styles from './task-notifications.module.css';

type TaskNoticeTone = 'info' | 'success' | 'danger';

type NotificationTarget =
  | { label: string; to: '/system/status'; search?: never; params?: never }
  | { label: string; to: '/activity/history'; search?: { page: number; status?: string; section?: string }; params?: never }
  | { label: string; to: '/activity/search-history'; search?: { page: number }; params?: never }
  | { label: string; to: '/volumes/$volumeId'; params: { volumeId: string }; search?: never };

export interface TaskEndedPayload {
  action?: string | null;
  display_title?: string | null;
  volume_id?: number | null;
  volume_title?: string | null;
  issue_id?: number | null;
  issue_number?: number | null;
  message?: string | null;
}

export interface TaskNotice {
  id: string;
  tone: TaskNoticeTone;
  title: string;
  message: string;
  detail?: string | null;
  createdAt: number;
  target: NotificationTarget;
  progress?: SystemTaskProgress;
  queuedCount?: number;
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
    () => tasks?.find((task) => task.status === 'running' || task.status === 'queued') ?? null,
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
    const notice = buildEndedTaskNotice(lastActiveTask.current, payload);
    setNotices((items) => [notice, ...items].slice(0, 12));
    lastActiveTask.current = null;
    setDismissedActiveId(null);
    refreshTasks();
  }, [refreshTasks]));

  const activeNotice = activeTask && dismissedActiveId !== activeTask.id
    ? buildActiveTaskNotice(activeTask, queuedCount)
    : null;
  const visibleNotices = notices.slice(0, activeNotice ? 1 : 2);
  if (!activeNotice && notices.length === 0) return null;

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
                    <TaskNoticeLink target={notice.target} />
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

      {activeNotice && (
        <TaskToast
          notice={activeNotice}
          onDismiss={() => setDismissedActiveId(activeTask!.id)}
        />
      )}
      {visibleNotices.map((notice) => (
        <TaskToast
          key={notice.id}
          notice={notice}
          onDismiss={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}
        />
      ))}
    </section>
  );
}

export function TaskToast({ notice, onDismiss }: { notice: TaskNotice; onDismiss: () => void }) {
  const total = notice.progress?.total_count ?? null;
  const processed = notice.progress?.processed_count ?? null;
  const percent = total && processed !== null
    ? Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
    : null;

  return (
    <article className={styles.toast} data-tone={notice.tone}>
      <div className={styles.header}>
        <div>
          <p className={styles.title}>{notice.title}</p>
          <p className={styles.message}>{notice.message}</p>
        </div>
        <button type="button" className={styles.dismiss} aria-label="Dismiss task notification" onClick={onDismiss}>×</button>
      </div>
      {notice.detail && <p className={styles.detail}>{notice.detail}</p>}
      {notice.progress?.current_file && <p className={styles.detail}>{notice.progress.current_file}</p>}
      {percent !== null && (
        <div className={styles.progress} aria-label={`${percent}% complete`}>
          <span style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
      <div className={styles.footer}>
        {typeof notice.queuedCount === 'number' && notice.queuedCount > 0 && (
          <span>{notice.queuedCount} queued behind this</span>
        )}
        <TaskNoticeLink target={notice.target} className={styles.openLink} />
      </div>
    </article>
  );
}

function TaskNoticeLink({ target, className }: { target: NotificationTarget; className?: string }) {
  if (target.to === '/volumes/$volumeId') {
    return <Link to={target.to} params={target.params} className={className}>{target.label}</Link>;
  }
  if (target.to === '/activity/history') {
    return <Link to={target.to} search={target.search} className={className}>{target.label}</Link>;
  }
  if (target.to === '/activity/search-history') {
    return <Link to={target.to} search={target.search} className={className}>{target.label}</Link>;
  }
  return <Link to={target.to} className={className}>{target.label}</Link>;
}

export function buildActiveTaskNotice(task: SystemTask, queuedCount = 0): TaskNotice {
  return {
    id: `active-${task.id}`,
    tone: 'info',
    title: task.status === 'running' ? 'Task running' : 'Task queued',
    message: formatTaskLabel(task, {}),
    detail: task.message && task.message !== formatTaskStatus(task) ? task.message : null,
    createdAt: Date.now(),
    target: getTaskActionTarget(task),
    progress: task.progress,
    queuedCount,
  };
}

export function buildEndedTaskNotice(task: SystemTask | null, payload: TaskEndedPayload): TaskNotice {
  const message = payload.message || task?.message || '';
  const failed = /error|failed|failure|permission denied|no working|not found|timed out/i.test(message);
  const mergedTask = mergeTaskPayload(task, payload);

  return {
    id: `${Date.now()}-${payload.action ?? task?.action ?? 'task'}`,
    tone: failed ? 'danger' : 'success',
    title: failed ? 'Task failed' : 'Task completed',
    message: formatTaskLabel(mergedTask, payload),
    detail: failed ? message : null,
    createdAt: Date.now(),
    target: failed ? failureTarget(payload.action ?? task?.action) : getTaskActionTarget(mergedTask),
  };
}

function mergeTaskPayload(task: SystemTask | null, payload: TaskEndedPayload): SystemTask | null {
  if (!task && !payload.action && !payload.display_title) return null;
  return {
    id: task?.id ?? 0,
    action: payload.action ?? task?.action ?? 'task',
    display_title: payload.display_title ?? task?.display_title ?? readableAction(payload.action ?? 'Task'),
    status: 'ended',
    message: payload.message ?? task?.message,
    volume_id: payload.volume_id ?? task?.volume_id,
    volume_title: payload.volume_title ?? task?.volume_title,
    issue_id: payload.issue_id ?? task?.issue_id,
    issue_number: payload.issue_number ?? task?.issue_number,
  };
}

export function getTaskActionTarget(task: SystemTask | null): NotificationTarget {
  if (task?.volume_id) {
    return { label: 'View volume', to: '/volumes/$volumeId', params: { volumeId: String(task.volume_id) } };
  }
  if (task?.action?.includes('search')) {
    return { label: 'Open searches', to: '/activity/search-history', search: { page: 1 } };
  }
  return { label: 'Open tasks', to: '/system/status' };
}

function failureTarget(action?: string | null): NotificationTarget {
  if (action?.includes('search')) {
    return { label: 'Open searches', to: '/activity/search-history', search: { page: 1 } };
  }
  return { label: 'Open history', to: '/activity/history', search: { page: 1, status: 'failed', section: 'all' } };
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
    const issueSuffix = task.issue_number != null ? ` #${task.issue_number}` : '';
    if (task.volume_title) return `${task.display_title} — ${task.volume_title}${issueSuffix}`;
    return task.display_title;
  }
  if (payload.display_title) return payload.display_title;
  if (payload.action) return readableAction(payload.action);
  return 'Task';
}

function readableAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatNoticeTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
