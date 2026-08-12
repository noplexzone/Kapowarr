import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEndedTaskNotice,
  formatTaskStatus,
  getTaskActionTarget,
  TaskToast,
  type TaskNotice,
} from './task-notifications';
import type { SystemTask } from '@/routes/system/-system.types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search, params, ...props }: any) => (
    <a href={`${to}${params ? ` ${JSON.stringify(params)}` : ''}${search ? `?${JSON.stringify(search)}` : ''}`} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/platform/socketio/socket', () => ({
  useSocketEvent: vi.fn(),
}));

describe('task notification formatting', () => {
  it('formats refresh-and-scan file progress as a readable task notification', () => {
    const task: SystemTask = {
      id: 1,
      action: 'refresh_and_scan',
      display_title: 'Refresh And Scan',
      status: 'running',
      volume_id: 1141,
      volume_title: 'Strange Tales',
      progress: {
        phase: 'scanning_files',
        processed_count: 1,
        total_count: 168,
        current_file: 'Strange Tales 001.cbz',
      },
    };

    expect(formatTaskStatus(task)).toBe('Scanning 1/168 Strange Tales');
  });

  it('falls back to the task message for non-scan tasks', () => {
    const task: SystemTask = {
      id: 2,
      action: 'auto_search',
      display_title: 'Auto Search',
      status: 'running',
      message: 'Searching issue 3/10 for Batman',
    };

    expect(formatTaskStatus(task)).toBe('Searching issue 3/10 for Batman');
  });

  it('builds a failure notice with volume context and Activity history target', () => {
    const task: SystemTask = {
      id: 3,
      action: 'manual_download',
      display_title: 'Manual Download',
      status: 'running',
      volume_id: 77,
      volume_title: 'Absolute Batman',
      issue_id: 7701,
      issue_number: 2,
      message: 'Downloading issue',
    };

    const notice = buildEndedTaskNotice(task, {
      action: 'manual_download',
      message: 'Failed: No working links found',
      volume_id: 77,
      issue_id: 7701,
    });

    expect(notice.tone).toBe('danger');
    expect(notice.title).toBe('Task failed');
    expect(notice.message).toBe('Manual Download — Absolute Batman #2');
    expect(notice.detail).toBe('Failed: No working links found');
    expect(notice.target.to).toBe('/activity/history');
    expect(notice.target.label).toBe('Open history');
  });

  it('links active task context to volume details when possible', () => {
    const task: SystemTask = {
      id: 4,
      action: 'auto_search',
      display_title: 'Auto Search',
      status: 'running',
      volume_id: 44,
      volume_title: 'Jujutsu Kaisen',
    };

    expect(getTaskActionTarget(task)).toEqual({
      label: 'View volume',
      to: '/volumes/$volumeId',
      params: { volumeId: '44' },
    });
  });
});

describe('task notification UI', () => {
  it('renders actionable links and failure details without retry controls', () => {
    const notice: TaskNotice = {
      id: 'failed-1',
      tone: 'danger',
      title: 'Task failed',
      message: 'Auto Search — Saga #3',
      detail: 'No matching result found',
      createdAt: 1_723_000_000,
      target: { label: 'Open history', to: '/activity/history', search: { page: 1, status: 'failed', section: 'all' } },
    };

    render(<TaskToast notice={notice} onDismiss={() => undefined} />);

    expect(screen.getByText('Task failed')).toBeTruthy();
    expect(screen.getByText('No matching result found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open history' }).getAttribute('href')).toContain('/activity/history');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('opens contextual volume links for active task notices', () => {
    const notice: TaskNotice = {
      id: 'active-1',
      tone: 'info',
      title: 'Task running',
      message: 'Refresh And Scan — Watchmen',
      createdAt: 1,
      target: { label: 'View volume', to: '/volumes/$volumeId', params: { volumeId: '9' } },
      progress: { processed_count: 5, total_count: 10, current_file: 'Watchmen 005.cbz' },
      queuedCount: 2,
    };

    render(<TaskToast notice={notice} onDismiss={() => undefined} />);

    expect(screen.getByLabelText('50% complete')).toBeTruthy();
    expect(screen.getByText('Watchmen 005.cbz')).toBeTruthy();
    expect(screen.getByText('2 queued behind this')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View volume' }).getAttribute('href')).toContain('/volumes/$volumeId');
  });
});

describe('task notification layout', () => {
  it('anchors task notifications in the top right with a history panel', () => {
    const css = readFileSync(resolve(__dirname, 'task-notifications.module.css'), 'utf8');

    expect(css).toContain('top: var(--space-5);');
    expect(css).toContain('right: var(--space-5);');
    expect(css).toContain('.historyPanel');
    expect(css).not.toContain('bottom: var(--space-5);');
  });

  it('keeps mobile notifications away from the bottom navigation', () => {
    const css = readFileSync(resolve(__dirname, 'task-notifications.module.css'), 'utf8');

    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('top: var(--space-3);');
    expect(css).not.toContain('bottom: 0');
  });
});
