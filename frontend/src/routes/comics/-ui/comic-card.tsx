import { Link } from '@tanstack/react-router';
import { Card, Progress, Button } from '@/components/primitives';
import { AuthenticatedImage } from '@/components/authenticated-resource';
import {
  formatVolumeSubtitle,
  getProgressLabel,
  getProgressPercent,
  getMissingCount,
} from '../-comics.helpers';
import type { VolumeSummary } from '../-comics.types';
import styles from './comic-card.module.css';

interface ComicCardProps {
  volume: VolumeSummary;
  selected: boolean;
  selectionVisible?: boolean;
  pending?: boolean;
  onSelect: (id: number) => void;
  onSearch: (id: number) => void;
}

export function ComicCard({ volume, selected, selectionVisible = false, pending = false, onSelect, onSearch }: ComicCardProps) {
  const progressPct = getProgressPercent(volume.progress);
  const progressTone = progressPct >= 100 ? 'success' : 'danger';
  const missingCount = getMissingCount(volume);
  const isComplete = missingCount === 0 && volume.progress.total > 0;

  return (
    <Card className={`${styles.card}${selected ? ` ${styles.selected}` : ''}${selectionVisible ? ` ${styles.selectionVisible}` : ''}`}>
      <label className={styles.selectControl} data-testid="selection-hit-target" style={{ width: 44, height: 44 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(volume.id)}
          aria-label={`Select ${volume.title}`}
          style={{ width: 22, height: 22 }}
        />
      </label>
      <Link
        to="/volumes/$volumeId"
        params={{ volumeId: String(volume.id) }}
        className={styles.coverArea}
        aria-label={`Open ${volume.title}`}
      >
        <AuthenticatedImage
          className={styles.cover}
          endpoint={`volumes/${volume.id}/cover`}
          alt={`Cover for ${volume.title}`}
          loading="lazy"
        />
      </Link>

      {missingCount > 0 && (
        <Button
          className={styles.searchOverlayButton}
          variant="secondary"
          disabled={pending}
          onClick={() => onSearch(volume.id)}
          title="Search missing issues"
          aria-label={`Search missing issues for ${volume.title}`}
        >
          <span aria-hidden="true">⌕</span>
        </Button>
      )}

      <div className={styles.meta}>
        <Link
          to="/volumes/$volumeId"
          params={{ volumeId: String(volume.id) }}
          className={styles.title}
        >
          {volume.title}
        </Link>
        <p className={styles.subtitle}>{formatVolumeSubtitle(volume)}</p>

        <div className={styles.statusStrip} aria-label={`Status for ${volume.title}`}>
          <span>{isComplete ? 'Complete' : 'Missing issues'}</span>
          {volume.publisher && <span>{volume.publisher}</span>}
        </div>

        <div className={styles.progressRow}>
          <Progress value={progressPct} tone={progressTone} />
          <span className={styles.progressLabel}>
            {getProgressLabel(volume.progress)}
          </span>
        </div>
      </div>
    </Card>
  );
}
