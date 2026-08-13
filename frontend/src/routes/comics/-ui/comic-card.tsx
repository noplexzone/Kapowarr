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
  manageMode?: boolean;
  selectionVisible?: boolean;
  pending?: boolean;
  onSelect: (id: number) => void;
  onSearch: (id: number) => void;
  onMonitor?: (id: number, monitored: boolean) => void;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

export function ComicCard({ volume, selected, manageMode = false, selectionVisible = false, pending = false, onSelect, onSearch, onMonitor }: ComicCardProps) {
  const progressPct = getProgressPercent(volume.progress);
  const progressTone = progressPct >= 100 ? 'success' : 'danger';
  const missingCount = getMissingCount(volume);
  const isComplete = missingCount === 0 && volume.progress.total > 0;

  return (
    <Card className={`${styles.card}${selected ? ` ${styles.selected}` : ''}${selectionVisible ? ` ${styles.selectionVisible}` : ''}${manageMode ? ` ${styles.manageMode}` : ''}`}>
      {(manageMode || selectionVisible || selected) && (
        <label className={styles.selectControl} data-testid="selection-hit-target" style={{ width: 44, height: 44 }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(volume.id)}
            aria-label={`Select ${volume.title}`}
            style={{ width: 22, height: 22 }}
          />
        </label>
      )}
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

      {!manageMode && (
        <div className={styles.actionTray} aria-label={`Actions for ${volume.title}`}>
          {missingCount > 0 && (
            <Button
              className={styles.trayButton}
              variant="secondary"
              disabled={pending}
              onClick={() => onSearch(volume.id)}
              title="Search missing issues"
              aria-label={`Search missing issues for ${volume.title}`}
            >
              <SearchIcon />
            </Button>
          )}
          <Button
            className={styles.trayButton}
            variant="secondary"
            onClick={() => onMonitor?.(volume.id, !volume.monitored)}
            title={volume.monitored ? 'Unmonitor volume' : 'Monitor volume'}
            aria-label={`${volume.monitored ? 'Unmonitor' : 'Monitor'} ${volume.title}`}
          >
            <span aria-hidden="true">{volume.monitored ? '✓' : '+'}</span>
          </Button>
          <Button
            className={`${styles.trayButton} ${styles.moreButton}`}
            variant="secondary"
            title="More actions"
            aria-label={`More actions for ${volume.title}`}
          >
            <span aria-hidden="true">⋯</span>
          </Button>
        </div>
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
