import { useSuspenseQuery } from '@tanstack/react-query';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import { Button, Badge, Progress } from '@/components/primitives';
import { volumeDetailQueryOptions } from '../-comics.api';
import { getCoverUrl, getProgressLabel, getProgressPercent } from '../-comics.helpers';
import styles from './comic-detail-modal.module.css';

interface ComicDetailModalProps {
  volumeId: number;
  open: boolean;
  onClose: () => void;
}

export function ComicDetailModal({ volumeId, open, onClose }: ComicDetailModalProps) {
  const { data: volume } = useSuspenseQuery(
    volumeDetailQueryOptions(1, volumeId),
  );

  if (!volume) return null;

  const progressPct = getProgressPercent(volume.progress);

  return (
    <DialogFrame open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogHeader title={volume.title} onClose={onClose} />

      <DialogBody>
        <div className={styles.detail}>
          <img
            className={styles.cover}
            src={getCoverUrl(volume.id)}
            alt={`Cover for ${volume.title}`}
          />

          <div className={styles.info}>
            <div className={styles.meta}>
              {volume.volume_number > 0 && (
                <span>Volume {volume.volume_number}</span>
              )}
              {volume.year > 0 && <span>{volume.year}</span>}
              {volume.publisher && <span>{volume.publisher}</span>}
            </div>

            <div className={styles.progressSection}>
              <Progress value={progressPct} />
              <span className={styles.progressText}>
                {getProgressLabel(volume.progress)}
              </span>
            </div>

            <Badge tone={volume.monitored ? 'success' : 'neutral'}>
              {volume.monitored ? 'Monitored' : 'Unmonitored'}
            </Badge>

            {volume.description && (
              <p className={styles.description}>{volume.description}</p>
            )}
          </div>
        </div>

        {volume.issues && volume.issues.length > 0 && (
          <div className={styles.issuesSection}>
            <h3 className={styles.issuesTitle}>Issues</h3>
            <div className={styles.issueList}>
              {volume.issues.map((issue) => (
                <div key={issue.id} className={styles.issueRow}>
                  <span className={styles.issueNumber}>
                    #{issue.issue_number}
                  </span>
                  <span className={styles.issueTitle}>
                    {issue.issue_title || '—'}
                  </span>
                  {issue.release_date && (
                    <span className={styles.issueDate}>
                      {issue.release_date}
                    </span>
                  )}
                  <Badge tone={issue.downloaded ? 'success' : issue.monitored ? 'warning' : 'neutral'}>
                    {issue.downloaded ? 'Downloaded' : issue.monitored ? 'Wanted' : 'Unmonitored'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="secondary">Manual Search</Button>
        <Button variant="primary">Auto Search</Button>
      </DialogFooter>
    </DialogFrame>
  );
}
