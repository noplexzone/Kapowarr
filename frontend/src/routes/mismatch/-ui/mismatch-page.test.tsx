import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scanMismatch, matchItems, deleteFolders } = vi.hoisted(() => ({
  scanMismatch: vi.fn(),
  matchItems: vi.fn(),
  deleteFolders: vi.fn(),
}));

vi.mock('../-mismatch.api', () => ({ scanMismatch, matchItems, deleteFolders }));
vi.mock('@/components/dialog', () => ({
  DialogFrame: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => open ? (
    <div role='dialog'>
      <button type='button' onClick={() => onOpenChange(false)}>Dismiss dialog</button>
      {children}
    </div>
  ) : null,
  DialogHeader: ({ title, onClose }: { title: string; onClose?: () => void }) => (
    <div>
      <h2>{title}</h2>
      {onClose && <button type='button' onClick={onClose}>Close dialog</button>}
    </div>
  ),
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MismatchPage } from './mismatch-page';

const mismatch = {
  folder: '/library/Wrong Folder',
  file_title: 'Right Title',
  cv_id: 12,
  issue_count: 5,
  status: 'unmatched',
  match_type: 'title',
};

function readyScan() {
  scanMismatch.mockImplementation(async function* () {
    yield mismatch;
  });
}

describe('MismatchPage diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readyScan();
  });

  it('renders diagnostic summary and labelled mobile-card cells', async () => {
    render(<MismatchPage section='comic' />);

    await screen.findByText('/library/Wrong Folder');
    expect(screen.getByRole('heading', { name: 'Mismatch Review' })).toBeTruthy();
    expect(screen.getByLabelText('Mismatch scan summary').textContent).toContain('Folders');
    expect(screen.getByText('1 folders · 1 naming mismatches · 0 selected')).toBeTruthy();
    expect(screen.getByText('/library/Wrong Folder').closest('td')?.getAttribute('data-label')).toBe('Folder');
    expect(screen.getByText('Right Title').closest('td')?.getAttribute('data-label')).toBe('Suggested Match');
    expect(screen.getByRole('button', { name: 'Match' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('removes a matched row through the supported match action', async () => {
    matchItems.mockResolvedValue(undefined);
    render(<MismatchPage section='comic' />);
    await screen.findByText('/library/Wrong Folder');

    fireEvent.click(screen.getByRole('button', { name: 'Match' }));

    await waitFor(() => expect(matchItems).toHaveBeenCalledWith([
      { folder: '/library/Wrong Folder', cv_id: '12', file_title: 'Right Title' },
    ]));
    await waitFor(() => expect(screen.queryByText('/library/Wrong Folder')).toBeNull());
  });
});
