import { Link } from '@tanstack/react-router';
import { Badge, Button, Progress } from '@/components/primitives';
import { StatusBanner } from '@/components/patterns';
import { AuthenticatedImage } from '@/components/authenticated-resource';
import type { IssueDetail, VolumeDetailFull } from '../-volumes.types';
import { sanitizeHtml } from './sanitize';
import { BookOpenIcon, PencilIcon, PersonIcon, RefreshIcon, SearchIcon } from './volume-detail-icons';
import styles from './volume-detail-page.module.css';

interface VolumeHeroProps {
  volume: VolumeDetailFull;
  actionMsg: string;
  progressPct: number;
  progressTone: 'success' | 'danger';
  refreshPending: boolean;
  autoSearchPending: boolean;
  manualSearchPending: boolean;
  onRefresh: () => void;
  onAutoSearch: () => void;
  onManualSearch: () => void;
  onEdit: () => void;
  onFixMatch: () => void;
  onPreviewRename: () => void;
  onManageIssues: () => void;
  onImportFiles: () => void;
}

export function getMissingIssueCount(volume: VolumeDetailFull): number {
  const aggregateMissing = Math.max(0, volume.issue_count - volume.issues_downloaded);
  const detailedMissing = volume.issues.filter((issue) => issue.monitored && !issue.downloaded).length;
  return Math.max(aggregateMissing, detailedMissing);
}

export function getReadableIssue(volume: VolumeDetailFull): { issue: IssueDetail; fileId: number } | null {
  for (const issue of volume.issues) {
    const fileId = issue.file_ids[0];
    if (issue.downloaded && fileId != null) return { issue, fileId };
  }
  return null;
}

export function VolumeHero({
  volume,
  actionMsg,
  progressPct,
  progressTone,
  refreshPending,
  autoSearchPending,
  manualSearchPending,
  onRefresh,
  onAutoSearch,
  onManualSearch,
  onEdit,
  onFixMatch,
  onPreviewRename,
  onManageIssues,
  onImportFiles,
}: VolumeHeroProps) {
  const missingCount = getMissingIssueCount(volume);
  const readableIssue = getReadableIssue(volume);
  const isComplete = missingCount === 0 && progressPct >= 100;
  const primaryAction = missingCount > 0
    ? { kind: 'search' as const, label: autoSearchPending ? 'Searching…' : 'Search Missing' }
    : readableIssue
      ? { kind: 'read' as const, label: 'Read First Issue' }
      : { kind: 'manage' as const, label: 'Manage Issues' };

  return <>
    <nav className={styles.breadcrumb}>
      <Link
        to={volume.section === 'manga' ? '/manga' : '/comics'}
        className={styles.breadcrumbLink}
      >
        {volume.section === 'manga' ? 'Manga' : 'Comics'}
      </Link>
      <span className={styles.breadcrumbSep}>/</span>
      <span className={styles.breadcrumbCurrent}>{volume.title}</span>
    </nav>

    {actionMsg && <StatusBanner>{actionMsg}</StatusBanner>}

    <div className={styles.mediaHero} data-testid="volume-hero">
      <AuthenticatedImage
        className={styles.heroBackdrop}
        endpoint={`volumes/${volume.id}/cover`}
        alt=""
        aria-hidden="true"
      />
      <div className={styles.coverStack}>
        <AuthenticatedImage
          className={styles.cover}
          endpoint={`volumes/${volume.id}/cover`}
          alt={`Cover for ${volume.title}`}
        />
        <Badge tone={isComplete ? 'success' : 'warning'}>
          {isComplete ? 'Complete' : `${missingCount} missing`}
        </Badge>
      </div>

      <div className={styles.info}>
        <div className={styles.heroKicker}>{volume.section === 'manga' ? 'Manga volume' : 'Comic volume'}</div>
        <h1 className={styles.title}>{volume.title}</h1>

        <div className={styles.metaRow}>
          {volume.year > 0 && <span className={styles.metaItem}>{volume.year}</span>}
          {volume.publisher && <span className={styles.metaItem}>{volume.publisher}</span>}
          {volume.volume_number > 0 && <span className={styles.metaItem}>Vol. {volume.volume_number}</span>}
          {volume.special_version && <Badge tone="info">{volume.special_version}</Badge>}
        </div>

        <div className={styles.detailStats} aria-label="Volume status summary">
          <div className={styles.detailStat}>
            <span className={styles.detailStatValue}>{volume.issues_downloaded}</span>
            <span className={styles.detailStatLabel}>Downloaded</span>
          </div>
          <div className={styles.detailStat}>
            <span className={styles.detailStatValue}>{missingCount}</span>
            <span className={styles.detailStatLabel}>Missing</span>
          </div>
          <div className={styles.detailStat}>
            <span className={styles.detailStatValue}>{volume.issue_count}</span>
            <span className={styles.detailStatLabel}>Issues</span>
          </div>
        </div>

        <div className={styles.progressRow}>
          <Progress value={progressPct} tone={progressTone} />
          <span className={styles.progressText}>{volume.issues_downloaded} / {volume.issue_count} issues</span>
        </div>

        <div className={styles.statusRow}>
          <Badge tone={volume.monitored ? 'success' : 'neutral'}>
            {volume.monitored ? 'Monitored' : 'Unmonitored'}
          </Badge>
          {volume.root_folder_path && <span className={styles.folderPath}>{volume.root_folder_path}</span>}
        </div>

        <div className={styles.heroActions}>
          {primaryAction.kind === 'search' && (
            <Button variant="primary" onClick={onAutoSearch} disabled={autoSearchPending} title={autoSearchPending ? 'Searching missing issues…' : 'Search missing monitored issues'}>
              <SearchIcon /> {primaryAction.label}
            </Button>
          )}
          {primaryAction.kind === 'read' && readableIssue && (
            <Link to="/read/$fileId" params={{ fileId: String(readableIssue.fileId) }} className={styles.primaryReadAction}>
              <BookOpenIcon /> {primaryAction.label}
            </Link>
          )}
          {primaryAction.kind === 'manage' && (
            <Button variant="primary" onClick={onManageIssues}>Manage Issues</Button>
          )}
          <Button variant="secondary" onClick={onRefresh} disabled={refreshPending} title={refreshPending ? 'Scanning…' : 'Refresh & Scan'}>
            <RefreshIcon /> {refreshPending ? 'Scanning…' : 'Refresh & Scan'}
          </Button>
          <Button variant="secondary" onClick={onManualSearch} disabled={manualSearchPending} title={manualSearchPending ? 'Searching…' : 'Manual Search'}>
            <PersonIcon /> Manual Search
          </Button>
          <Button variant="secondary" onClick={onImportFiles}>Import Files</Button>
          <Button variant="secondary" onClick={onManageIssues}>Manage Issues</Button>
        </div>

        <details className={styles.managementDrawer}>
          <summary>Management actions</summary>
          <div className={styles.actionBtns}>
            <Button variant="secondary" onClick={onEdit} title="Edit">
              <PencilIcon /> Edit
            </Button>
            <Button variant="secondary" onClick={onFixMatch}>Fix Match</Button>
            <Button variant="secondary" onClick={onPreviewRename}>Preview Rename</Button>
            {missingCount === 0 && (
              <Button variant="secondary" onClick={onAutoSearch} disabled={autoSearchPending} title={autoSearchPending ? 'Searching…' : 'Auto Search'}>
                <SearchIcon /> {autoSearchPending ? 'Searching…' : 'Auto Search'}
              </Button>
            )}
          </div>
        </details>

        {volume.description && (
          <div
            className={styles.inlineDescription}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(volume.description) }}
          />
        )}
      </div>
    </div>
  </>;
}
