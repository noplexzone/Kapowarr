import { Link } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const releasedTotal = volume.released_issue_count ?? volume.issue_count ?? 0;
  const releasedDownloaded = volume.released_issues_downloaded ?? volume.issues_downloaded ?? 0;
  const aggregateMissing = Math.max(0, releasedTotal - releasedDownloaded);
  const detailedMissing = volume.issues.filter((issue) => {
    if (!issue.monitored || issue.downloaded || !issue.release_date) return false;
    return issue.release_date <= new Date().toISOString().slice(0, 10);
  }).length;
  return Math.max(aggregateMissing, detailedMissing);
}

function publisherThemeName(publisher: string): string {
  const normalized = publisher.toLowerCase();
  if (normalized.includes('marvel')) return 'marvel';
  if (normalized.includes('dc')) return 'dc';
  if (normalized.includes('image')) return 'image';
  if (normalized.includes('dark horse')) return 'darkHorse';
  if (normalized.includes('viz')) return 'viz';
  return 'kapowarr';
}

function ClampedDescription({ html, volumeId }: { html: string; volumeId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = `volume-description-${volumeId}`;
  useEffect(() => setExpanded(false), [volumeId]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setOverflowing(node.scrollHeight > node.clientHeight + 1);
  }, [html, expanded]);
  return (
    <div className={styles.descriptionClampWrap}>
      <div
        id={id}
        ref={ref}
        className={`${styles.inlineDescription}${expanded ? ` ${styles.descriptionExpanded}` : ''}`}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
      {(overflowing || expanded) && (
        <Button
          variant="ghost"
          className={styles.readMoreButton}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Read more'}
        </Button>
      )}
    </div>
  );
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
  const completion = volume.completion_percentage ?? (volume.issue_count > 0 ? (volume.issues_downloaded / volume.issue_count) * 100 : null);
  const releasedTotal = volume.released_issue_count ?? volume.issue_count ?? 0;
  const releasedDownloaded = volume.released_issues_downloaded ?? volume.issues_downloaded ?? 0;
  const upcoming = volume.upcoming_issue_count ?? 0;
  const isComplete = missingCount === 0 && completion != null && completion >= 100;
  const themeName = publisherThemeName(volume.publisher);
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

    <div className={styles.mediaHero} data-testid="volume-hero" data-publisher-theme={themeName}>
      <div className={styles.publisherBackdrop} aria-hidden="true">
        <span>{volume.publisher || 'Kapowarr'}</span>
      </div>
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
            <span className={styles.detailStatValue}>{releasedDownloaded}</span>
            <span className={styles.detailStatLabel}>Released downloaded</span>
          </div>
          <div className={styles.detailStat}>
            <span className={styles.detailStatValue}>{missingCount}</span>
            <span className={styles.detailStatLabel}>Missing</span>
          </div>
          <div className={styles.detailStat}>
            <span className={styles.detailStatValue}>{releasedTotal}</span>
            <span className={styles.detailStatLabel}>Released issues</span>
          </div>
        </div>

        <div className={styles.progressRow}>
          <Progress value={progressPct} tone={progressTone} />
          <span className={styles.progressText}>{releasedDownloaded} of {releasedTotal} released{upcoming > 0 ? ` · ${upcoming} upcoming` : ''}</span>
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

        {volume.description && <ClampedDescription html={volume.description} volumeId={volume.id} />}
      </div>
    </div>
  </>;
}
