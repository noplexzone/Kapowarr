import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@/components/primitives';
import { systemTasksQueryOptions, SYSTEM_TASKS_KEY, cancelTask } from '../-system.api';
import type { SystemTask } from '../-system.types';
import styles from './system-tasks-page.module.css';

export function SystemTasksPage() {
  const queryClient = useQueryClient();
  const { data: tasks = [] } = useQuery({
    ...systemTasksQueryOptions(),
    refetchInterval: 10_000,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SYSTEM_TASKS_KEY }),
  });

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className={styles.empty}>No tasks running</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Action</th>
                <th>Status</th>
                <th>Description</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onCancel={() => cancelMutation.mutate(task.id)}
                  cancelling={cancelMutation.isPending && cancelMutation.variables === task.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function taskStatusTone(status: string): 'info' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'running': case 'pending': return 'info';
    case 'done': case 'success': return 'success';
    case 'failed': case 'error': return 'danger';
    default: return 'neutral';
  }
}

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

interface TaskRowProps {
  task: SystemTask;
  onCancel: () => void;
  cancelling: boolean;
}

function TaskRow({ task, onCancel, cancelling }: TaskRowProps) {
  const isActive = task.status === 'running' || task.status === 'pending';
  return (
    <tr>
      <td className={styles.idCell}>{task.id}</td>
      <td>{task.action}</td>
      <td>
        <Badge tone={taskStatusTone(task.status)}>{task.status}</Badge>
      </td>
      <td>{task.display}</td>
      <td>{formatTime(task.started_at)}</td>
      <td>{formatTime(task.ended_at)}</td>
      <td>
        {isActive && (
          <Button variant="ghost" onClick={onCancel} disabled={cancelling}>
            Cancel
          </Button>
        )}
      </td>
    </tr>
  );
}
