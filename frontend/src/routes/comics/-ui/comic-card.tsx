import { Link } from '@tanstack/react-router';
import { Card, Progress, Badge, Button } from '@/components/primitives';
import {
  formatVolumeSubtitle,
  getProgressLabel,
  getProgressPercent,
  getCoverUrl,
} from '../-comics.helpers';
import type { VolumeSummary } from '../-comics.types';
import styles from './comic-card.module.css';

interface ComicCardProps {
  volume: VolumeSummary;
  onSearch: (id: number) => void;
}

export function ComicCard({ volume, onSearch }: ComicCardProps) {
  const progressPct = getProgressPercent(volume.progress);

  return (
    <Card className={styles.card}>
      <Link
        to="/volumes/$volumeId"
        params={{ volumeId: String(volume.id) }}
        className={styles.coverArea}
      >
        <img
          className={styles.cover}
          src={getCoverUrl(volume.id)}
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
          <Progress value={progressPct} />
          <span className={styles.progressLabel}>
            {getProgressLabel(volume.progress)}
          </span>
        </div>

        <div className={styles.footer}>
          <Badge tone={volume.monitored ? 'success' : 'neutral'}>
            {volume.monitored ? 'Monitored' : 'Unmonitored'}
          </Badge>
          <Button
            variant="icon"
            onClick={() => onSearch(volume.id)}
            title="Auto Search"
          >
            🔍
          </Button>
        </div>
      </div>
    </Card>
  );
}
