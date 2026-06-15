import { useState } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Progress } from '@/components/primitives';
import { getCoverUrl } from '@/routes/comics/-comics.helpers';
import {
  volumeDetailFullQueryOptions,
  VOLUME_FULL_KEY,
  deleteVolume,
  autoSearchVolume,
  manualSearchVolume,
} from '../-volumes.api';
import styles from './volume-detail-page.module.css';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function VolumeDetailPage() {
  const { volumeId } = useParams({ strict: false }) as { volumeId: string };
  const id = parseInt(volumeId ?? '0', 10);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [descExpanded, setDescExpanded] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const { data: volume, isLoading, error } = useQuery(volumeDetailFullQueryOptions(id));

  const deleteMutation = useMutation({
    mutationFn: () => deleteVolume(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: VOLUME_FULL_KEY(id) });
      queryClient.invalidateQueries({ queryKey: ['volumes', 'list'] });
      navigate({ to: '/comics' });
    },
  });

  const autoSearchMutation = useMutation({
    mutationFn: () => autoSearchVolume(id),
    onSuccess: () => setActionMsg('Auto search started.'),
  });

  const manualSearchMutation = useMutation({
    mutationFn: () => manualSearchVolume(id),
    onSuccess: () => setActionMsg('Manual search started.'),
  });

  if (isLoading) {
    return <div className={styles.loading}>Loading volume…</div>;
  }

  if (error || !volume) {
    return (
      <div className={styles.errorPage}>
        <p className={styles.errorMsg}>Volume not found or failed to load.</p>
        <Link to="/comics" className={styles.backLink}>
          ← Back to Comics
        </Link>
      </div>
    );
  }

  const progressPct =
    volume.issue_count > 0
      ? Math.round((volume.issues_downloaded / volume.issue_count) * 100)
      : 0;
  const progressTone = progressPct >= 100 ? 'success' : 'danger';

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link to="/comics" className={styles.breadcrumbLink}>
          Comics
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{volume.title}</span>
      </nav>

      {actionMsg && (
        <div className={styles.actionMsg}>{actionMsg}</div>
      )}

      <div className={styles.header}>
        <img
          className={styles.cover}
          src={getCoverUrl(volume.id)}
          alt={`Cover for ${volume.title}`}
        />

        <div className={styles.info}>
          <h1 className={styles.title}>{volume.title}</h1>

          <div className={styles.metaRow}>
            {volume.year > 0 && <span className={styles.metaItem}>{volume.year}</span>}
            {volume.publisher && <span className={styles.metaItem}>{volume.publisher}</span>}
            {volume.volume_number > 0 && (
              <span className={styles.metaItem}>Vol. {volume.volume_number}</span>
            )}
            {volume.special_version && (
              <Badge tone="info">{volume.special_version}</Badge>
            )}
          </div>

          <div className={styles.progressRow}>
            <Progress value={progressPct} tone={progressTone} />
            <span className={styles.progressText}>
              {volume.issues_downloaded} / {volume.issue_count} issues
            </span>
          </div>

          <div className={styles.statusRow}>
            <Badge tone={volume.monitored ? 'success' : 'neutral'}>
              {volume.monitored ? 'Monitored' : 'Unmonitored'}
            </Badge>
            {volume.root_folder_path && (
              <span className={styles.folderPath}>{volume.root_folder_path}</span>
            )}
          </div>

          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => autoSearchMutation.mutate()}
              disabled={autoSearchMutation.isPending}
            >
              Auto Search
            </Button>
            <Button
              variant="secondary"
              onClick={() => manualSearchMutation.mutate()}
              disabled={manualSearchMutation.isPending}
            >
              Manual Search
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm(`Delete "${volume.title}"? This cannot be undone.`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      {volume.description && (
        <section className={styles.section}>
          <button
            className={styles.sectionToggle}
            onClick={() => setDescExpanded((e) => !e)}
            type="button"
          >
            <span>Description</span>
            <span className={styles.toggleIcon}>{descExpanded ? '▲' : '▼'}</span>
          </button>
          {descExpanded && <p className={styles.description}>{volume.description}</p>}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Issues ({volume.issues.length})
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thNum}>#</th>
                <th>Title</th>
                <th className={styles.thDate}>Release Date</th>
                <th className={styles.thStatus}>Status</th>
                <th className={styles.thSize}>Size</th>
              </tr>
            </thead>
            <tbody>
              {volume.issues.map((issue) => (
                <tr key={issue.id} className={styles.issueRow}>
                  <td className={styles.issueNum}>#{issue.issue_number}</td>
                  <td className={styles.issueTitle}>{issue.title || '—'}</td>
                  <td className={styles.issueDate}>{issue.release_date || '—'}</td>
                  <td>
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
                  </td>
                  <td className={styles.issueSize}>
                    {issue.size > 0 ? formatFileSize(issue.size) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
