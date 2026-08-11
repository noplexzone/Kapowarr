import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@/components/primitives';
import {
  systemTasksQueryOptions,
  SYSTEM_TASKS_KEY,
  systemTaskPlanningQueryOptions,
  cancelTask,
  runTask,
} from '../-system.api';
import type { SystemTask } from '../-system.types';
import styles from './system-tasks-page.module.css';

// ── Helpers ──

function formatUnixTime(ts: number | null | undefined): string {
  if (ts == null || ts === undefined) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

function formatEta(etaSeconds: number | null | undefined): string {
  if (etaSeconds == null) return 'calculating…';
  const totalMins = Math.round(etaSeconds / 60);
  if (totalMins < 1) return '< 1m remaining';
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return `~${totalMins}m remaining`;
  return `~${hours}h ${String(mins).padStart(2, '0')}m remaining`;
}

function taskStatusTone(status: string): 'info' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'running':
    case 'pending':
      return 'info';
    case 'done':
    case 'success':
      return 'success';
    case 'failed':
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'running':
      return styles.badgeRunning;
    case 'pending':
      return styles.badgePending;
    case 'done':
    case 'success':
      return styles.badgeDone;
    case 'failed':
    case 'error':
      return styles.badgeFailed;
    default:
      return '';
  }
}

// ── Expandable details renderer ──

function DetailRowContent({ item }: { item: SystemTask }) {
  // Use a discriminated check based on 'id' (SystemTask has it, TaskHistoryEntry doesn't)
  if ('id' in item) {
    const task = item as SystemTask;
    const message = task.message;
    const progress = task.progress;
    return (
      <div className={styles.detailWrap}>
        {message && <div className={styles.detailMessage}>{message}</div>}
        {progress && (
          <div className={styles.progressWrap}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width:
                    progress.total_count && progress.total_count > 0
                      ? `${(progress.processed_count / progress.total_count) * 100}%`
                      : '0%',
                }}
              />
            </div>
            <span className={styles.progressLabel}>
              {progress.processed_count}
              {progress.total_count != null ? ` / ${progress.total_count}` : ''}
            </span>
            {'eta_seconds' in progress && (
              <span className={styles.etaLabel}>
                {formatEta(progress.eta_seconds)}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Section A: Active Tasks ──

function ActiveTasksSection({
  tasks,
  expandedId,
  onToggleExpand,
  onCancel,
  cancellingId,
}: {
  tasks: SystemTask[];
  expandedId: number | null;
  onToggleExpand: (id: number) => void;
  onCancel: (id: number) => void;
  cancellingId: number | null;
}) {
  // Determine which tasks have expandable content
  const hasExpandableContent = (task: SystemTask): boolean => {
    const isActive = task.status === 'running' || task.status === 'pending';
    return isActive && !!(task.message || task.progress);
  };

  // Flatten rows: main row + optional detail row
  const rows: Array<{ type: 'main' | 'detail'; task: SystemTask }> = [];
  for (const task of tasks) {
    rows.push({ type: 'main', task });
    if (expandedId === task.id && hasExpandableContent(task)) {
      rows.push({ type: 'detail', task });
    }
  }

  return (
    <section>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>
          {tasks.length} active task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className={styles.empty}>No tasks running</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '2rem' }}></th>
                <th>ID</th>
                <th>Action</th>
                <th>Status</th>
                <th>Volume / Issue</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const task = row.task;
                const isActive =
                  task.status === 'running' || task.status === 'pending';

                if (row.type === 'main') {
                  const isExpanded = expandedId === task.id;
                  const canExpand = hasExpandableContent(task);
                  return (
                    <tr key={`m-${task.id}`}>
                      <td>
                        {canExpand && (
                          <button
                            className={`${styles.expandBtn} ${isExpanded ? styles.expanded : ''}`}
                            onClick={() => onToggleExpand(task.id)}
                            title="Show details"
                          >
                            ▶
                          </button>
                        )}
                      </td>
                      <td className={styles.idCell}>{task.id}</td>
                      <td>
                        <strong>{task.display_title}</strong>
                        {task.message && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: '0.78rem',
                              color: 'var(--text-dim)',
                              marginTop: '0.15rem',
                            }}
                          >
                            {task.message}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={taskStatusTone(task.status)}
                          className={statusClass(task.status)}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {task.status}
                        </Badge>
                      </td>
                      <td>
                        {task.volume_title && task.volume_id != null ? (
                          <Link
                            to="/volumes/$volumeId"
                            params={{ volumeId: String(task.volume_id) }}
                            className={styles.volLink}
                          >
                            {task.volume_title}
                          </Link>
                        ) : task.volume_title ? (
                          <span className={styles.volLink}>{task.volume_title}</span>
                        ) : null}
                        {task.issue_number != null && (
                          <span className={styles.issueNum}>
                            {' '}#{task.issue_number}
                          </span>
                        )}
                        {!task.volume_title && task.issue_number == null && (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </td>
                      <td className={`${styles.timeCell} ${styles.timeCellDim}`}>
                        {formatUnixTime(task.started_at)}
                      </td>
                      <td>
                        {isActive && (
                          <Button
                            variant="ghost"
                            onClick={() => onCancel(task.id)}
                            disabled={cancellingId === task.id}
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                }

                // Detail row
                return (
                  <tr key={`d-${task.id}-${idx}`} className={styles.detailRow}>
                    <td colSpan={7}>
                      <DetailRowContent item={task} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Section C: Scheduled Tasks ──

function ScheduledSection() {
  const { data: planning = [] } = useQuery({
    ...systemTaskPlanningQueryOptions(),
    refetchInterval: 60_000,
  });

  const queryClient = useQueryClient();
  const runMutation = useMutation({
    mutationFn: (cmd: string) => runTask(cmd),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_TASKS_KEY });
    },
  });

  if (planning.length === 0) return null;

  return (
    <section>
      <div className={styles.sectionHeader}>
        <span>Scheduled</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Interval</th>
              <th>Last Execution</th>
              <th>Next Execution</th>
              <th>Run</th>
            </tr>
          </thead>
          <tbody>
            {planning.map(t => (
              <tr key={t.task_name}>
                <td>{t.display_name}</td>
                <td>{convertInterval(t.interval)}</td>
                <td className={`${styles.timeCell} ${styles.timeCellDim}`}>
                  {t.last_run ? formatUnixTime(t.last_run) : 'Never'}
                </td>
                <td className={`${styles.timeCell} ${styles.timeCellDim}`}>
                  {formatUnixTime(t.next_run)}
                </td>
                <td>
                  <button
                    className={styles.runBtn}
                    onClick={() => runMutation.mutate(t.task_name)}
                    disabled={runMutation.isPending}
                  >
                    Run Now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function convertInterval(interval: number): string {
  const hrs = Math.round(interval / 3600);
  if (hrs < 1) return `${Math.round(interval / 60)} minutes`;
  if (hrs === 1) return '1 hour';
  return `${hrs} hours`;
}

// ── Main Page ──

export function SystemTasksPage() {
  const queryClient = useQueryClient();
  const { data: tasks = [] } = useQuery({
    ...systemTasksQueryOptions(),
    refetchInterval: 10_000,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelTask,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SYSTEM_TASKS_KEY }),
  });

  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);

  const handleToggleExpand = (id: number) => {
    setExpandedTaskId(prev => (prev === id ? null : id));
  };

  return (
    <div className={styles.page}>
      <ActiveTasksSection
        tasks={tasks}
        expandedId={expandedTaskId}
        onToggleExpand={handleToggleExpand}
        onCancel={id => cancelMutation.mutate(id)}
        cancellingId={
          cancelMutation.isPending ? cancelMutation.variables ?? null : null
        }
      />
      <ScheduledSection />
    </div>
  );
}
