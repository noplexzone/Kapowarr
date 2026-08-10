import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scanBulk, importSelected, deleteUnmatched } = vi.hoisted(() => ({
  scanBulk: vi.fn(),
  importSelected: vi.fn(),
  deleteUnmatched: vi.fn(),
}));

vi.mock('../-import.api', () => ({ scanBulk, importSelected, deleteUnmatched }));
vi.mock('@/components/dialog', () => ({
  DialogFrame: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }) => open ? (
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

import { ImportPage } from './import-page';

const matched = {
  folder: '/library/Matched',
  cv_id: 1,
  file_title: 'Matched',
  matched: true,
  id_type: 'volume',
  match_type: 'comicinfo' as const,
  match_title: 'Matched',
};
const unmatchedOne = {
  folder: '/library/Unmatched One',
  file_title: 'Unmatched One',
  matched: false,
  id_type: null,
  match_type: null,
};
const unmatchedTwo = {
  folder: '/library/Unmatched Two',
  file_title: 'Unmatched Two',
  matched: false,
  id_type: null,
  match_type: null,
};

function readyScan() {
  scanBulk.mockImplementation(async function* () {
    yield matched;
    yield unmatchedOne;
    yield unmatchedTwo;
  });
}

async function renderScannedPage() {
  render(<ImportPage section='comic' />);
  fireEvent.click(screen.getByRole('button', { name: 'Start Scan' }));
  await waitFor(() => expect(screen.getByText('/library/Unmatched Two')).toBeTruthy());
}

describe('unmatched folder deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readyScan();
  });

  it('keeps deletion disabled when a scan fails after partial results', async () => {
    scanBulk.mockImplementation(async function* () {
      yield unmatchedOne;
      throw new Error('Invalid library-import scan event');
    });

    render(<ImportPage section='comic' />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Scan' }));

    await screen.findByText(/Invalid library-import scan event/);
    const deleteAfterFailure = screen.getByRole('button', { name: 'Delete Unmatched (1)' });
    expect((deleteAfterFailure as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(deleteAfterFailure);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteUnmatched).not.toHaveBeenCalled();
  });

  it('does not allow deletion until the streaming scan is complete', async () => {
    let finishScan: (() => void) | undefined;
    scanBulk.mockImplementation(async function* () {
      yield matched;
      yield unmatchedOne;
      await new Promise<void>(resolve => { finishScan = resolve; });
      yield unmatchedTwo;
    });

    render(<ImportPage section='comic' />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Scan' }));
    const deleteWhileScanning = await screen.findByRole('button', { name: 'Delete Unmatched (1)' });
    expect((deleteWhileScanning as HTMLButtonElement).disabled).toBe(true);

    finishScan?.();
    const deleteAfterScan = await screen.findByRole('button', { name: 'Delete Unmatched (2)' });
    await waitFor(() => expect((deleteAfterScan as HTMLButtonElement).disabled).toBe(false));
  });

  it('lists every folder path before deletion', async () => {
    await renderScannedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unmatched (2)' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('/library/Unmatched One');
    expect(dialog.textContent).toContain('/library/Unmatched Two');
  });

  it('blocks duplicate deletion while the request is pending', async () => {
    let resolveDelete: (() => void) | undefined;
    deleteUnmatched.mockReturnValue(new Promise<void>(resolve => { resolveDelete = resolve; }));
    await renderScannedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unmatched (2)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const pendingButton = await screen.findByRole('button', { name: 'Deleting…' });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Close dialog' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss dialog' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(pendingButton);
    expect(deleteUnmatched).toHaveBeenCalledTimes(1);

    resolveDelete?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog and unmatched rows visible when deletion fails', async () => {
    deleteUnmatched.mockRejectedValue(new Error('permission denied'));
    await renderScannedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unmatched (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText(/permission denied/)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('/library/Unmatched One')).toHaveLength(2);
    expect(screen.getAllByText('/library/Unmatched Two')).toHaveLength(2);
  });

  it('closes the dialog and removes only unmatched rows after success', async () => {
    deleteUnmatched.mockResolvedValue(undefined);
    await renderScannedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unmatched (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('/library/Unmatched One')).toBeNull();
    expect(screen.queryByText('/library/Unmatched Two')).toBeNull();
    expect(screen.getByText('/library/Matched')).toBeTruthy();
    expect(screen.getByText('Deleted 2 unmatched folders.')).toBeTruthy();
  });
});
