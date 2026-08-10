import { Link } from '@tanstack/react-router';
import { Badge, Button, Progress } from '@/components/primitives';
import { StatusBanner } from '@/components/patterns';
import { getCoverUrl } from '@/routes/comics/-comics.helpers';
import type { VolumeDetailFull } from '../-volumes.types';
import { sanitizeHtml } from './sanitize';
import { PencilIcon, PersonIcon, RefreshIcon, SearchIcon } from './volume-detail-icons';
import styles from './volume-detail-page.module.css';
interface VolumeHeroProps { volume: VolumeDetailFull; actionMsg: string; progressPct: number; progressTone: 'success' | 'danger'; refreshPending: boolean; autoSearchPending: boolean; manualSearchPending: boolean; onRefresh: () => void; onAutoSearch: () => void; onManualSearch: () => void; onEdit: () => void; onFixMatch: () => void; onPreviewRename: () => void; onManageIssues: () => void; }
export function VolumeHero({ volume, actionMsg, progressPct, progressTone, refreshPending, autoSearchPending, manualSearchPending, onRefresh, onAutoSearch, onManualSearch, onEdit, onFixMatch, onPreviewRename, onManageIssues }: VolumeHeroProps) { return <>
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

      <div className={styles.header} data-testid="volume-hero">
        <img
          className={styles.cover}
          src={getCoverUrl(volume.id)}
          alt={`Cover for ${volume.title}`}
        />

        <div className={styles.info}>
          <h1 className={styles.title}>{volume.title}</h1>

          <div className={styles.metaRow}>
            {volume.year > 0 && <span className={styles.metaItem}>{volume.year}</span>}
            {volume.publisher && <span className={styles.metaItem}>{volume.publisher}</span>}
            {volume.volume_number > 0 && (
              <span className={styles.metaItem}>Vol. {volume.volume_number}</span>
            )}
            {volume.special_version && (
              <Badge tone="info">{volume.special_version}</Badge>
            )}
          </div>

          <div className={styles.progressRow}>
            <Progress value={progressPct} tone={progressTone} />
            <span className={styles.progressText}>
              {volume.issues_downloaded} / {volume.issue_count} issues
            </span>
          </div>

          <div className={styles.statusRow}>
            <Badge tone={volume.monitored ? 'success' : 'neutral'}>
              {volume.monitored ? 'Monitored' : 'Unmonitored'}
            </Badge>
            {volume.root_folder_path && (
              <span className={styles.folderPath}>{volume.root_folder_path}</span>
            )}
          </div>

          <div className={styles.actionBox}>
            <span className={styles.actionBoxTitle}>Actions</span>
            <div className={styles.actionBtns}>
              <Button
                variant="secondary"
                onClick={() => onRefresh()}
                disabled={refreshPending}
                title={refreshPending ? 'Scanning…' : 'Refresh & Scan'}
              >
                <RefreshIcon /> {refreshPending ? 'Scanning…' : 'Refresh & Scan'}
              </Button>
              <Button
                variant={progressPct < 100 ? 'primary' : 'secondary'}
                onClick={() => onAutoSearch()}
                disabled={autoSearchPending}
                title={autoSearchPending ? 'Searching…' : 'Auto Search'}
              >
                <SearchIcon /> {autoSearchPending ? 'Searching…' : 'Auto Search'}
              </Button>
              <Button
                variant="secondary"
                onClick={onManualSearch}
                disabled={manualSearchPending}
                title={manualSearchPending ? 'Searching…' : 'Manual Search'}
              >
                <PersonIcon /> Manual Search
              </Button>
              <Button variant="secondary" onClick={onEdit} title="Edit">
                <PencilIcon /> Edit
              </Button>
              <Button variant="secondary" onClick={onFixMatch}>
                Fix Match
              </Button>
              <Button variant="secondary" onClick={onPreviewRename}>
                Preview Rename
              </Button>
              <Button variant="secondary" onClick={onManageIssues}>
                Manage Issues
              </Button>
            </div>
          </div>

          {volume.description && (
            <div
              className={styles.inlineDescription}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(volume.description) }}
            />
          )}
        </div>
      </div>
</>; }
