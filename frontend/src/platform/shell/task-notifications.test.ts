import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatTaskStatus } from './task-notifications';
import type { SystemTask } from '@/routes/system/-system.types';

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
});


describe('task notification layout', () => {
  it('anchors task notifications in the top right with a history panel', () => {
    const css = readFileSync(resolve(__dirname, 'task-notifications.module.css'), 'utf8');

    expect(css).toContain('top: var(--space-5);');
    expect(css).toContain('right: var(--space-5);');
    expect(css).toContain('.historyPanel');
    expect(css).not.toContain('bottom: var(--space-5);');
  });
});
