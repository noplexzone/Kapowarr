import type { QueueEntry } from '@/routes/activity/queue/-queue.types';
import type { IssueDetail } from '../-volumes.types';
import { IssueRow } from './issue-row';
import styles from './volume-detail-page.module.css';
interface IssuesSectionProps { issues: IssueDetail[]; volumeId: number; queueEntries: Map<number, QueueEntry>; autoSearchingIssueId?: number; onAutoSearch: (issueId: number) => void; onManualSearch: (issueId: number) => void; onHistory: (issueId: number) => void; onAddCover: (fileId: number, issueId: number, filename: string) => void; }
export function IssuesSection({ issues, volumeId, queueEntries, autoSearchingIssueId, onAutoSearch, onManualSearch, onHistory, onAddCover }: IssuesSectionProps) { return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Issues ({issues.length})
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thNum}>#</th>
                <th>Title</th>
                <th className={styles.thFilename}>Filename</th>
                <th className={styles.thDate}>Release Date</th>
                <th className={styles.thStatus}>Status</th>
                <th className={styles.thSize}>Size</th>
                <th className={styles.thActions}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  volumeId={volumeId}
                  queueEntry={queueEntries.get(issue.id)}
                  onAutoSearch={() =>
                    onAutoSearch(issue.id)
                  }
                  onManualSearch={() => onManualSearch(issue.id)}
                  onHistory={() => onHistory(issue.id)}
                  onAddCover={(fileId, filename) =>
                    onAddCover(fileId, issue.id, filename)
                  }
                  isAutoSearching={
                    autoSearchingIssueId === issue.id
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
); }
