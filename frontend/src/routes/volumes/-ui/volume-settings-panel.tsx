import { Button } from '@/components/primitives';
import styles from './volume-detail-page.module.css';

export function VolumeSettingsPanel({
  onEdit,
  onManageIssues,
}: {
  onEdit: () => void;
  onManageIssues: () => void;
}) {
  return (
    <div className={styles.tabActionList}>
      <div className={styles.tabActionRow}>
        <span>Edit monitoring, folder, and metadata settings for this volume.</span>
        <Button variant="secondary" onClick={onEdit}>Open Volume Settings</Button>
      </div>
      <div className={styles.tabActionRow}>
        <span>Inspect or correct matched issue files without leaving the detail page.</span>
        <Button variant="secondary" onClick={onManageIssues}>Manage Issues</Button>
      </div>
    </div>
  );
}
