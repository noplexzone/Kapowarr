import { Link } from '@tanstack/react-router';
import type { QueueEntry } from '@/routes/activity/queue/-queue.types';
import { Badge, Progress } from '@/components/primitives';
import type { IssueDetail } from '../-volumes.types';
import { BookOpenIcon, CoverPageIcon, HistoryIcon, PersonIcon, SearchIcon } from './volume-detail-icons';
import styles from './volume-detail-page.module.css';
function formatFileSize(bytes: number): string { if (bytes === 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(1024)); const size = bytes / Math.pow(1024, i); return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`; }
export interface IssueRowProps {
  issue: IssueDetail;
  volumeId: number;
  queueEntry?: QueueEntry;
  onAutoSearch: () => void;
  onManualSearch: () => void;
  onHistory: () => void;
  onAddCover: (fileId: number, filename: string) => void;
  isAutoSearching: boolean;
}

export function IssueRow({
  issue,
  queueEntry,
  onAutoSearch,
  onManualSearch,
  onHistory,
  onAddCover,
  isAutoSearching,
}: IssueRowProps) {
  const pdfFile = issue.filenames
    .map((filename, index) => ({ filename, fileId: issue.file_ids[index] }))
    .find(({ filename, fileId }) =>
      fileId != null && filename.toLowerCase().endsWith('.pdf'),
    );

  return (
    <tr className={styles.issueRow}>
      <td data-label="Issue" className={styles.issueNum}>#{issue.issue_number}</td>
      <td data-label="Title" className={styles.issueTitle}>{issue.title || '—'}</td>
      <td data-label="Filename" className={styles.issueFilename}>
        {issue.filenames.length > 0
          ? issue.filenames.map((f, i) => (
              <span key={i} className={styles.filenameLine}>
                {f}
              </span>
            ))
          : '—'}
      </td>
      <td data-label="Released" className={styles.issueDate}>{issue.release_date || '—'}</td>
      <td data-label="Status">
        {queueEntry ? (
          <div className={styles.downloadProgress}>
            <Progress
              value={
                queueEntry.progress_is_percent !== false
                  ? Math.round(queueEntry.progress)
                  : queueEntry.size > 0
                    ? Math.round((queueEntry.progress / queueEntry.size) * 100)
                    : 0
              }
              tone="success"
              className={styles.issueProgressBar}
            />
            <span className={styles.queueTaskLabel}>
              {queueEntry.task_label || 'Downloading'}
            </span>
          </div>
        ) : (
          <Badge
            tone={
              issue.downloaded
                ? 'success'
                : issue.monitored
                  ? 'warning'
                  : 'neutral'
            }
          >
            {issue.downloaded
              ? 'Downloaded'
              : issue.monitored
                ? 'Wanted'
                : 'Unmonitored'}
          </Badge>
        )}
      </td>
      <td data-label="Size" className={styles.issueSize}>
        {issue.size > 0 ? formatFileSize(issue.size) : '—'}
      </td>
      <td data-label="Actions" className={styles.actionsCell}>
        <div className={styles.issueActions}>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="Auto search for this issue"
            aria-label="Auto search for this issue"
            disabled={isAutoSearching}
            onClick={onAutoSearch}
          >
            {isAutoSearching ? '…' : <SearchIcon />}
          </button>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="Manually search for this issue"
            aria-label="Manually search for this issue"
            onClick={onManualSearch}
          >
            <PersonIcon />
          </button>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="View history for this issue"
            aria-label="View history for this issue"
            onClick={onHistory}
          >
            <HistoryIcon />
          </button>
          {pdfFile && (
            <button
              type="button"
              className={styles.issueActionBtn}
              title={`Add cover page to "${pdfFile.filename}"`}
              aria-label={`Add cover page to "${pdfFile.filename}"`}
              onClick={() => onAddCover(pdfFile.fileId, pdfFile.filename)}
            >
              <CoverPageIcon />
            </button>
          )}
          {issue.downloaded && issue.file_ids.length > 0 && (
            <Link
              to="/read/$fileId"
              params={{ fileId: String(issue.file_ids[0]) }}
              className={styles.issueActionBtn}
              title="Read this issue"
              aria-label="Read this issue"
            >
              <BookOpenIcon />
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}
