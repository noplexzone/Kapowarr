import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: any) => (
    <a href={typeof to === 'string' ? to.replace('$volumeId', params?.volumeId ?? '').replace('$fileId', params?.fileId ?? '') : '#route'} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/authenticated-resource', () => ({
  AuthenticatedImage: ({ alt, className }: { alt: string; className?: string }) => <img alt={alt} className={className} src="/cover-test.jpg" />,
}));

import type { VolumeDetailFull } from '../-volumes.types';
import styles from './volume-detail-page.module.css';
import { getMissingIssueCount, getReadableIssue, VolumeHero } from './volume-hero';

const baseVolume: VolumeDetailFull = {
  id: 7,
  comicvine_id: 123,
  title: 'Saga',
  year: 2012,
  publisher: 'Image',
  volume_number: 1,
  special_version: '',
  section: 'comic',
  description: '<p>A space opera.</p>',
  monitored: true,
  monitor_new_issues: true,
  folder: '/comics/Saga',
  root_folder: 1,
  root_folder_path: '/comics',
  issue_count: 10,
  issues_downloaded: 3,
  cover: '',
  general_files: [],
  issues: [
    { id: 1, comicvine_id: 1001, issue_number: '1', title: 'One', monitored: true, downloaded: true, size: 1024, file_ids: [88], filenames: ['Saga 001.cbz'] },
    { id: 2, comicvine_id: 1002, issue_number: '2', title: 'Two', monitored: true, downloaded: false, size: 0, file_ids: [], filenames: [] },
  ],
};

function renderHero(volume: VolumeDetailFull, overrides: Partial<React.ComponentProps<typeof VolumeHero>> = {}) {
  const props: React.ComponentProps<typeof VolumeHero> = {
    volume,
    actionMsg: '',
    progressPct: Math.round((volume.issues_downloaded / Math.max(volume.issue_count, 1)) * 100),
    progressTone: 'danger',
    refreshPending: false,
    autoSearchPending: false,
    manualSearchPending: false,
    onRefresh: vi.fn(),
    onAutoSearch: vi.fn(),
    onManualSearch: vi.fn(),
    onEdit: vi.fn(),
    onFixMatch: vi.fn(),
    onPreviewRename: vi.fn(),
    onManageIssues: vi.fn(),
    onImportFiles: vi.fn(),
    ...overrides,
  };
  render(<VolumeHero {...props} />);
  return props;
}

describe('VolumeHero media detail actions', () => {
  it('prioritizes searching missing monitored issues when a volume is incomplete', () => {
    const onAutoSearch = vi.fn();
    renderHero(baseVolume, { onAutoSearch });

    expect(screen.getByTestId('volume-hero').querySelector(`.${styles.publisherBackdrop}`)).toBeTruthy();
    expect(screen.getByText('7 missing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search Missing' }));
    expect(onAutoSearch).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Refresh & Scan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import Files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage Issues' })).toBeTruthy();
  });

  it('offers a readable first issue as the primary action when complete', () => {
    renderHero({ ...baseVolume, issue_count: 1, issues_downloaded: 1, issues: [baseVolume.issues[0]] }, { progressTone: 'success', progressPct: 100 });

    const readLink = screen.getByRole('link', { name: 'Read First Issue' });
    expect(readLink.getAttribute('href')).toContain('/read/88');
    expect(screen.getByText('Complete')).toBeTruthy();
  });

  it('derives missing and readable state from volume details', () => {
    expect(getMissingIssueCount(baseVolume)).toBe(7);
    expect(getReadableIssue(baseVolume)?.fileId).toBe(88);
  });
});
