import type { GeneralFileDetail, IssueDetail } from '../-volumes.types';
import styles from './volume-detail-page.module.css';

export function VolumeFilesPanel({
  issues,
  generalFiles,
}: {
  issues: IssueDetail[];
  generalFiles: GeneralFileDetail[];
}) {
  const issueFiles = issues.flatMap((issue) => issue.filenames.map((filename, index) => ({
    id: `issue:${issue.file_ids[index] ?? `${issue.id}:${index}`}`,
    filename,
    association: `Issue #${issue.issue_number}${issue.title ? ` — ${issue.title}` : ''}`,
  })));
  const files = [
    ...issueFiles,
    ...generalFiles.map((file) => ({
      id: `general:${file.id}`,
      filename: file.filename,
      association: `Volume file — ${file.file_type}`,
    })),
  ];

  if (files.length === 0) return <p>No files are attached to this volume.</p>;

  return (
    <table className={styles.searchResultTable}>
      <thead>
        <tr>
          <th>File</th>
          <th>Association</th>
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr key={file.id}>
            <td>{file.filename}</td>
            <td>{file.association}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
