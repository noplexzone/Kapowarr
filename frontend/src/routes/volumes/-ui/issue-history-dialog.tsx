import { Badge } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import type { IssueHistoryEntry } from '../-volumes.types';
import styles from './volume-detail-page.module.css';
function formatDownloadTime(unixSeconds: number): string { const d = new Date(unixSeconds * 1000); return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 5); }
interface IssueHistoryDialogProps { issueId: number | null; entries: IssueHistoryEntry[]; loading: boolean; onClose: () => void; }
export function IssueHistoryDialog({ issueId: historyIssueId, entries: historyEntries, loading: historyLoading, onClose: closeHistory }: IssueHistoryDialogProps) { return (
      <DialogFrame
        open={historyIssueId !== null}
        onOpenChange={(open) => {
          if (!open) closeHistory();
        }}
      >
        <DialogHeader
          title={
            historyLoading
              ? 'Loading history…'
              : `Issue History — #${historyIssueId ?? ''}`
          }
          onClose={closeHistory}
        />
        <DialogBody>
          {historyLoading && (
            <p className={styles.dialogStatus}>Loading history…</p>
          )}
          {!historyLoading && historyEntries.length === 0 && (
            <p className={styles.dialogStatus}>No history for this issue.</p>
          )}
          {!historyLoading && historyEntries.length > 0 && (
            <table className={styles.historyTable}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Title</th>
                  <th className={styles.thDate}>Downloaded</th>
                  <th className={styles.thStatus}>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyEntries.map((entry, i) => {
                  const displayTitle =
                    entry.web_title ||
                    entry.file_title ||
                    entry.web_sub_title ||
                    entry.source ||
                    'Unknown';
                  return (
                    <tr key={i}>
                      <td className={styles.sourceCell}>
                        {entry.source_name || entry.source || ''}
                      </td>
                      <td>
                        {entry.web_link ? (
                          <a
                            href={entry.web_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.resultTitle}
                          >
                            {displayTitle}
                          </a>
                        ) : (
                          displayTitle
                        )}
                      </td>
                      <td className={styles.dateCell}>
                        {entry.downloaded_at
                          ? formatDownloadTime(entry.downloaded_at)
                          : '—'}
                      </td>
                      <td>
                        <Badge
                          tone={
                            entry.success === true
                              ? 'success'
                              : entry.success === false
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {entry.success === true
                            ? 'Success'
                            : entry.success === false
                              ? 'Failed'
                              : ''}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </DialogBody>
      </DialogFrame>
); }
