import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatBytes, formatSpeed, formatStatus, progressLabel, QueueRow, resolveProgress, statusTone } from './queue-page';
import type { QueueEntry } from '../-queue.types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: any) => (
    <a href={`${to}${params ? ` ${JSON.stringify(params)}` : ''}`} {...props}>{children}</a>
  ),
}));

const baseEntry: QueueEntry = {
  id: 11,
  title: 'Absolute Batman 001',
  volume_id: 77,
  source_name: 'GetComics',
  source_detail: 'MediaFire',
  status: 'downloading',
  size: 104857600,
  speed: 2097152,
  progress: 42,
  progress_is_percent: true,
  task_label: 'Downloading 4/10',
};

describe('queue diagnostic helpers', () => {
  it('formats status, size, speed, and progress from the backend queue contract', () => {
    expect(statusTone('downloading')).toBe('success');
    expect(statusTone('canceled')).toBe('danger');
    expect(formatStatus('post_processing')).toBe('Post Processing');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatSpeed(2097152)).toBe('2.0 MB/s');
    expect(resolveProgress({ ...baseEntry, progress: 50 })).toBe(50);
    expect(resolveProgress({ ...baseEntry, progress: 512, size: 1024, progress_is_percent: false })).toBe(50);
  });

  it('labels percentage and byte progress clearly', () => {
    expect(progressLabel(baseEntry)).toBe('42% complete');
    expect(progressLabel({ ...baseEntry, progress: 512, size: 1024, progress_is_percent: false })).toBe('512.0 B of 1.0 KB');
  });
});

describe('QueueRow', () => {
  it('renders volume link, diagnostic phase text, and visible action labels', () => {
    render(<table><tbody><QueueRow entry={baseEntry} index={0} total={2} onMove={() => undefined} onRemove={() => undefined} /></tbody></table>);

    expect(screen.getByRole('link', { name: 'Absolute Batman 001' }).getAttribute('href')).toContain('/volumes/$volumeId');
    expect(screen.getByText('Downloading')).toBeTruthy();
    expect(screen.getByText('Downloading 4/10')).toBeTruthy();
    expect(screen.getByText('GetComics / MediaFire')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move up' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move down' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove & blocklist' })).toBeTruthy();
  });

  it('adds mobile data labels to every operational cell', () => {
    render(<table><tbody><QueueRow entry={baseEntry} index={1} total={2} onMove={() => undefined} onRemove={() => undefined} /></tbody></table>);

    for (const label of ['Status', 'Title', 'Source', 'Size', 'Speed', 'Progress', 'Actions']) {
      expect(document.querySelector(`td[data-label="${label}"]`)).toBeTruthy();
    }
  });
});
