import { Link } from '@tanstack/react-router';
import { Card, Progress, Badge, Button } from '@/components/primitives';
import { AuthenticatedImage } from '@/components/authenticated-resource';
import {
  formatVolumeSubtitle,
  getProgressLabel,
  getProgressPercent,
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
          <div className={styles.cardActions}>
            <Button
              variant="icon"
              disabled={pending}
              onClick={() => onMonitor(volume.id, !volume.monitored)}
              title={volume.monitored ? 'Unmonitor volume' : 'Monitor volume'}
              aria-label={`${volume.monitored ? 'Unmonitor' : 'Monitor'} ${volume.title}`}
            >
              {volume.monitored ? '◉' : '○'}
            </Button>
            <Button
              variant="icon"
              disabled={pending}
              onClick={() => onSearch(volume.id)}
              title="Auto Search"
              aria-label={`Auto search ${volume.title}`}
            >
              🔍
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
