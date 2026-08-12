import { Link } from '@tanstack/react-router';
import { Card, Progress, Badge, Button } from '@/components/primitives';
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
  onMonitor: (id: number, monitored: boolean) => void;
}

export function ComicCard({ volume, selected, selectionVisible = false, pending = false, onSelect, onSearch, onMonitor }: ComicCardProps) {
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
      >
        <AuthenticatedImage
          className={styles.cover}
          endpoint={`volumes/${volume.id}/cover`}
          alt={`Cover for ${volume.title}`}
          loading="lazy"
        />
      </Link>

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
          <span className={isComplete ? styles.completePill : styles.missingPill}>
            {isComplete ? 'Complete' : `${missingCount} missing`}
          </span>
          {volume.publisher && <span>{volume.publisher}</span>}
        </div>

        <div className={styles.progressRow}>
          <Progress value={progressPct} tone={progressTone} />
          <span className={styles.progressLabel}>
            {getProgressLabel(volume.progress)}
          </span>
        </div>

        <div className={styles.footer}>
          <Badge tone={volume.monitored ? 'success' : 'neutral'}>
            {volume.monitored ? 'Monitored' : 'Unmonitored'}
          </Badge>
        </div>
        <div className={styles.cardActions}>
          <Button
            className={styles.cardActionButton}
            variant="ghost"
            disabled={pending}
            onClick={() => onMonitor(volume.id, !volume.monitored)}
            title={volume.monitored ? 'Unmonitor volume' : 'Monitor volume'}
            aria-label={`${volume.monitored ? 'Unmonitor' : 'Monitor'} ${volume.title}`}
          >
            {volume.monitored ? 'Unmonitor' : 'Monitor'}
          </Button>
          <Button
            className={styles.cardActionButton}
            variant="secondary"
            disabled={pending || missingCount === 0}
            onClick={() => onSearch(volume.id)}
            title={missingCount > 0 ? 'Search missing issues' : 'No missing issues to search'}
            aria-label={`Search missing issues for ${volume.title}`}
          >
            Search Missing
          </Button>
        </div>
      </div>
    </Card>
  );
}
