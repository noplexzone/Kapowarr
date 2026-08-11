import { useState, useCallback, useRef } from 'react';
import { useSocketEvent } from '@/platform/socketio/socket';
import type { QueueEntry } from '@/routes/activity/queue/-queue.types';
import { useParams, useNavigate, useLocation, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthenticatedImage } from '@/components/authenticated-resource';
import { Badge, Button } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import {
  volumeDetailFullQueryOptions,
  VOLUME_FULL_KEY,
  deleteVolume,
  autoSearchVolume,
  manualSearchVolume,
  autoSearchIssue,
  manualSearchIssue,
  fetchIssueHistory,
  volumeHistoryQueryOptions,
  downloadIssue,
  downloadVolume,
  addToBlocklist,
  updateVolume,
  fetchRootFolders,
  searchVolumes,
  rematchVolume,
  refreshVolume,
  fetchRenamePreview,
  submitRename,
  forceMatchIssue,
  fetchManualMatch,
  submitManualMatch,
  deleteFile,
  deleteRawFile,
  fetchCoverOptions,
  addCoverPage,
  manualSuwayomiBundleSearch,
} from '../-volumes.api';
import type {
  IssueDetail,
  ManualSearchResult,
  IssueHistoryEntry,
  ComicVineSearchResult,
  RenameEntry,
  FileMatch,
  CoverCandidate,
  AddCoverResult,
  GeneralFileDetail,
} from '../-volumes.types';
import { VolumeHero } from './volume-hero';
import { IssuesSection } from './issues-section';
import { IssueHistoryDialog } from './issue-history-dialog';
import { ManageIssuesDialog, selectedIssueFileIds } from './manage-issues-dialog';
import styles from './volume-detail-page.module.css';

function getCoverPreviewEndpoint(candidate: CoverCandidate): string {
  return `mangadex/cover-proxy?url=${encodeURIComponent(candidate.thumbnail_url)}`;
}


function formatIssueSearchTitle(volumeTitle: string, issue?: IssueDetail): string {
  if (!issue) return volumeTitle;
  const issueNumber = issue.issue_number ? ` #${issue.issue_number}` : '';
  const issueTitle = issue.title ? ` — ${issue.title}` : '';
  return `${volumeTitle}${issueNumber}${issueTitle}`;
}

function VolumeFilesPanel({ issues, generalFiles }: { issues: IssueDetail[]; generalFiles: GeneralFileDetail[] }) {
  const issueFiles = issues.flatMap((issue) => issue.filenames.map((filename, index) => ({
    id: `issue:${issue.file_ids[index] ?? `${issue.id}:${index}`}`,
    filename,
    association: `Issue #${issue.issue_number}${issue.title ? ` — ${issue.title}` : ''}`,
  })));
  const files = [
    ...issueFiles,
    ...generalFiles.map((file) => ({
      id: `general:${file.id}`,
      filename: file.filename,
      association: `Volume file — ${file.file_type}`,
    })),
  ];
  if (files.length === 0) return <p>No files are attached to this volume.</p>;
  return <table className={styles.searchResultTable}>
    <thead><tr><th>File</th><th>Association</th></tr></thead>
    <tbody>{files.map((file) => <tr key={file.id}>
      <td>{file.filename}</td>
      <td>{file.association}</td>
    </tr>)}</tbody>
  </table>;
}

function VolumeHistoryPanel({ entries, issues, loading, error }: {
  entries: IssueHistoryEntry[];
  issues: IssueDetail[];
  loading: boolean;
  error: Error | null;
}) {
  if (loading) return <p role="status">Loading volume history…</p>;
  if (error) return <p role="alert">Unable to load volume history.</p>;
  if (entries.length === 0) return <p>No download history is recorded for this volume.</p>;
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  return <table className={styles.searchResultTable}>
    <thead><tr><th>Release</th><th>Issue</th><th>Source</th><th>Status</th></tr></thead>
    <tbody>{entries.map((entry, index) => {
      const issue = entry.issue_id == null ? undefined : issueById.get(entry.issue_id);
      const status = entry.success === true ? 'Downloaded' : entry.success === false ? 'Failed' : 'Pending';
      return <tr key={`${entry.web_link}:${entry.downloaded_at ?? index}`}>
        <td>{entry.web_title || entry.file_title || 'Untitled release'}</td>
        <td>{issue ? `#${issue.issue_number}${issue.title ? ` — ${issue.title}` : ''}` : 'Volume-wide'}</td>
        <td>{entry.source_name || entry.source || 'Unknown'}</td>
        <td>{status}</td>
      </tr>;
    })}</tbody>
  </table>;
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
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [actionMsg, setActionMsg] = useState('');
  const [queueEntries, setQueueEntries] = useState<Map<number, QueueEntry>>(new Map());

  // Issue manual search dialog
  const [manualSearchIssueId, setManualSearchIssueId] = useState<number | null>(null);
  const [manualResults, setManualResults] = useState<ManualSearchResult[]>([]);
  const [manualSearching, setManualSearching] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualSearchError, setManualSearchError] = useState('');

  // Volume-level manual search dialog
  const [volManualOpen, setVolManualOpen] = useState(false);
  const [volManualResults, setVolManualResults] = useState<ManualSearchResult[]>([]);
  const [volManualSearching, setVolManualSearching] = useState(false);
  const [volManualQuery, setVolManualQuery] = useState('');
  const [volManualSearchError, setVolManualSearchError] = useState('');
  const [manualDownloadError, setManualDownloadError] = useState('');
  const manualSearchRequestSeq = useRef(0);
  const volManualSearchRequestSeq = useRef(0);

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

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameEntries, setRenameEntries] = useState<RenameEntry[]>([]);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameChecked, setRenameChecked] = useState<Set<string>>(new Set());
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  // Manage Issues dialog
  const [manageIssuesOpen, setManageIssuesOpen] = useState(false);
  const [manageChecked, setManageChecked] = useState<Set<number>>(new Set());
  const [manageDeleting, setManageDeleting] = useState(false);
  const [manageForceMatching, setManageForceMatching] = useState(false);
  const [manualMatches, setManualMatches] = useState<FileMatch[]>([]);
  const [unmatchedFiles, setUnmatchedFiles] = useState<FileMatch[]>([]);
  const [forceMatchTargets, setForceMatchTargets] = useState<
    Record<string, number>
  >({});
  const [deleteVolumeFolder, setDeleteVolumeFolder] = useState(false);
  const [manageLoading, setManageLoading] = useState(false);
  const [unmatchedChecked, setUnmatchedChecked] = useState<Set<string>>(new Set());
  const [unmatchedDeleting, setUnmatchedDeleting] = useState(false);

  // Add Cover dialog
  const [coverDialog, setCoverDialog] = useState<{
    fileId: number;
    issueId: number;
    filename: string;
  } | null>(null);
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverApplyingUrl, setCoverApplyingUrl] = useState<string | null>(null);
  const [coverApplyResult, setCoverApplyResult] = useState<AddCoverResult | null>(null);

  // Suwayomi manual bundle state (shown inside the manual search dialog)
  const [swBundleInput, setSwBundleInput] = useState('');
  const [swBundleResults, setSwBundleResults] = useState<ManualSearchResult[]>([]);
  const [swBundleSearching, setSwBundleSearching] = useState(false);
  const [swBundleError, setSwBundleError] = useState('');
  const swBundleRequestSeq = useRef(0);

  const { data: volume, isLoading, error } = useQuery(volumeDetailFullQueryOptions(id));
  const historyTabActive = pathname.endsWith('/history');
  const volumeHistoryQuery = useQuery({
    ...volumeHistoryQueryOptions(id),
    enabled: id > 0 && historyTabActive,
  });

  // Track active downloads for this volume
  useSocketEvent<Partial<QueueEntry> & { id: number }>('queue_added', useCallback((data) => {
    const issueId = data.issue_id;
    if (data.volume_id === id && issueId != null) {
      setQueueEntries(prev => {
        const next = new Map(prev);
        next.set(issueId, { ...data } as QueueEntry);
        return next;
      });
    }
  }, [id]));

  useSocketEvent<Partial<QueueEntry> & { id: number }>('queue_status', useCallback((data) => {
    const issueId = data.issue_id;
    if (data.volume_id === id && issueId != null) {
      setQueueEntries(prev => {
        const next = new Map(prev);
        const existing = next.get(issueId);
        next.set(issueId, { ...existing, ...data } as QueueEntry);
        return next;
      });
    }
  }, [id]));

  useSocketEvent<{ id: number }>('queue_ended', useCallback((data) => {
    setQueueEntries(prev => {
      const next = new Map(prev);
      for (const [issueId, entry] of next) {
        if (entry.id === data.id) {
          next.delete(issueId);
          break;
        }
      }
      return next;
    });
  }, []));

  const rootFoldersQuery = useQuery({
    queryKey: ['rootFolders'],
    queryFn: fetchRootFolders,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteVolume(id, deleteVolumeFolder),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: VOLUME_FULL_KEY(id) });
      queryClient.invalidateQueries({ queryKey: ['volumes', 'list'] });
      navigate({
        to: '/library',
        search: { section: volume?.section === 'manga' ? 'manga' : 'comic' },
      });
    },
  });

  const autoSearchMutation = useMutation({
    mutationFn: () => autoSearchVolume(id),
    onSuccess: () => setActionMsg('Auto search started.'),
  });

  const runVolumeManualSearch = useCallback(async (query?: string) => {
    const requestSeq = volManualSearchRequestSeq.current + 1;
    volManualSearchRequestSeq.current = requestSeq;
    setVolManualSearching(true);
    setVolManualResults([]);
    setVolManualSearchError('');
    setManualDownloadError('');
    try {
      const data = await manualSearchVolume(id, query);
      if (volManualSearchRequestSeq.current !== requestSeq) return;
      setVolManualResults(data);
      if (data.length === 0) {
        setActionMsg('Manual search returned no results.');
      }
    } catch (err) {
      if (volManualSearchRequestSeq.current !== requestSeq) return;
      setVolManualSearchError('Manual search failed: ' + (err as Error).message);
    } finally {
      if (volManualSearchRequestSeq.current === requestSeq) {
        setVolManualSearching(false);
      }
    }
  }, [id]);

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
    onSuccess: (data) => {
      if (data.fail_reason) {
        const message = 'Download failed: ' + data.fail_reason;
        setActionMsg(message);
        setManualDownloadError(message);
        return;
      }
      setManualDownloadError('');
      setActionMsg('Download queued.');
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
    },
    onError: (err) => {
      const message = 'Download failed: ' + (err as Error).message;
      setActionMsg(message);
      setManualDownloadError(message);
    },
  });

  const downloadVolumeMutation = useMutation({
    mutationFn: ({
      link,
      displayTitle,
      forceMatch,
    }: {
      link: string;
      displayTitle: string;
      forceMatch: boolean;
    }) => downloadVolume(id, link, displayTitle, forceMatch),
    onSuccess: (data) => {
      if (data.fail_reason) {
        const message = 'Download failed: ' + data.fail_reason;
        setActionMsg(message);
        setManualDownloadError(message);
        return;
      }
      setManualDownloadError('');
      setActionMsg('Download queued.');
    },
    onError: (err) => {
      const message = 'Download failed: ' + (err as Error).message;
      setActionMsg(message);
      setManualDownloadError(message);
    },
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
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
    },
    onError: (err) => {
      setFixSearchStatus('Rematch failed: ' + (err as Error).message);
      setFixReplacing(false);
    },
  });

  const runIssueManualSearch = useCallback(async (
    issueId: number,
    query?: string,
  ) => {
    const requestSeq = manualSearchRequestSeq.current + 1;
    manualSearchRequestSeq.current = requestSeq;
    setManualSearching(true);
    setManualResults([]);
    setManualSearchError('');
    setManualDownloadError('');
    try {
      const results = await manualSearchIssue(issueId, query);
      if (manualSearchRequestSeq.current === requestSeq) {
        setManualResults(results);
      }
    } catch (err) {
      if (manualSearchRequestSeq.current === requestSeq) {
        setManualResults([]);
        setManualSearchError('Manual search failed: ' + (err as Error).message);
      }
    } finally {
      if (manualSearchRequestSeq.current === requestSeq) {
        setManualSearching(false);
      }
    }
  }, []);

  const handleManualSearch = useCallback((issueId: number) => {
    setManualSearchIssueId(issueId);
    setManualQuery('');
    swBundleRequestSeq.current += 1;
    setSwBundleInput('');
    setSwBundleResults([]);
    setSwBundleSearching(false);
    setSwBundleError('');
    void runIssueManualSearch(issueId);
  }, [runIssueManualSearch]);

  const rerunIssueManualSearch = useCallback(() => {
    if (manualSearchIssueId === null) return;
    void runIssueManualSearch(manualSearchIssueId, manualQuery);
  }, [manualQuery, manualSearchIssueId, runIssueManualSearch]);

  const handleVolumeManualSearch = useCallback(() => {
    setVolManualOpen(true);
    setVolManualQuery('');
    void runVolumeManualSearch();
  }, [runVolumeManualSearch]);

  const rerunVolumeManualSearch = useCallback(() => {
    void runVolumeManualSearch(volManualQuery);
  }, [runVolumeManualSearch, volManualQuery]);

  const closeManualSearch = useCallback(() => {
    manualSearchRequestSeq.current += 1;
    swBundleRequestSeq.current += 1;
    setManualSearchIssueId(null);
    setManualResults([]);
    setManualSearching(false);
    setManualQuery('');
    setManualSearchError('');
    setManualDownloadError('');
    setSwBundleInput('');
    setSwBundleResults([]);
    setSwBundleSearching(false);
    setSwBundleError('');
  }, []);

  const closeVolumeManualSearch = useCallback(() => {
    volManualSearchRequestSeq.current += 1;
    setVolManualOpen(false);
    setVolManualResults([]);
    setVolManualSearching(false);
    setVolManualQuery('');
    setVolManualSearchError('');
    setManualDownloadError('');
  }, []);

  const doSuwayomiBundleSearch = useCallback(async () => {
    if (manualSearchIssueId === null || !swBundleInput.trim()) return;
    const requestSeq = swBundleRequestSeq.current + 1;
    swBundleRequestSeq.current = requestSeq;
    const issueId = manualSearchIssueId;
    setSwBundleSearching(true);
    setSwBundleResults([]);
    setSwBundleError('');
    try {
      const results = await manualSuwayomiBundleSearch(
        issueId,
        swBundleInput.trim(),
      );
      if (swBundleRequestSeq.current !== requestSeq) return;
      setSwBundleResults(results);
      if (results.length === 0) {
        setSwBundleError(
          'No Suwayomi source found with all requested chapters.',
        );
      }
    } catch (err) {
      if (swBundleRequestSeq.current !== requestSeq) return;
      setSwBundleError('Search failed: ' + (err as Error).message);
    } finally {
      if (swBundleRequestSeq.current === requestSeq) {
        setSwBundleSearching(false);
      }
    }
  }, [manualSearchIssueId, swBundleInput]);

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

  const handleOpenRename = useCallback(async () => {
    setRenameOpen(true);
    setRenameLoading(true);
    setRenameEntries([]);
    setRenameChecked(new Set());
    try {
      const entries = await fetchRenamePreview(id);
      setRenameEntries(entries);
      setRenameChecked(new Set(entries.map(e => e.before)));
    } catch {
      setRenameEntries([]);
    } finally {
      setRenameLoading(false);
    }
  }, [id]);

  const closeRename = useCallback(() => {
    setRenameOpen(false);
    setRenameEntries([]);
    setRenameChecked(new Set());
  }, []);

  const toggleRenameCheck = useCallback((filepath: string) => {
    setRenameChecked(prev => {
      const next = new Set(prev);
      if (next.has(filepath)) next.delete(filepath);
      else next.add(filepath);
      return next;
    });
  }, []);

  const toggleAllRenames = useCallback((checked: boolean) => {
    if (checked) {
      setRenameChecked(new Set(renameEntries.map(e => e.before)));
    } else {
      setRenameChecked(new Set());
    }
  }, [renameEntries]);

  const handleSubmitRename = useCallback(async () => {
    const filepaths = [...renameChecked];
    if (!filepaths.length) return;
    setRenameSubmitting(true);
    try {
      await submitRename(id, filepaths);
      setActionMsg('Rename queued.');
      closeRename();
    } catch (err) {
      setActionMsg('Rename failed: ' + (err as Error).message);
    } finally {
      setRenameSubmitting(false);
    }
  }, [id, renameChecked, closeRename]);

  const openManageIssues = useCallback(async () => {
    setManageChecked(new Set());
    setManageDeleting(false);
    setManageForceMatching(false);
    setForceMatchTargets({});
    setUnmatchedChecked(new Set());
    setUnmatchedDeleting(false);
    setManageIssuesOpen(true);
    setManageLoading(true);
    try {
      const matches = await fetchManualMatch(id);
      setManualMatches(matches);
      setUnmatchedFiles(
        matches.filter(
          (m) => m.issue_ids.length === 0 && !m.general_file,
        ),
      );
    } catch {
      setManualMatches([]);
      setUnmatchedFiles([]);
    } finally {
      setManageLoading(false);
    }
  }, [id]);

  const closeManageIssues = useCallback(() => {
    setManageIssuesOpen(false);
    setManageChecked(new Set());
  }, []);

  const toggleManageCheck = useCallback((issueId: number) => {
    setManageChecked(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const toggleAllManage = useCallback((checked: boolean, allIds: number[]) => {
    if (checked) {
      setManageChecked(new Set(allIds));
    } else {
      setManageChecked(new Set());
    }
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (manageChecked.size === 0) return;
    setManageDeleting(true);
    const checkedIds = [...manageChecked];
    const issues = volume?.issues ?? [];
    const fileIds = selectedIssueFileIds(issues, manageChecked);
    if (fileIds.length === 0) {
      setActionMsg('No files to delete for selected issues.');
      setManageDeleting(false);
      return;
    }
    if (!window.confirm(`Delete ${fileIds.length} file(s) for ${checkedIds.length} issue(s)?`)) {
      setManageDeleting(false);
      return;
    }
    try {
      let deleted = 0;
      for (const fileId of fileIds) {
        try {
          await deleteFile(fileId);
          deleted++;
        } catch (e) {
          // Continue deleting other files
        }
      }
      setActionMsg(`Deleted ${deleted} file(s) for ${checkedIds.length} issue(s).`);
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
      setManageChecked(new Set());
      // Refresh manual match data
      const matches = await fetchManualMatch(id);
      setManualMatches(matches);
      setUnmatchedFiles(
        matches.filter((m) => m.issue_ids.length === 0 && !m.general_file),
      );
    } catch (err) {
      setActionMsg('Delete failed: ' + (err as Error).message);
    } finally {
      setManageDeleting(false);
    }
  }, [manageChecked, id, queryClient, volume?.issues]);

  const handleForceMatchSelected = useCallback(async () => {
    if (manageChecked.size === 0) return;
    setManageForceMatching(true);
    const ids = [...manageChecked];
    try {
      for (const issueId of ids) {
        await forceMatchIssue(id, issueId);
      }
      setActionMsg(`Force matching ${ids.length} issue(s).`);
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
      setManageChecked(new Set());
    } catch (err) {
      setActionMsg('Force match failed: ' + (err as Error).message);
    } finally {
      setManageForceMatching(false);
    }
  }, [manageChecked, id, queryClient]);


  const handleForceMatchFile = useCallback(
    async (filepath: string) => {
      const issueId = forceMatchTargets[filepath];
      if (!issueId) return;
      try {
        await submitManualMatch(id, [
          {
            filepath,
            issue_ids: [issueId],
            general_file: false,
            forced_match: true,
          },
        ]);
        setActionMsg('Force match submitted. Refresh & Scan to apply.');
        queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
        // Refresh manual match data
        const matches = await fetchManualMatch(id);
        setManualMatches(matches);
        setUnmatchedFiles(
          matches.filter((m) => m.issue_ids.length === 0 && !m.general_file),
        );
        setForceMatchTargets({});
      } catch (err) {
        setActionMsg('Force match failed: ' + (err as Error).message);
      }
    },
    [id, forceMatchTargets, queryClient],
  );

  const toggleUnmatchedCheck = useCallback((filepath: string) => {
    setUnmatchedChecked(prev => {
      const next = new Set(prev);
      if (next.has(filepath)) next.delete(filepath);
      else next.add(filepath);
      return next;
    });
  }, []);

  const toggleAllUnmatched = useCallback((checked: boolean, filepaths: string[]) => {
    if (checked) {
      setUnmatchedChecked(new Set(filepaths));
    } else {
      setUnmatchedChecked(new Set());
    }
  }, []);

  const handleDeleteUnmatchedSelected = useCallback(async () => {
    if (unmatchedChecked.size === 0) return;
    setUnmatchedDeleting(true);
    const filepaths = [...unmatchedChecked];
    let deleted = 0;
    try {
      for (const fp of filepaths) {
        // Try file_id-based delete first, fall back to raw filepath delete
        const match = unmatchedFiles.find(m => m.filepath === fp);
        if (match?.file_id != null) {
          await deleteFile(match.file_id);
        } else {
          if (!match?.unmatched_file_id) throw new Error('Missing unmatched file identifier');
          await deleteRawFile(id, match.unmatched_file_id);
        }
        deleted++;
      }
      setActionMsg(`Deleted ${deleted} unmatched file(s).`);
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
      setUnmatchedChecked(new Set());
      // Refresh manual match data
      const matches = await fetchManualMatch(id);
      setManualMatches(matches);
      setUnmatchedFiles(
        matches.filter((m) => m.issue_ids.length === 0 && !m.general_file),
      );
    } catch (err) {
      setActionMsg('Delete failed: ' + (err as Error).message);
    } finally {
      setUnmatchedDeleting(false);
    }
  }, [unmatchedChecked, unmatchedFiles, id, queryClient]);

  const handleDeleteAllUnmatched = useCallback(async () => {
    if (unmatchedFiles.length === 0) return;
    if (!window.confirm(`Delete all ${unmatchedFiles.length} unmatched files?`)) return;
    setUnmatchedDeleting(true);
    let deleted = 0;
    try {
      for (const uf of unmatchedFiles) {
        if (uf.file_id != null) {
          await deleteFile(uf.file_id);
        } else {
          if (!uf.unmatched_file_id) throw new Error('Missing unmatched file identifier');
          await deleteRawFile(id, uf.unmatched_file_id);
        }
        deleted++;
      }
      setActionMsg(`Deleted ${deleted} unmatched file(s).`);
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
      setUnmatchedChecked(new Set());
      const matches = await fetchManualMatch(id);
      setManualMatches(matches);
      setUnmatchedFiles(
        matches.filter((m) => m.issue_ids.length === 0 && !m.general_file),
      );
    } catch (err) {
      setActionMsg('Delete all failed: ' + (err as Error).message);
    } finally {
      setUnmatchedDeleting(false);
    }
  }, [unmatchedFiles, id, queryClient]);

  const openCoverDialog = useCallback(
    async (fileId: number, issueId: number, filename: string) => {
      setCoverDialog({ fileId, issueId, filename });
      setCoverCandidates([]);
      setCoverLoading(true);
      setCoverError(null);
      setCoverApplyResult(null);
      try {
        const candidates = await fetchCoverOptions(issueId);
        setCoverCandidates(candidates);
      } catch (err) {
        setCoverError(
          'Failed to fetch cover options: ' + (err as Error).message,
        );
      } finally {
        setCoverLoading(false);
      }
    },
    [],
  );

  const closeCoverDialog = useCallback(() => {
    setCoverDialog(null);
    setCoverCandidates([]);
    setCoverError(null);
    setCoverApplyResult(null);
  }, []);

  const handleApplyCover = useCallback(
    async (imageUrl: string) => {
      if (!coverDialog) return;
      if (
        !window.confirm(
          'Add this cover page to the PDF?',
        )
      )
        return;
      setCoverApplyingUrl(imageUrl);
      try {
        const result = await addCoverPage(coverDialog.fileId, imageUrl);
        setCoverApplyResult(result);
        setActionMsg('Cover page added.');
        queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
        const matches = await fetchManualMatch(id);
        setManualMatches(matches);
        setUnmatchedFiles(
          matches.filter((m) => m.issue_ids.length === 0 && !m.general_file),
        );
      } catch (err) {
        setCoverError('Failed to add cover: ' + (err as Error).message);
      } finally {
        setCoverApplyingUrl(null);
      }
    },
    [coverDialog, id, queryClient],
  );

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
        <Link to="/library" search={{ section: 'comic' }} className={styles.backLink}>
          ← Back to Library
        </Link>
      </div>
    );
  }

  const progressPct =
    volume.issue_count > 0
      ? Math.round((volume.issues_downloaded / volume.issue_count) * 100)
      : 0;
  const progressTone = progressPct >= 100 ? 'success' : 'danger';
  const selectedManualSearchIssue = volume.issues.find(
    (issue) => issue.id === manualSearchIssueId,
  );
  const tab = pathname.endsWith('/files') ? 'files' : pathname.endsWith('/history') ? 'history' : 'issues';
  const manualSearchTitle = formatIssueSearchTitle(
    volume.title,
    selectedManualSearchIssue,
  );
  return (
    <div className={styles.page}>
      <VolumeHero volume={volume} actionMsg={actionMsg} progressPct={progressPct} progressTone={progressTone} refreshPending={refreshMutation.isPending} autoSearchPending={autoSearchMutation.isPending} manualSearchPending={volManualSearching} onRefresh={() => refreshMutation.mutate()} onAutoSearch={() => autoSearchMutation.mutate()} onManualSearch={handleVolumeManualSearch} onEdit={openEdit} onFixMatch={openFixMatch} onPreviewRename={handleOpenRename} onManageIssues={openManageIssues} />

      <nav aria-label="Volume sections" className={styles.volumeTabs}>
        {([['issues', 'Issues', '/volumes/$volumeId/issues'], ['files', 'Files', '/volumes/$volumeId/files'], ['history', 'History', '/volumes/$volumeId/history']] as const).map(([key, label, to]) => <Link key={key} to={to} params={{ volumeId: String(id) }} aria-current={tab === key ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <section data-testid="volume-tab-panel">
        {tab === 'issues' ? <IssuesSection issues={volume.issues} volumeId={id} queueEntries={queueEntries} autoSearchingIssueId={autoSearchIssueMutation.isPending ? autoSearchIssueMutation.variables?.issueId : undefined} onAutoSearch={(issueId) => autoSearchIssueMutation.mutate({ volumeId: id, issueId })} onManualSearch={handleManualSearch} onHistory={handleShowHistory} onAddCover={(fileId, issueId, filename) => openCoverDialog(fileId, issueId, filename)} /> : tab === 'files' ? <VolumeFilesPanel issues={volume.issues} generalFiles={volume.general_files} /> : <VolumeHistoryPanel entries={volumeHistoryQuery.data ?? []} issues={volume.issues} loading={volumeHistoryQuery.isLoading} error={volumeHistoryQuery.error} />}
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
              ? `Searching — ${manualSearchTitle}`
              : `Manual Search — ${manualSearchTitle}`
          }
          onClose={closeManualSearch}
        />
        <DialogBody>
          <div className={styles.manualQuerySection}>
            <p className={styles.manualQueryHelp}>
              Override the metadata-generated source query when the title, year,
              or volume metadata does not match the release listing.
            </p>
            <div className={styles.fixSearchBar}>
              <input
                type="text"
                className={styles.fixSearchInput}
                placeholder="e.g. Teen Titans 2003"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !manualSearching) {
                    rerunIssueManualSearch();
                  }
                }}
                disabled={manualSearching}
              />
              <Button
                variant="primary"
                onClick={rerunIssueManualSearch}
                disabled={manualSearching}
              >
                {manualSearching ? 'Searching…' : 'Search'}
              </Button>
            </div>
          </div>
          {manualSearching && (
            <p className={styles.dialogStatus}>Searching for downloads…</p>
          )}
          {!manualSearching && manualSearchError && (
            <p className={styles.dialogError}>{manualSearchError}</p>
          )}
          {manualDownloadError && (
            <p className={styles.dialogError}>{manualDownloadError}</p>
          )}
          {!manualSearching && !manualSearchError && manualResults.length === 0 && (
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
                        title="Force download despite metadata mismatch"
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

          {/* ── Suwayomi Bundle section ─────────────────── */}
          <div className={styles.bundleSection}>
            <h4 className={styles.dialogSubhead}>Suwayomi Chapter Bundle</h4>
            <p className={styles.bundleHelpText}>
              Enter chapters to bundle (e.g. <code>1-7</code> or <code>1,2,3,4,5,6,7</code>).
            </p>
            <div className={styles.fixSearchBar}>
              <input
                type="text"
                className={styles.fixSearchInput}
                placeholder="1-7 or 1,2,3,4,5,6,7"
                value={swBundleInput}
                onChange={(e) => setSwBundleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSuwayomiBundleSearch();
                }}
                disabled={swBundleSearching}
              />
              <Button
                variant="primary"
                onClick={doSuwayomiBundleSearch}
                disabled={swBundleSearching || !swBundleInput.trim()}
              >
                {swBundleSearching ? 'Searching…' : 'Search'}
              </Button>
            </div>
            {swBundleSearching && (
              <p className={styles.dialogStatus}>Searching Suwayomi…</p>
            )}
            {!swBundleSearching && swBundleError && (
              <p className={styles.dialogStatus}>{swBundleError}</p>
            )}
            {!swBundleSearching && swBundleResults.length > 0 && (
              <table className={styles.searchResultTable}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th className={styles.thSource}>Source</th>
                    <th className={styles.thAction}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {swBundleResults.map((result, i) => (
                    <tr key={i}>
                      <td>{result.display_title}</td>
                      <td className={styles.sourceCell}>{result.source}</td>
                      <td className={styles.actionCell}>
                        <Button
                          variant="primary"
                          disabled={
                            downloadIssueMutation.isPending &&
                            downloadIssueMutation.variables?.link === result.link
                          }
                          onClick={() => {
                            downloadIssueMutation.mutate({
                              issueId: manualSearchIssueId!,
                              link: result.link,
                              forceMatch: true,
                              displayTitle: result.display_title,
                            });
                            closeManualSearch();
                          }}
                        >
                          Download
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogBody>
      </DialogFrame>

      <IssueHistoryDialog issueId={historyIssueId} entries={historyEntries} loading={historyLoading} onClose={closeHistory} />

      {/* ── Volume-Level Manual Search Dialog ───────────────── */}
      <DialogFrame
        open={volManualOpen}
        onOpenChange={(open) => {
          if (!open) closeVolumeManualSearch();
        }}
      >
        <DialogHeader
          title={
            volManualSearching
              ? 'Searching…'
              : `Manual Search — ${volume.title}`
          }
          onClose={closeVolumeManualSearch}
        />
        <DialogBody>
          <div className={styles.manualQuerySection}>
            <p className={styles.manualQueryHelp}>
              Override the metadata-generated source query when the title, year,
              or volume metadata does not match the release listing.
            </p>
            <div className={styles.fixSearchBar}>
              <input
                type="text"
                className={styles.fixSearchInput}
                placeholder="e.g. Teen Titans 2003"
                value={volManualQuery}
                onChange={(e) => setVolManualQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !volManualSearching) {
                    rerunVolumeManualSearch();
                  }
                }}
                disabled={volManualSearching}
              />
              <Button
                variant="primary"
                onClick={rerunVolumeManualSearch}
                disabled={volManualSearching}
              >
                {volManualSearching ? 'Searching…' : 'Search'}
              </Button>
            </div>
          </div>
          {volManualSearching && (
            <p className={styles.dialogStatus}>Searching for downloads…</p>
          )}
          {!volManualSearching && volManualSearchError && (
            <p className={styles.dialogError}>{volManualSearchError}</p>
          )}
          {manualDownloadError && (
            <p className={styles.dialogError}>{manualDownloadError}</p>
          )}
          {!volManualSearching && !volManualSearchError && volManualResults.length === 0 && (
            <p className={styles.dialogStatus}>No results found.</p>
          )}
          {!volManualSearching && volManualResults.length > 0 && (
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
                {volManualResults.map((result, i) => (
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
                          downloadVolumeMutation.isPending &&
                          downloadVolumeMutation.variables?.link === result.link
                        }
                        onClick={() =>
                          downloadVolumeMutation.mutate({
                            link: result.link,
                            displayTitle: result.display_title,
                            forceMatch: false,
                          })
                        }
                      >
                        Download
                      </Button>
                      <Button
                        variant="secondary"
                        title="Force download despite metadata mismatch"
                        disabled={
                          downloadVolumeMutation.isPending &&
                          downloadVolumeMutation.variables?.link === result.link
                        }
                        onClick={() =>
                          downloadVolumeMutation.mutate({
                            link: result.link,
                            displayTitle: result.display_title,
                            forceMatch: true,
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
              <Button variant="secondary" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <div className={styles.deleteVolumeBlock}>
                <label className={styles.deleteFolderOption}>
                  <input
                    type="checkbox"
                    checked={deleteVolumeFolder}
                    onChange={(e) => setDeleteVolumeFolder(e.target.checked)}
                    disabled={deleteMutation.isPending}
                  />
                  <span>Also delete volume folder</span>
                </label>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const folderWarning = deleteVolumeFolder
                      ? '\n\nThe volume folder and its files will also be deleted from disk.'
                      : '';
                    if (window.confirm(`Delete "${volume.title}" from the library? This cannot be undone.${folderWarning}`)) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete Volume'}
                </Button>
              </div>
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

      {/* ── Rename Dialog ──────────────────────────────────── */}
      <DialogFrame
        open={renameOpen}
        onOpenChange={(open) => {
          if (!open) closeRename();
        }}
      >
        <DialogHeader
          title={
            renameLoading
              ? 'Loading rename preview…'
              : renameEntries.length === 0
                ? 'Nothing to Rename'
                : `Preview Rename — ${volume.title}`
          }
          onClose={closeRename}
        />
        <DialogBody>
          {renameLoading && (
            <p className={styles.dialogStatus}>Loading rename preview…</p>
          )}
          {!renameLoading && renameEntries.length === 0 && (
            <p className={styles.dialogStatus}>Nothing to rename.</p>
          )}
          {!renameLoading && renameEntries.length > 0 && (
            <>
              <table className={styles.renameTable}>
                <thead>
                  <tr>
                    <th className={styles.renameCheck}>
                      <input
                        type="checkbox"
                        checked={
                          renameEntries.length > 0 &&
                          renameChecked.size === renameEntries.length
                        }
                        onChange={(e) => toggleAllRenames(e.target.checked)}
                      />
                    </th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {renameEntries.map((entry) => (
                    <tr key={entry.before}>
                      <td className={styles.renameCheck}>
                        <input
                          type="checkbox"
                          checked={renameChecked.has(entry.before)}
                          onChange={() => toggleRenameCheck(entry.before)}
                        />
                      </td>
                      <td className={styles.renamePath}>{entry.before}</td>
                      <td className={styles.renamePath}>{entry.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.renameActions}>
                <Button
                  variant="primary"
                  disabled={renameChecked.size === 0 || renameSubmitting}
                  onClick={handleSubmitRename}
                >
                  {renameSubmitting ? 'Renaming…' : 'Rename'}
                </Button>
                <Button variant="ghost" onClick={closeRename}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </DialogBody>
      </DialogFrame>

      {/* ── Add Cover Dialog ────────────────────────────── */}
      <DialogFrame
        open={coverDialog !== null}
        onOpenChange={(open) => {
          if (!open) closeCoverDialog();
        }}
      >
        <DialogHeader
          title={
            coverLoading
              ? 'Searching for covers…'
              : coverDialog
                ? `Add Cover Page — ${coverDialog.filename}`
                : 'Add Cover Page'
          }
          onClose={closeCoverDialog}
        />
        <DialogBody>
          {coverLoading && (
            <p className={styles.dialogStatus}>
              Searching MangaDex for covers…
            </p>
          )}
          {!coverLoading && coverError && (
            <p className={styles.dialogStatus}>{coverError}</p>
          )}
          {!coverLoading && !coverError && coverCandidates.length === 0 && (
            <p className={styles.dialogStatus}>
              No cover art found for this volume on MangaDex.
            </p>
          )}
          {!coverLoading && !coverError && coverCandidates.length > 0 && (
            <>
              {coverApplyResult && (
                <div className={styles.coverResultMsg}>
                  Cover page added successfully.
                </div>
              )}
              <div className={styles.coverGrid}>
                {coverCandidates.map((candidate) => (
                  <div key={candidate.cover_id} className={styles.coverCard}>
                    <AuthenticatedImage
                      className={styles.coverThumb}
                      endpoint={getCoverPreviewEndpoint(candidate)}
                      alt={`Cover for ${candidate.manga_title} vol. ${candidate.volume}`}
                      loading="lazy"
                    />
                    <div className={styles.coverCardMeta}>
                      <div className={styles.coverCardTitle}>
                        {candidate.manga_title}
                      </div>
                      <div className={styles.coverCardInfo}>
                        <span>Vol. {candidate.volume}</span>
                        {candidate.locale && (
                          <span> · {candidate.locale}</span>
                        )}
                        <span> · {candidate.source}</span>
                      </div>
                      {candidate.description && (
                        <div className={styles.coverCardDesc}>
                          {candidate.description}
                        </div>
                      )}
                    </div>
                    <div className={styles.coverCardActions}>
                      <Button
                        variant="primary"
                        disabled={coverApplyingUrl === candidate.image_url}
                        onClick={() => handleApplyCover(candidate.image_url)}
                      >
                        {coverApplyingUrl === candidate.image_url
                          ? 'Applying…'
                          : 'Use This Cover'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogBody>
      </DialogFrame>

      <ManageIssuesDialog
        open={manageIssuesOpen}
        volume={volume}
        loading={manageLoading}
        checked={manageChecked}
        deleting={manageDeleting}
        forceMatching={manageForceMatching}
        manualMatches={manualMatches}
        unmatchedFiles={unmatchedFiles}
        unmatchedChecked={unmatchedChecked}
        unmatchedDeleting={unmatchedDeleting}
        forceMatchTargets={forceMatchTargets}
        setForceMatchTargets={setForceMatchTargets}
        onClose={closeManageIssues}
        onToggleIssue={toggleManageCheck}
        onToggleAllIssues={toggleAllManage}
        onToggleUnmatched={toggleUnmatchedCheck}
        onToggleAllUnmatched={toggleAllUnmatched}
        onForceMatchFile={handleForceMatchFile}
        onDeleteUnmatchedSelected={handleDeleteUnmatchedSelected}
        onDeleteAllUnmatched={handleDeleteAllUnmatched}
        onDeleteSelected={handleDeleteSelected}
        onForceMatchSelected={handleForceMatchSelected}
      />
    </div>
  );
}
