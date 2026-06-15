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
  updateVolume,
  fetchRootFolders,
  searchVolumes,
  rematchVolume,
  refreshVolume,
} from '../-volumes.api';
import type {
  IssueDetail,
  ManualSearchResult,
  IssueHistoryEntry,
  ComicVineSearchResult,
} from '../-volumes.types';
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

// ── Constants ───────────────────────────────────────────────────

const SPECIAL_VERSIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: '', label: 'Normal Volume' },
  { value: 'tpb', label: 'Trade Paper Back' },
  { value: 'one-shot', label: 'One Shot' },
  { value: 'hard-cover', label: 'Hard Cover' },
  { value: 'omnibus', label: 'Omnibus' },
  { value: 'volume-as-issue', label: 'Volume As Issue' },
] as const;

const MONITORING_SCHEMES = [
  { value: '', label: "-- Don't apply --" },
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing' },
  { value: 'none', label: 'None' },
] as const;

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

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editMonitored, setEditMonitored] = useState(true);
  const [editMonitorNew, setEditMonitorNew] = useState(true);
  const [editScheme, setEditScheme] = useState('');
  const [editRootFolder, setEditRootFolder] = useState(1);
  const [editVolumeFolder, setEditVolumeFolder] = useState('');
  const [editSpecialVersion, setEditSpecialVersion] = useState('auto');

  // Fix Match dialog
  const [fixMatchOpen, setFixMatchOpen] = useState(false);
  const [fixQuery, setFixQuery] = useState('');
  const [fixSearchResults, setFixSearchResults] = useState<ComicVineSearchResult[]>([]);
  const [fixSearchStatus, setFixSearchStatus] = useState('');
  const [fixSearching, setFixSearching] = useState(false);
  const [fixMatchedTitle, setFixMatchedTitle] = useState('');
  const [fixShowConfirm, setFixShowConfirm] = useState(false);
  const [fixReplacing, setFixReplacing] = useState(false);

  const { data: volume, isLoading, error } = useQuery(volumeDetailFullQueryOptions(id));

  const rootFoldersQuery = useQuery({
    queryKey: ['rootFolders'],
    queryFn: fetchRootFolders,
    staleTime: 60_000,
  });

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

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateVolume(id, data),
    onSuccess: () => {
      setActionMsg('Volume updated.');
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
    },
    onError: (err) => setActionMsg('Update failed: ' + (err as Error).message),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshVolume(id),
    onSuccess: () => setActionMsg('Refresh & Scan started.'),
    onError: (err) => setActionMsg('Refresh failed: ' + (err as Error).message),
  });

  const rematchMutation = useMutation({
    mutationFn: ({
      comicvineId,
      newTitle,
    }: {
      comicvineId: number;
      newTitle: string | null;
    }) => rematchVolume(id, comicvineId, newTitle),
    onSuccess: () => {
      setFixReplacing(true);
      setFixSearchStatus('Rematching… fetching new metadata from ComicVine.');
    },
    onError: (err) => {
      setFixSearchStatus('Rematch failed: ' + (err as Error).message);
      setFixReplacing(false);
    },
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

  const openEdit = useCallback(() => {
    if (!volume) return;
    setEditMonitored(volume.monitored);
    setEditMonitorNew(volume.monitor_new_issues);
    setEditScheme('');
    setEditRootFolder(volume.root_folder);
    setEditVolumeFolder(volume.folder.replace(volume.root_folder_path, '').replace(/^\//, ''));
    setEditSpecialVersion(volume.special_version || 'auto');
    setEditOpen(true);
  }, [volume]);

  const handleEditSave = useCallback(() => {
    const data: Record<string, unknown> = {
      monitored: editMonitored,
      monitor_new_issues: editMonitorNew,
    };
    if (editScheme) {
      data.monitoring_scheme = editScheme;
    }
    data.root_folder = editRootFolder;
    if (editVolumeFolder) {
      data.volume_folder = editVolumeFolder;
    }
    data.special_version = editSpecialVersion;
    updateMutation.mutate(data);
  }, [
    editMonitored,
    editMonitorNew,
    editScheme,
    editRootFolder,
    editVolumeFolder,
    editSpecialVersion,
    updateMutation,
  ]);

  const openFixMatch = useCallback(() => {
    if (!volume) return;
    setFixQuery(volume.title.replace(/\s*\(\d{4}\)\s*$/, '').trim());
    setFixSearchResults([]);
    setFixSearchStatus('');
    setFixShowConfirm(false);
    setFixReplacing(false);
    setFixMatchedTitle('');
    setFixMatchOpen(true);
  }, [volume]);

  const handleFixSearch = useCallback(async () => {
    const q = fixQuery.trim();
    if (!q) return;
    setFixSearching(true);
    setFixSearchStatus('Searching...');
    setFixSearchResults([]);
    try {
      const results = await searchVolumes(q);
      setFixSearchResults(results);
      setFixSearchStatus(results.length > 0 ? '' : 'No results found.');
    } catch {
      setFixSearchStatus('Search failed.');
    } finally {
      setFixSearching(false);
    }
  }, [fixQuery, searchVolumes]);

  const handleFixApply = useCallback(
    (_cvId: number, title: string) => {
      setFixMatchedTitle(title);
      setFixShowConfirm(true);
    },
    [],
  );

  const handleFixConfirm = useCallback(() => {
    const result = fixSearchResults.find(
      (r) => r.title === fixMatchedTitle,
    );
    if (!result) return;
    setFixShowConfirm(false);
    rematchMutation.mutate({
      comicvineId: result.comicvine_id,
      newTitle: result.title,
    });
  }, [fixMatchedTitle, fixSearchResults, rematchMutation]);

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
              variant="secondary"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              Refresh & Scan
            </Button>
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
              disabled={manualSearchVolMutation.isPending}
            >
              Manual Search
            </Button>
            <Button variant="ghost" onClick={openEdit}>
              Edit
            </Button>
            <Button variant="ghost" onClick={openFixMatch}>
              Fix Match
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

      {/* ── Edit Volume Dialog ──────────────────────────────── */}
      <DialogFrame
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) setEditOpen(false);
        }}
      >
        <DialogHeader title="Edit Volume" onClose={() => setEditOpen(false)} />
        <DialogBody>
          <div className={styles.editForm}>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Monitor Volume</span>
              <select
                className={styles.editSelect}
                value={String(editMonitored)}
                onChange={(e) => setEditMonitored(e.target.value === 'true')}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>

            <label className={styles.editField}>
              <span className={styles.editLabel}>Monitor New Issues</span>
              <select
                className={styles.editSelect}
                value={String(editMonitorNew)}
                onChange={(e) => setEditMonitorNew(e.target.value === 'true')}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              <span className={styles.editHint}>
                When new issues come out, automatically monitor them.
              </span>
            </label>

            <label className={styles.editField}>
              <span className={styles.editLabel}>Monitoring Scheme</span>
              <select
                className={styles.editSelect}
                value={editScheme}
                onChange={(e) => setEditScheme(e.target.value)}
              >
                {MONITORING_SCHEMES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <span className={styles.editHint}>
                Apply a monitoring scheme once, on save.
              </span>
            </label>

            <label className={styles.editField}>
              <span className={styles.editLabel}>Root Folder</span>
              <select
                className={styles.editSelect}
                value={editRootFolder}
                onChange={(e) => setEditRootFolder(Number(e.target.value))}
              >
                {(rootFoldersQuery.data ?? []).map((rf) => (
                  <option key={rf.id} value={rf.id}>
                    {rf.folder}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.editField}>
              <span className={styles.editLabel}>Volume Folder</span>
              <input
                className={styles.editInput}
                type="text"
                value={editVolumeFolder}
                onChange={(e) => setEditVolumeFolder(e.target.value)}
              />
              <span className={styles.editHint}>
                Make empty to generate the default folder.
              </span>
            </label>

            <label className={styles.editField}>
              <span className={styles.editLabel}>Special Version</span>
              <select
                className={styles.editSelect}
                value={editSpecialVersion}
                onChange={(e) => setEditSpecialVersion(e.target.value)}
              >
                {SPECIAL_VERSIONS.map((sv) => (
                  <option key={sv.value} value={sv.value}>
                    {sv.label}
                  </option>
                ))}
              </select>
              <span className={styles.editHint}>Type of volume.</span>
            </label>

            <div className={styles.editActions}>
              <Button
                variant="primary"
                onClick={handleEditSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving…' : 'Update'}
              </Button>
              <Button variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogFrame>

      {/* ── Fix Match Dialog ────────────────────────────────── */}
      <DialogFrame
        open={fixMatchOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFixMatchOpen(false);
            setFixShowConfirm(false);
            setFixReplacing(false);
          }
        }}
      >
        <DialogHeader title="Fix Match" onClose={() => setFixMatchOpen(false)} />
        <DialogBody>
          {fixReplacing ? (
            <p className={styles.dialogStatus}>
              {fixSearchStatus}
            </p>
          ) : fixShowConfirm ? (
            <div>
              <p className={styles.confirmText}>
                Re-match this volume to <strong>{fixMatchedTitle}</strong>?
                <br />
                All existing issues will be deleted and re-fetched.
              </p>
              <div className={styles.editActions}>
                <Button
                  variant="primary"
                  onClick={handleFixConfirm}
                  disabled={rematchMutation.isPending}
                >
                  {rematchMutation.isPending ? 'Rematching…' : 'Confirm'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setFixShowConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className={styles.fixSearchBar}>
                <input
                  type="text"
                  className={styles.fixSearchInput}
                  placeholder="Search ComicVine…"
                  value={fixQuery}
                  onChange={(e) => setFixQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFixSearch();
                  }}
                />
                <Button
                  variant="primary"
                  onClick={handleFixSearch}
                  disabled={fixSearching || !fixQuery.trim()}
                >
                  {fixSearching ? '…' : 'Search'}
                </Button>
              </div>

              {fixSearchStatus && (
                <p className={styles.dialogStatus}>{fixSearchStatus}</p>
              )}

              {fixSearchResults.length > 0 && (
                <table className={styles.fixMatchTable}>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th className={styles.thFixYear}>Year</th>
                      <th className={styles.thFixIssues}>Issues</th>
                      <th>Publisher</th>
                      <th>Type</th>
                      <th className={styles.thFixAction}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixSearchResults.map((result, i) => (
                      <tr key={i}>
                        <td className={styles.fixTitle}>{result.title}</td>
                        <td className={styles.fixCell}>{result.year ?? '—'}</td>
                        <td className={styles.fixCell}>{result.issue_count}</td>
                        <td className={styles.fixCell}>{result.publisher ?? '—'}</td>
                        <td className={styles.fixCell}>
                          {result.special_version || 'Normal'}
                        </td>
                        <td>
                          <Button
                            variant="primary"
                            onClick={() =>
                              handleFixApply(result.comicvine_id, result.title)
                            }
                          >
                            Select
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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
