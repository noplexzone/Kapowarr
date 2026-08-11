import { useCallback } from 'react';
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Badge } from '@/components/primitives';
import { useSocketEvent } from '@/platform/socketio/socket';
import { Pagination } from '@/components/pagination/pagination';
import { SEARCH_HISTORY_KEY, searchHistoryQueryOptions } from '../-search-history.api';
import type { SearchOutcome } from '../-search-history.types';
import styles from './search-history-page.module.css';

interface SearchHistoryPageProps {
  offset: number;
}

export function SearchHistoryPage({ offset }: SearchHistoryPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(searchHistoryQueryOptions(offset));
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 15;

  const refreshSearchHistory = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SEARCH_HISTORY_KEY });
  }, [queryClient]);

  useSocketEvent('task_added', refreshSearchHistory);
  useSocketEvent('task_ended', refreshSearchHistory);

  const goToPage = (page: number) => {
    navigate({
      to: '/activity/search-history',
      search: (prev: any) => ({ ...prev, page: page + 1 }),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h1 className={styles.title}>Search History</h1>
          <p className={styles.subtitle}>Completed auto-search outcomes, including searches that found results but rejected every candidate.</p>
        </div>
        <span className={styles.toolbarCount}>{total} search{total !== 1 ? 'es' : ''}</span>
      </div>

      {entries.length === 0 ? (
        <div className={styles.empty}>No search history yet</div>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <article key={entry.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleGroup}>
                  <h2 className={styles.cardTitle}>{entry.title}</h2>
                  <span className={styles.cardMeta}>{entry.scope} · {new Date(entry.run_at).toLocaleString()}</span>
                </div>
                <Badge tone={outcomeTone(entry.outcome)}>{entry.outcome_label}</Badge>
              </div>
              <p className={styles.summary}>{entry.message}</p>
              {entry.queries.length > 0 && (
                <div className={styles.queryBlock}>
                  <span className={styles.queryLabel}>Query</span>
                  <div className={styles.queryList}>
                    {entry.queries.slice(0, 4).map((query) => (
                      <code key={query} className={styles.queryChip}>{query}</code>
                    ))}
                    {entry.queries.length > 4 && (
                      <span className={styles.moreQueries}>+{entry.queries.length - 4} more</span>
                    )}
                  </div>
                </div>
              )}
              <div className={styles.stats}>
                <span><strong>{entry.total_found}</strong> found</span>
                <span><strong>{entry.matched_count}</strong> matched</span>
                <span><strong>{entry.downloads_count}</strong> queued</span>
              </div>
              {entry.issues.length > 0 && (
                <div className={styles.issueList} aria-label="Issue outcomes">
                  {entry.issues.map((issue, idx) => (
                    <div key={`${entry.id}-${issue.issue_number}-${idx}`} className={styles.issueRow}>
                      <span className={styles.issueNumber}>#{issue.issue_number}</span>
                      <Badge tone={issue.matched ? 'success' : 'neutral'}>{issue.matched ? 'Matched' : 'No match'}</Badge>
                      <span className={styles.issueTitle}>{issue.title}</span>
                      {issue.source && <span className={styles.issueSource}>{issue.source}</span>}
                    </div>
                  ))}
                  {entry.issue_count > entry.issues.length && (
                    <div className={styles.moreIssues}>+{entry.issue_count - entry.issues.length} more issue outcomes</div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Pagination
        page={offset}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
      />
    </div>
  );
}

function outcomeTone(outcome: SearchOutcome): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (outcome) {
    case 'matched': return 'success';
    case 'no_match': return 'warning';
    case 'failed': return 'danger';
    case 'no_results': return 'neutral';
  }
}
