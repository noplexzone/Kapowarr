import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@/components/primitives';
import {
  systemTasksQueryOptions,
  SYSTEM_TASKS_KEY,
  systemTaskHistoryQueryOptions,
  systemTaskPlanningQueryOptions,
  SYSTEM_TASKS_HISTORY_KEY,
  cancelTask,
  clearTaskHistory,
  runTask,
} from '../-system.api';
import type {
  SystemTask,
  TaskHistoryEntry,
  TaskDetails,
  PerIssueEntry,
  DownloadEntry,
  DownloadResultEntry,
} from '../-system.types';
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

function normalizeIssueNumber(n: number | [number, number] | null | undefined): string {
  if (n == null) return '—';
  if (Array.isArray(n)) return `#${String(n[0])}–${String(n[1])}`;
  const s = String(n);
  return `#${s.endsWith('.0') ? s.slice(0, -2) : s}`;
}

function issueSortValue(n: number | [number, number] | null | undefined): number {
  if (n == null) return Infinity;
  if (Array.isArray(n)) return n[0];
  return n;
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

function hasDetails(details: TaskDetails | undefined | null): boolean {
  if (!details) return false;
  if ('results' in details && Array.isArray(details.results)) return details.results.length > 0;
  if ('per_issue' in details && Array.isArray(details.per_issue))
    return details.per_issue.length > 0;
  if ('downloads' in details && Array.isArray(details.downloads))
    return details.downloads.length > 0;
  return false;
}

// ── Detail sub-components ──

function PerIssueTable({ entries }: { entries: PerIssueEntry[] }) {
  const sorted = [...entries].sort(
    (a, b) => issueSortValue(a.issue_number) - issueSortValue(b.issue_number),
  );
  const anyMatched = sorted.some(e => e.matched);

  if (sorted.length === 0) return null;

  return (
    <>
      <div className={styles.detailSectionHeading}>Per-Issue Results</div>
      <table className={styles.detailTable}>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Matched</th>
            {anyMatched && <th>Title</th>}
            {anyMatched && <th>Source</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((e, i) => (
            <tr key={i}>
              <td>{normalizeIssueNumber(e.issue_number)}</td>
              <td className={e.matched ? styles.matched : styles.unmatched}>
                {e.matched ? '✓' : '✗'}
              </td>
              {anyMatched && <td>{e.matched ? e.display_title ?? '' : ''}</td>}
              {anyMatched && <td>{e.matched ? e.source ?? '' : ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DownloadTable({ entries }: { entries: DownloadEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <>
      <div className={styles.detailSectionHeading}>Downloads</div>
      <table className={styles.detailTable}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Source</th>
            <th>Issue</th>
            <th>Filename</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td>{e.display_title}</td>
              <td>{e.source}</td>
              <td>{normalizeIssueNumber(e.issue_number)}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{e.filename}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DownloadResultTable({ results }: { results: DownloadResultEntry[] }) {
  if (results.length === 0) return null;
  const anyFailed = results.some(r => !r.success);
  return (
    <>
      <div className={styles.detailSectionHeading}>Results</div>
      <table className={styles.detailTable}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            {anyFailed && <th>Reason</th>}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td>{r.title}</td>
              <td className={r.success ? styles.matched : styles.unmatched}>
                {r.success ? '✓' : '✗'}
              </td>
              {anyFailed && <td>{r.failure_reason ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TaskDetailsView({ details }: { details: TaskDetails }) {
  // Download result entries have a 'results' array
  if ('results' in details) {
    return <DownloadResultTable results={details.results} />;
  }
  // Search task entries
  const perIssue = details.per_issue ?? [];
  const downloads = details.downloads ?? [];
  // Also include downloads as matched entries in the per-issue table for backward compat
  const mergedPerIssue: PerIssueEntry[] = [
    ...perIssue,
    ...downloads.map(d => ({
      issue_number: d.issue_number,
      matched: true,
      display_title: d.display_title,
      source: d.source,
    })),
  ];

  return (
    <>
      {mergedPerIssue.length > 0 && <PerIssueTable entries={mergedPerIssue} />}
      {downloads.length > 0 && <DownloadTable entries={downloads} />}
    </>
  );
}

// ── Expandable details renderer ──

function DetailRowContent({ item }: { item: SystemTask | TaskHistoryEntry }) {
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
          </div>
        )}
      </div>
    );
  }

  // History entries: show details
  const history = item as TaskHistoryEntry;
  if (history.details && hasDetails(history.details)) {
    return (
      <div className={styles.detailWrap}>
        <TaskDetailsView details={history.details} />
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
                        >
                          {task.status}
                        </Badge>
                      </td>
                      <td>
                        {task.volume_title && (
                          <span className={styles.volLink}>{task.volume_title}</span>
                        )}
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

// ── Section B: Task History ──

const PAGE_SIZE = 20;

function HistorySection() {
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();

  const { data: history = [] } = useQuery({
    ...systemTaskHistoryQueryOptions(page),
    refetchInterval: 30_000,
  });

  const clearMutation = useMutation({
    mutationFn: clearTaskHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_TASKS_HISTORY_KEY });
      setPage(0);
    },
  });

  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  if (history.length === 0 && page === 0) {
    return null; // Don't show the section if there's no history
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <span>Task History</span>
        <div className={styles.sectionHeaderActions}>
          <Button
            variant="ghost"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            Clear History
          </Button>
        </div>
      </div>

      {history.length === 0 ? (
        <div className={styles.empty}>No history entries</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '2rem' }}></th>
                <th>Task</th>
                <th>Volume / Issue</th>
                <th>Run At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Flatten rows: main + optional detail row
                const histRows: Array<{
                  type: 'main' | 'detail';
                  entry: TaskHistoryEntry;
                  key: string;
                }> = [];
                for (let i = 0; i < history.length; i++) {
                  const entry = history[i];
                  const key = `${entry.task_name}-${entry.run_at}-${i}`;
                  histRows.push({ type: 'main', entry, key });
                  if (
                    expandedHistoryId === key &&
                    hasDetails(entry.details)
                  ) {
                    histRows.push({ type: 'detail', entry, key: `detail-${key}` });
                  }
                }
                return histRows.map((row) => {
                  const { entry, key } = row;

                  if (row.type === 'main') {
                    const isExpanded = expandedHistoryId === key;
                    return (
                      <tr key={key}>
                        <td>
                          {hasDetails(entry.details) && (
                            <button
                              className={`${styles.expandBtn} ${isExpanded ? styles.expanded : ''}`}
                              onClick={() =>
                                setExpandedHistoryId(isExpanded ? null : key)
                              }
                              title="Show details"
                            >
                              ▶
                            </button>
                          )}
                        </td>
                        <td>{entry.display_title}</td>
                        <td>
                          {entry.volume_title && (
                            <span className={styles.volLink}>
                              {entry.volume_title}
                            </span>
                          )}
                          {entry.issue_number != null && (
                            <span className={styles.issueNum}>
                              {' '}#{entry.issue_number}
                            </span>
                          )}
                          {!entry.volume_title &&
                            entry.issue_number == null && (
                              <span style={{ color: 'var(--text-dim)' }}>
                                —
                              </span>
                            )}
                        </td>
                        <td
                          className={`${styles.timeCell} ${styles.timeCellDim}`}
                        >
                          {formatUnixTime(entry.run_at)}
                        </td>
                        <td></td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={key} className={styles.detailRow}>
                      <td colSpan={5}>
                        <DetailRowContent item={entry} />
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.pagination}>
        <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
          ← Prev
        </button>
        <span className={styles.pageIndicator}>Page {page + 1}</span>
        <button
          disabled={history.length < PAGE_SIZE}
          onClick={() => setPage(p => p + 1)}
        >
          Next →
        </button>
      </div>
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
      <HistorySection />
      <ScheduledSection />
    </div>
  );
}
