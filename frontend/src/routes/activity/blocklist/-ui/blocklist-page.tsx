import { useState } from 'react';
import { useSuspenseQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/primitives';
import { Pagination } from '@/components/pagination/pagination';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import {
  blocklistQueryOptions,
  BLOCKLIST_KEY,
  deleteBlocklistEntry,
  clearBlocklist,
} from '../-blocklist.api';
import type { BlocklistEntry } from '../-blocklist.types';
import styles from './blocklist-page.module.css';

interface BlocklistPageProps {
  offset: number;
}

export function BlocklistPage({ offset }: BlocklistPageProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(blocklistQueryOptions(offset));
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 50;

  const clearMutation = useMutation({
    mutationFn: clearBlocklist,
    onSuccess: () => {
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: BLOCKLIST_KEY });
      navigate({ to: '/activity/blocklist', search: { offset: 0 } });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBlocklistEntry(id),
    onSuccess: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: BLOCKLIST_KEY });
    },
  });

  const goToPage = (page: number) => {
    navigate({
      to: '/activity/blocklist',
      search: { offset: page },
    });
  };

  const confirmEntry = entries.find((e) => e.id === confirmDeleteId);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{total} entr{total !== 1 ? 'ies' : 'y'}</span>
        <Button
          variant="secondary"
          onClick={() => setConfirmClear(true)}
          disabled={entries.length === 0}
        >
          Clear Blocklist
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className={styles.empty}>Blocklist is empty</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Link</th>
                <th>Reason</th>
                <th>Added At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <BlocklistRow
                  key={entry.id}
                  entry={entry}
                  onDelete={() => setConfirmDeleteId(entry.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={offset}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
      />

      {/* Delete single entry confirmation */}
      <DialogFrame
        open={confirmDeleteId != null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <DialogHeader title="Remove Entry" onClose={() => setConfirmDeleteId(null)} />
        <DialogBody>
          <p>Remove &ldquo;{confirmEntry ? displayTitle(confirmEntry) : ''}&rdquo; from the blocklist?</p>
        </DialogBody>
        <DialogFooter>
          <div className={styles.confirmFooter}>
            <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => confirmDeleteId != null && deleteMutation.mutate(confirmDeleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </DialogFooter>
      </DialogFrame>

      {/* Clear all confirmation */}
      <DialogFrame open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
        <DialogHeader title="Clear Blocklist" onClose={() => setConfirmClear(false)} />
        <DialogBody>
          <p>Remove all {total} entries from the blocklist? This cannot be undone.</p>
        </DialogBody>
        <DialogFooter>
          <div className={styles.confirmFooter}>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? 'Clearing…' : 'Clear Blocklist'}
            </Button>
          </div>
        </DialogFooter>
      </DialogFrame>
    </div>
  );
}

function displayTitle(entry: BlocklistEntry): string {
  return entry.web_title ?? entry.web_sub_title ?? 'Unknown';
}

interface BlocklistRowProps {
  entry: BlocklistEntry;
  onDelete: () => void;
}

function BlocklistRow({ entry, onDelete }: BlocklistRowProps) {
  return (
    <tr>
      <td data-label="Title">{displayTitle(entry)}</td>
      <td data-label="Link">
        {entry.web_link && (
          <a
            href={entry.web_link}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            View source
          </a>
        )}
      </td>
      <td data-label="Reason" className={styles.reason}>{entry.reason}</td>
      <td data-label="Added At" className={styles.date}>{new Date(entry.added_at).toLocaleString()}</td>
      <td data-label="Actions">
        <Button
          variant="ghost"
          onClick={onDelete}
          title="Delete"
          aria-label={`Remove ${displayTitle(entry)} from blocklist`}
        >
          ✕
        </Button>
      </td>
    </tr>
  );
}
