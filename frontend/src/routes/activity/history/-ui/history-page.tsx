import { useState } from 'react';
import { useSuspenseQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Badge, Button } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import { historyQueryOptions, HISTORY_KEY, clearHistory } from '../-history.api';
import styles from './history-page.module.css';

interface HistoryPageProps {
  offset: number;
}

export function HistoryPage({ offset }: HistoryPageProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(historyQueryOptions(offset));
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 50;
  const pageCount = Math.ceil(total / pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;

  const clearMutation = useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      navigate({ to: '/activity/history', search: { offset: 0 } });
    },
  });

  const goToPage = (page: number) => {
    navigate({
      to: '/activity/history',
      search: { offset: (page - 1) * pageSize },
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{total} download{total !== 1 ? 's' : ''}</span>
        <Button
          variant="secondary"
          onClick={() => setConfirmClear(true)}
          disabled={entries.length === 0}
        >
          Clear History
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className={styles.empty}>No download history</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Downloaded At</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.title}</td>
                  <td>
                    <Badge tone="neutral">{entry.source}</Badge>
                  </td>
                  <td className={styles.date}>
                    {new Date(entry.downloaded_at).toLocaleString()}
                  </td>
                  <td>
                    <Badge tone={stateTone(entry.state)}>{entry.state}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className={styles.pagination}>
          <Button
            variant="ghost"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            Previous
          </Button>
          <span className={styles.pageInfo}>Page {currentPage} of {pageCount}</span>
          <Button
            variant="ghost"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pageCount}
          >
            Next
          </Button>
        </div>
      )}

      <DialogFrame open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
        <DialogHeader title="Clear History" onClose={() => setConfirmClear(false)} />
        <DialogBody>
          <p>Remove all download history entries? This cannot be undone.</p>
        </DialogBody>
        <DialogFooter>
          <div className={styles.confirmFooter}>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? 'Clearing…' : 'Clear History'}
            </Button>
          </div>
        </DialogFooter>
      </DialogFrame>
    </div>
  );
}

function stateTone(state: string): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (state) {
    case 'downloaded': return 'success';
    case 'failed': return 'danger';
    case 'cancelled': return 'warning';
    default: return 'neutral';
  }
}
