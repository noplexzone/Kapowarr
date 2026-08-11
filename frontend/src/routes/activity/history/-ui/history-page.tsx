import { useCallback, useState } from 'react';
import { useSuspenseQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Badge, Button } from '@/components/primitives';
import { useSocketEvent } from '@/platform/socketio/socket';
import { Pagination } from '@/components/pagination/pagination';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import { historyQueryOptions, HISTORY_KEY, clearHistory } from '../-history.api';
import type { HistoryState } from '../-history.api';
import styles from './history-page.module.css';

interface HistoryPageProps {
  offset: number;
  state: HistoryState;
}

export function HistoryPage({ offset, state }: HistoryPageProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(historyQueryOptions(offset, state));
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 50;

  const refreshHistory = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
  }, [queryClient]);

  useSocketEvent('queue_ended', refreshHistory);
  useSocketEvent('downloaded_status', refreshHistory);

  const clearMutation = useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      navigate({ to: '/activity/history', search: (prev: any) => ({ ...prev, page: 1, status: state === 'all' ? undefined : state }) });
    },
  });

  const goToPage = (page: number) => {
    navigate({
      to: '/activity/history',
      search: (prev: any) => ({ ...prev, page: page + 1, status: state === 'all' ? undefined : state }),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{total} {state === 'all' ? '' : `${state} `}download{total !== 1 ? 's' : ''}</span>
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
                  <td data-label="Title">{entry.title}</td>
                  <td data-label="Source">
                    <Badge tone="neutral">{entry.source}</Badge>
                  </td>
                  <td data-label="Downloaded At" className={styles.date}>
                    {new Date(entry.downloaded_at).toLocaleString()}
                  </td>
                  <td data-label="State">
                    <Badge tone={stateTone(entry.state)}>
                      {entry.state.charAt(0).toUpperCase() + entry.state.slice(1)}
                    </Badge>
                  </td>
                </tr>
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
