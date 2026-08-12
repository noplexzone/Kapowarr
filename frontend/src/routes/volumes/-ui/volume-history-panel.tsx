import type { IssueDetail, IssueHistoryEntry } from '../-volumes.types';
import styles from './volume-detail-page.module.css';

export function VolumeHistoryPanel({
  entries,
  issues,
  loading,
  error,
}: {
  entries: IssueHistoryEntry[];
  issues: IssueDetail[];
  loading: boolean;
  error: Error | null;
}) {
  if (loading) return <p role="status">Loading volume history…</p>;
  if (error) return <p role="alert">Unable to load volume history.</p>;
  if (entries.length === 0) return <p>No download history is recorded for this volume.</p>;

  const issueById = new Map(issues.map((issue) => [issue.id, issue]));

  return (
    <table className={styles.searchResultTable}>
      <thead>
        <tr>
          <th>Release</th>
          <th>Issue</th>
          <th>Source</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => {
          const issue = entry.issue_id == null ? undefined : issueById.get(entry.issue_id);
          const status = entry.success === true ? 'Downloaded' : entry.success === false ? 'Failed' : 'Pending';
          return (
            <tr key={`${entry.web_link}:${entry.downloaded_at ?? index}`}>
              <td>{entry.web_title || entry.file_title || 'Untitled release'}</td>
              <td>{issue ? `#${issue.issue_number}${issue.title ? ` — ${issue.title}` : ''}` : 'Volume-wide'}</td>
              <td>{entry.source_name || entry.source || 'Unknown'}</td>
              <td>{status}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
