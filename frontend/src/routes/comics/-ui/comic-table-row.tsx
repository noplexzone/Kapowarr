import { Link } from '@tanstack/react-router';
import { Progress, Badge } from '@/components/primitives';
import { getProgressLabel, getProgressPercent } from '../-comics.helpers';
import type { VolumeSummary } from '../-comics.types';
import styles from './comic-table-row.module.css';

interface ComicTableRowProps {
  volume: VolumeSummary;
  selected: boolean;
  onSelect: (id: number) => void;
}

export function ComicTableRow({ volume, selected, onSelect }: ComicTableRowProps) {
  const progressPct = getProgressPercent(volume.progress);

  return (
    <tr className={styles.row}>
      <td className={styles.checkCell}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(volume.id)}
        />
      </td>
      <td className={styles.titleCell}>
        <Link
          to="/volumes/$volumeId"
          params={{ volumeId: String(volume.id) }}
          className={styles.title}
        >
          {volume.title}
        </Link>
      </td>
      <td className={styles.cell}>{volume.year || '—'}</td>
      <td className={styles.cell}>
        {volume.volume_number ? `Vol. ${volume.volume_number}` : '—'}
      </td>
      <td className={styles.progressCell}>
        <Progress value={progressPct} />
        <span className={styles.progressLabel}>
          {getProgressLabel(volume.progress)}
        </span>
      </td>
      <td className={styles.cell}>
        <Badge tone={volume.monitored ? 'success' : 'neutral'}>
          {volume.monitored ? 'Monitored' : 'Unmonitored'}
        </Badge>
      </td>
    </tr>
  );
}
