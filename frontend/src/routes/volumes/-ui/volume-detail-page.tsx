import { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Progress } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import { getCoverUrl } from '@/routes/comics/-comics.helpers';
import {
  volumeDetailFullQueryOptions,
  VOLUME_FULL_KEY,
  deleteVolume,
  autoSearchVolume,
  manualSearchVolume,
  autoSearchIssue,
  manualSearchIssue,
  fetchIssueHistory,
  downloadIssue,
  addToBlocklist,
} from '../-volumes.api';
import type { IssueDetail, ManualSearchResult, IssueHistoryEntry } from '../-volumes.types';
import { sanitizeHtml } from './sanitize';
import styles from './volume-detail-page.module.css';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDownloadTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 5);
}

export function VolumeDetailPage() {
  const { volumeId } = useParams({ strict: false }) as { volumeId: string };
  const id = parseInt(volumeId ?? '0', 10);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [descExpanded, setDescExpanded] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  // Manual search dialog
  const [manualSearchIssueId, setManualSearchIssueId] = useState<number | null>(null);
  const [manualResults, setManualResults] = useState<ManualSearchResult[]>([]);
  const [manualSearching, setManualSearching] = useState(false);

  // Issue history dialog
  const [historyIssueId, setHistoryIssueId] = useState<number | null>(null);
  const [historyEntries, setHistoryEntries] = useState<IssueHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const { data: volume, isLoading, error } = useQuery(volumeDetailFullQueryOptions(id));

  const deleteMutation = useMutation({
    mutationFn: () => deleteVolume(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: VOLUME_FULL_KEY(id) });
      queryClient.invalidateQueries({ queryKey: ['volumes', 'list'] });
      navigate({ to: '/comics' });
    },
  });

  const autoSearchMutation = useMutation({
    mutationFn: () => autoSearchVolume(id),
    onSuccess: () => setActionMsg('Auto search started.'),
  });

  const manualSearchVolMutation = useMutation({
    mutationFn: () => manualSearchVolume(id),
    onSuccess: () => setActionMsg('Manual search started.'),
  });

  const autoSearchIssueMutation = useMutation({
    mutationFn: ({ volumeId, issueId }: { volumeId: number; issueId: number }) =>
      autoSearchIssue(volumeId, issueId),
    onSuccess: () => setActionMsg('Issue auto search started.'),
    onError: (err) => setActionMsg('Auto search failed: ' + (err as Error).message),
  });

  const downloadIssueMutation = useMutation({
    mutationFn: ({
      issueId,
      link,
      forceMatch,
      displayTitle,
    }: {
      issueId: number;
      link: string;
      forceMatch: boolean;
      displayTitle: string;
    }) => downloadIssue(issueId, link, forceMatch, displayTitle),
    onSuccess: () => setActionMsg('Download queued.'),
    onError: (err) => setActionMsg('Download failed: ' + (err as Error).message),
  });

  const blocklistMutation = useMutation({
    mutationFn: ({
      link,
      displayTitle,
    }: {
      link: string;
      displayTitle: string;
    }) => addToBlocklist(link, displayTitle, id, manualSearchIssueId),
    onSuccess: () => setActionMsg('Added to blocklist.'),
  });

  const handleManualSearch = useCallback(async (issueId: number) => {
    setManualSearchIssueId(issueId);
    setManualSearching(true);
    setManualResults([]);
    try {
      const results = await manualSearchIssue(issueId);
      setManualResults(results);
    } catch {
      setManualResults([]);
    } finally {
      setManualSearching(false);
    }
  }, []);

  const closeManualSearch = useCallback(() => {
    setManualSearchIssueId(null);
    setManualResults([]);
  }, []);

  const handleShowHistory = useCallback(async (issueId: number) => {
    setHistoryIssueId(issueId);
    setHistoryLoading(true);
    setHistoryEntries([]);
    try {
      const entries = await fetchIssueHistory(issueId);
      setHistoryEntries(entries);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryIssueId(null);
    setHistoryEntries([]);
  }, []);

  if (isLoading) {
    return <div className={styles.loading}>Loading volume…</div>;
  }

  if (error || !volume) {
    return (
      <div className={styles.errorPage}>
        <p className={styles.errorMsg}>Volume not found or failed to load.</p>
        <Link to="/comics" className={styles.backLink}>
          ← Back to Comics
        </Link>
      </div>
    );
  }

  const progressPct =
    volume.issue_count > 0
      ? Math.round((volume.issues_downloaded / volume.issue_count) * 100)
      : 0;
  const progressTone = progressPct >= 100 ? 'success' : 'danger';

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link to="/comics" className={styles.breadcrumbLink}>
          Comics
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{volume.title}</span>
      </nav>

      {actionMsg && (
        <div className={styles.actionMsg}>{actionMsg}</div>
      )}

      <div className={styles.header}>
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

          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => autoSearchMutation.mutate()}
              disabled={autoSearchMutation.isPending}
            >
              Auto Search
            </Button>
            <Button
              variant="secondary"
              onClick={() => manualSearchVolMutation.mutate()}
              disabled={manualSearchVolMutation.isPending || manualResults.length > 0}
            >
              Manual Search
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm(`Delete "${volume.title}"? This cannot be undone.`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      {volume.description && (
        <section className={styles.section}>
          <button
            className={styles.sectionToggle}
            onClick={() => setDescExpanded((e) => !e)}
            type="button"
          >
            <span>Description</span>
            <span className={styles.toggleIcon}>{descExpanded ? '▲' : '▼'}</span>
          </button>
          {descExpanded && (
            <div
              className={styles.description}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(volume.description) }}
            />
          )}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Issues ({volume.issues.length})
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thNum}>#</th>
                <th>Title</th>
                <th className={styles.thDate}>Release Date</th>
                <th className={styles.thStatus}>Status</th>
                <th className={styles.thSize}>Size</th>
                <th className={styles.thActions}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {volume.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  volumeId={id}
                  onAutoSearch={() =>
                    autoSearchIssueMutation.mutate({ volumeId: id, issueId: issue.id })
                  }
                  onManualSearch={() => handleManualSearch(issue.id)}
                  onHistory={() => handleShowHistory(issue.id)}
                  isAutoSearching={
                    autoSearchIssueMutation.isPending &&
                    autoSearchIssueMutation.variables?.issueId === issue.id
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Manual Search Dialog ────────────────────────────── */}
      <DialogFrame
        open={manualSearchIssueId !== null}
        onOpenChange={(open) => {
          if (!open) closeManualSearch();
        }}
      >
        <DialogHeader
          title={
            manualSearching
              ? 'Searching…'
              : `Manual Search — Issue #${manualSearchIssueId ?? ''}`
          }
          onClose={closeManualSearch}
        />
        <DialogBody>
          {manualSearching && (
            <p className={styles.dialogStatus}>Searching for downloads…</p>
          )}
          {!manualSearching && manualResults.length === 0 && (
            <p className={styles.dialogStatus}>No results found.</p>
          )}
          {!manualSearching && manualResults.length > 0 && (
            <table className={styles.searchResultTable}>
              <thead>
                <tr>
                  <th className={styles.thMatch}>Match</th>
                  <th>Title</th>
                  <th className={styles.thSource}>Source</th>
                  <th className={styles.thAction}>Action</th>
                </tr>
              </thead>
              <tbody>
                {manualResults.map((result, i) => (
                  <tr key={i}>
                    <td>
                      <Badge tone={result.match ? 'success' : 'neutral'}>
                        {result.match ? 'Match' : result.match_issue || 'No match'}
                      </Badge>
                    </td>
                    <td>
                      <a
                        href={result.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.resultTitle}
                      >
                        {result.display_title}
                      </a>
                    </td>
                    <td className={styles.sourceCell}>{result.source}</td>
                    <td className={styles.actionCell}>
                      <Button
                        variant="primary"
                        disabled={
                          downloadIssueMutation.isPending &&
                          downloadIssueMutation.variables?.link === result.link
                        }
                        onClick={() =>
                          downloadIssueMutation.mutate({
                            issueId: manualSearchIssueId!,
                            link: result.link,
                            forceMatch: false,
                            displayTitle: result.display_title,
                          })
                        }
                      >
                        Download
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={
                          downloadIssueMutation.isPending &&
                          downloadIssueMutation.variables?.link === result.link
                        }
                        onClick={() =>
                          downloadIssueMutation.mutate({
                            issueId: manualSearchIssueId!,
                            link: result.link,
                            forceMatch: true,
                            displayTitle: result.display_title,
                          })
                        }
                      >
                        Force
                      </Button>
                      {result.match_issue !== null &&
                        !result.match_issue.includes('blocklist') && (
                          <Button
                            variant="ghost"
                            disabled={blocklistMutation.isPending}
                            onClick={() =>
                              blocklistMutation.mutate({
                                link: result.link,
                                displayTitle: result.display_title,
                              })
                            }
                          >
                            Block
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogBody>
      </DialogFrame>

      {/* ── Issue History Dialog ────────────────────────────── */}
      <DialogFrame
        open={historyIssueId !== null}
        onOpenChange={(open) => {
          if (!open) closeHistory();
        }}
      >
        <DialogHeader
          title={
            historyLoading
              ? 'Loading history…'
              : `Issue History — #${historyIssueId ?? ''}`
          }
          onClose={closeHistory}
        />
        <DialogBody>
          {historyLoading && (
            <p className={styles.dialogStatus}>Loading history…</p>
          )}
          {!historyLoading && historyEntries.length === 0 && (
            <p className={styles.dialogStatus}>No history for this issue.</p>
          )}
          {!historyLoading && historyEntries.length > 0 && (
            <table className={styles.historyTable}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Title</th>
                  <th className={styles.thDate}>Downloaded</th>
                  <th className={styles.thStatus}>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyEntries.map((entry, i) => {
                  const displayTitle =
                    entry.web_title ||
                    entry.file_title ||
                    entry.web_sub_title ||
                    entry.source ||
                    'Unknown';
                  return (
                    <tr key={i}>
                      <td className={styles.sourceCell}>
                        {entry.source_name || entry.source || ''}
                      </td>
                      <td>
                        {entry.web_link ? (
                          <a
                            href={entry.web_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.resultTitle}
                          >
                            {displayTitle}
                          </a>
                        ) : (
                          displayTitle
                        )}
                      </td>
                      <td className={styles.dateCell}>
                        {entry.downloaded_at
                          ? formatDownloadTime(entry.downloaded_at)
                          : '—'}
                      </td>
                      <td>
                        <Badge
                          tone={
                            entry.success === true
                              ? 'success'
                              : entry.success === false
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {entry.success === true
                            ? 'Success'
                            : entry.success === false
                              ? 'Failed'
                              : ''}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </DialogBody>
      </DialogFrame>
    </div>
  );
}

// ── Issue Row Sub-component ─────────────────────────────────────

interface IssueRowProps {
  issue: IssueDetail;
  volumeId: number;
  onAutoSearch: () => void;
  onManualSearch: () => void;
  onHistory: () => void;
  isAutoSearching: boolean;
}

function IssueRow({
  issue,
  onAutoSearch,
  onManualSearch,
  onHistory,
  isAutoSearching,
}: IssueRowProps) {
  return (
    <tr className={styles.issueRow}>
      <td className={styles.issueNum}>#{issue.issue_number}</td>
      <td className={styles.issueTitle}>{issue.title || '—'}</td>
      <td className={styles.issueDate}>{issue.release_date || '—'}</td>
      <td>
        <Badge
          tone={
            issue.downloaded
              ? 'success'
              : issue.monitored
                ? 'warning'
                : 'neutral'
          }
        >
          {issue.downloaded
            ? 'Downloaded'
            : issue.monitored
              ? 'Wanted'
              : 'Unmonitored'}
        </Badge>
      </td>
      <td className={styles.issueSize}>
        {issue.size > 0 ? formatFileSize(issue.size) : '—'}
      </td>
      <td className={styles.actionsCell}>
        <div className={styles.issueActions}>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="Auto search for this issue"
            aria-label="Auto search for this issue"
            disabled={isAutoSearching}
            onClick={onAutoSearch}
          >
            {isAutoSearching ? '…' : '🔍'}
          </button>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="Manually search for this issue"
            aria-label="Manually search for this issue"
            onClick={onManualSearch}
          >
            🔎
          </button>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="View history for this issue"
            aria-label="View history for this issue"
            onClick={onHistory}
          >
            🕐
          </button>
        </div>
      </td>
    </tr>
  );
}
