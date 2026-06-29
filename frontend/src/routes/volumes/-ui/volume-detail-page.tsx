import { useState, useCallback, useRef } from 'react';
import { useSocketEvent } from '@/platform/socketio/socket';
import type { QueueEntry } from '@/routes/activity/queue/-queue.types';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiKey, getUrlBase } from '@/app/api-client';
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
} from '../-volumes.types';
import { sanitizeHtml } from './sanitize';
import styles from './volume-detail-page.module.css';

function getCoverPreviewSrc(candidate: CoverCandidate): string {
  const params = new URLSearchParams({ url: candidate.thumbnail_url });
  const apiKey = getApiKey();
  if (apiKey) params.set('api_key', apiKey);
  return `${getUrlBase()}/api/mangadex/cover-proxy?${params.toString()}`;
}

// ── SVG icon components ──────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function BookOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  );
}

function CoverPageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="9" cy="8" r="1.5" />
      <path d="m4 17 4.5-4.5 3.5 3.5 2-2 6 6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
      <path d="m15 5 4 4"/>
    </svg>
  );
}

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

function formatIssueSearchTitle(volumeTitle: string, issue?: IssueDetail): string {
  if (!issue) return volumeTitle;
  const issueNumber = issue.issue_number ? ` #${issue.issue_number}` : '';
  const issueTitle = issue.title ? ` — ${issue.title}` : '';
  return `${volumeTitle}${issueNumber}${issueTitle}`;
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
  const [actionMsg, setActionMsg] = useState('');
  const [queueEntries, setQueueEntries] = useState<Map<number, QueueEntry>>(new Map());

  // Issue manual search dialog
  const [manualSearchIssueId, setManualSearchIssueId] = useState<number | null>(null);
  const [manualResults, setManualResults] = useState<ManualSearchResult[]>([]);
  const [manualSearching, setManualSearching] = useState(false);

  // Volume-level manual search dialog
  const [volManualResults, setVolManualResults] = useState<ManualSearchResult[]>([]);
  const [volManualSearching, setVolManualSearching] = useState(false);

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
      navigate({ to: volume?.section === 'manga' ? '/manga' : '/comics' });
    },
  });

  const autoSearchMutation = useMutation({
    mutationFn: () => autoSearchVolume(id),
    onSuccess: () => setActionMsg('Auto search started.'),
  });

  const manualSearchVolMutation = useMutation({
    mutationFn: () => manualSearchVolume(id),
    onSuccess: (data) => {
      setVolManualResults(data);
      setVolManualSearching(false);
      if (data.length === 0) {
        setActionMsg('Manual search returned no results.');
      }
    },
    onError: (err) => {
      setVolManualSearching(false);
      setActionMsg('Manual search failed: ' + (err as Error).message);
    },
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
    onSuccess: () => {
      setActionMsg('Download queued.');
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
    },
    onError: (err) => setActionMsg('Download failed: ' + (err as Error).message),
  });

  const downloadVolumeMutation = useMutation({
    mutationFn: ({
      link,
      displayTitle,
    }: {
      link: string;
      displayTitle: string;
    }) => downloadVolume(id, link, displayTitle),
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
      queryClient.invalidateQueries({ queryKey: VOLUME_FULL_KEY(id) });
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
    swBundleRequestSeq.current += 1;
    setSwBundleInput('');
    setSwBundleResults([]);
    setSwBundleSearching(false);
    setSwBundleError('');
    try {
      const results = await manualSearchIssue(issueId);
      setManualResults(results);
    } catch {
      setManualResults([]);
    } finally {
      setManualSearching(false);
    }
  }, []);

  const handleVolumeManualSearch = useCallback(() => {
    setVolManualSearching(true);
    setVolManualResults([]);
    manualSearchVolMutation.mutate();
  }, [manualSearchVolMutation]);

  const closeManualSearch = useCallback(() => {
    swBundleRequestSeq.current += 1;
    setManualSearchIssueId(null);
    setManualResults([]);
    setSwBundleInput('');
    setSwBundleResults([]);
    setSwBundleSearching(false);
    setSwBundleError('');
  }, []);

  const closeVolumeManualSearch = useCallback(() => {
    setVolManualResults([]);
    setVolManualSearching(false);
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
    // Collect file IDs for every checked issue by cross-referencing
    // their filenames against manualMatches (which carries file_id).
    const fileIds: number[] = [];
    const issues = volume?.issues ?? [];
    for (const issueId of checkedIds) {
      const issue = issues.find((i) => i.id === issueId);
      if (!issue || issue.filenames.length === 0) continue;
      for (const fn of issue.filenames) {
        const mf = manualMatches.find(
          (m) => m.filepath.endsWith(fn) || m.filepath === fn,
        );
        if (mf?.file_id != null && !fileIds.includes(mf.file_id)) {
          fileIds.push(mf.file_id);
        }
      }
    }
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
  }, [manageChecked, id, queryClient, volume?.issues, manualMatches]);

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
          await deleteRawFile(fp);
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
          await deleteRawFile(uf.filepath);
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
  const selectedManualSearchIssue = volume.issues.find(
    (issue) => issue.id === manualSearchIssueId,
  );
  const manualSearchTitle = formatIssueSearchTitle(
    volume.title,
    selectedManualSearchIssue,
  );
  return (
    <div className={styles.page}>
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

          <div className={styles.actionBox}>
            <span className={styles.actionBoxTitle}>Actions</span>
            <div className={styles.actionBtns}>
              <Button
                variant="secondary"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                title={refreshMutation.isPending ? 'Scanning…' : 'Refresh & Scan'}
              >
                <RefreshIcon />
              </Button>
              <Button
                variant="secondary"
                onClick={() => autoSearchMutation.mutate()}
                disabled={autoSearchMutation.isPending}
                title={autoSearchMutation.isPending ? 'Searching…' : 'Auto Search'}
              >
                <SearchIcon />
              </Button>
              <Button
                variant="secondary"
                onClick={handleVolumeManualSearch}
                disabled={volManualSearching}
                title={volManualSearching ? 'Searching…' : 'Manual Search'}
              >
                <PersonIcon />
              </Button>
              <Button variant="secondary" onClick={openEdit} title="Edit">
                <PencilIcon />
              </Button>
              <Button variant="secondary" onClick={openFixMatch}>
                Fix Match
              </Button>
              <Button variant="secondary" onClick={handleOpenRename}>
                Preview Rename
              </Button>
              <Button variant="secondary" onClick={openManageIssues}>
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
                <th className={styles.thFilename}>Filename</th>
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
                  queueEntry={queueEntries.get(issue.id)}
                  onAutoSearch={() =>
                    autoSearchIssueMutation.mutate({ volumeId: id, issueId: issue.id })
                  }
                  onManualSearch={() => handleManualSearch(issue.id)}
                  onHistory={() => handleShowHistory(issue.id)}
                  onAddCover={(fileId, filename) =>
                    openCoverDialog(fileId, issue.id, filename)
                  }
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
              ? `Searching — ${manualSearchTitle}`
              : `Manual Search — ${manualSearchTitle}`
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

      {/* ── Volume-Level Manual Search Dialog ───────────────── */}
      <DialogFrame
        open={volManualResults.length > 0 || volManualSearching}
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
          {volManualSearching && (
            <p className={styles.dialogStatus}>Searching for downloads…</p>
          )}
          {!volManualSearching && volManualResults.length === 0 && (
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
                          })
                        }
                      >
                        Download
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
                    <img
                      className={styles.coverThumb}
                      src={getCoverPreviewSrc(candidate)}
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

      {/* ── Manage Issues Dialog ──────────────────────────── */}
      <DialogFrame
        open={manageIssuesOpen}
        onOpenChange={(open) => {
          if (!open) closeManageIssues();
        }}
      >
        <DialogHeader
          title={`Manage Issues — ${volume.title}`}
          onClose={closeManageIssues}
        />
        <DialogBody>
          {manageLoading ? (
            <p className={styles.dialogStatus}>Loading…</p>
          ) : volume.issues.length === 0 && unmatchedFiles.length === 0 ? (
            <p className={styles.dialogStatus}>No issues to manage.</p>
          ) : (
            <>
              {volume.issues.length > 0 && (
                <>
                  <h4 className={styles.dialogSubhead}>Matched Issues</h4>
                  <table className={styles.renameTable}>
                    <thead>
                      <tr>
                        <th className={styles.renameCheck}>
                          <input
                            type="checkbox"
                            checked={
                              volume.issues.length > 0 &&
                              manageChecked.size === volume.issues.length
                            }
                            onChange={(e) =>
                              toggleAllManage(
                                e.target.checked,
                                volume.issues.map(i => i.id),
                              )
                            }
                          />
                        </th>
                        <th>#</th>
                        <th>Title</th>
                        <th>Filename</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volume.issues.map((issue) => (
                        <tr key={issue.id}>
                          <td className={styles.renameCheck}>
                            <input
                              type="checkbox"
                              checked={manageChecked.has(issue.id)}
                              onChange={() => toggleManageCheck(issue.id)}
                            />
                          </td>
                          <td className={styles.issueNum}>
                            #{issue.issue_number}
                          </td>
                          <td className={styles.issueTitle}>
                            {issue.title || '—'}
                          </td>
                          <td className={styles.issueFilename}>
                            {issue.filenames.length > 0
                              ? issue.filenames.map((f, i) => (
                                  <span
                                    key={i}
                                    className={styles.filenameLine}
                                  >
                                    {f}
                                  </span>
                                ))
                              : '—'}
                          </td>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {unmatchedFiles.length > 0 && (
                <>
                  <h4 className={styles.dialogSubhead}>
                    Unmatched Files ({unmatchedFiles.length})
                  </h4>
                  <table className={styles.renameTable}>
                    <thead>
                      <tr>
                        <th className={styles.renameCheck}>
                          <input
                            type="checkbox"
                            checked={
                              unmatchedFiles.length > 0 &&
                              unmatchedChecked.size === unmatchedFiles.length
                            }
                            onChange={(e) =>
                              toggleAllUnmatched(
                                e.target.checked,
                                unmatchedFiles.map(uf => uf.filepath),
                              )
                            }
                          />
                        </th>
                        <th>Filename</th>
                        <th className={styles.thActions}>
                          Force Match To
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedFiles.map((uf) => {
                        const fn =
                          uf.filepath.split(/[/\\]/).pop() || uf.filepath;
                        const matchedIssueIds = new Set(
                          manualMatches.flatMap(m => m.issue_ids),
                        );
                        const unmatchedIssues = volume.issues.filter(
                          issue => !matchedIssueIds.has(issue.id),
                        );
                        return (
                          <tr key={uf.filepath}>
                            <td className={styles.renameCheck}>
                              <input
                                type="checkbox"
                                checked={unmatchedChecked.has(uf.filepath)}
                                onChange={() =>
                                  toggleUnmatchedCheck(uf.filepath)
                                }
                              />
                            </td>
                            <td className={styles.issueFilename}>
                              <span className={styles.filenameLine}>
                                {fn}
                              </span>
                            </td>
                            <td className={styles.actionsCell}>
                              <select
                                className={styles.editSelect}
                                value={forceMatchTargets[uf.filepath] ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForceMatchTargets((prev) => {
                                    const next = { ...prev };
                                    if (val) {
                                      next[uf.filepath] = Number(val);
                                    } else {
                                      delete next[uf.filepath];
                                    }
                                    return next;
                                  });
                                }}
                              >
                                <option value="">
                                  Select issue…
                                </option>
                                {unmatchedIssues.map((issue) => (
                                  <option
                                    key={issue.id}
                                    value={issue.id}
                                  >
                                    #{issue.issue_number}
                                    {issue.title
                                      ? ` — ${issue.title}`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                              <Button
                                variant="primary"
                                disabled={
                                  !forceMatchTargets[uf.filepath]
                                }
                                onClick={() =>
                                  handleForceMatchFile(uf.filepath)
                                }
                              >
                                Match
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className={styles.inlineActions}>
                    <Button
                      variant="primary"
                      disabled={
                        unmatchedChecked.size === 0 || unmatchedDeleting
                      }
                      onClick={handleDeleteUnmatchedSelected}
                    >
                      {unmatchedDeleting
                        ? 'Deleting…'
                        : 'Delete Selected'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={unmatchedDeleting}
                      onClick={handleDeleteAllUnmatched}
                    >
                      Delete All
                    </Button>
                  </div>
                </>
              )}

              <div className={styles.manageDialogActions}>
                <Button
                  variant="secondary"
                  onClick={closeManageIssues}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    manageChecked.size === 0 ||
                    manageDeleting ||
                    manageForceMatching
                  }
                  onClick={handleDeleteSelected}
                >
                  {manageDeleting ? 'Deleting…' : 'Delete Selected'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    manageChecked.size === 0 ||
                    manageDeleting ||
                    manageForceMatching
                  }
                  onClick={handleForceMatchSelected}
                >
                  {manageForceMatching
                    ? 'Matching…'
                    : 'Force Match Selected'}
                </Button>
              </div>
            </>
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
  queueEntry?: QueueEntry;
  onAutoSearch: () => void;
  onManualSearch: () => void;
  onHistory: () => void;
  onAddCover: (fileId: number, filename: string) => void;
  isAutoSearching: boolean;
}

function IssueRow({
  issue,
  queueEntry,
  onAutoSearch,
  onManualSearch,
  onHistory,
  onAddCover,
  isAutoSearching,
}: IssueRowProps) {
  const pdfFile = issue.filenames
    .map((filename, index) => ({ filename, fileId: issue.file_ids[index] }))
    .find(({ filename, fileId }) =>
      fileId != null && filename.toLowerCase().endsWith('.pdf'),
    );

  return (
    <tr className={styles.issueRow}>
      <td className={styles.issueNum}>#{issue.issue_number}</td>
      <td className={styles.issueTitle}>{issue.title || '—'}</td>
      <td className={styles.issueFilename}>
        {issue.filenames.length > 0
          ? issue.filenames.map((f, i) => (
              <span key={i} className={styles.filenameLine}>
                {f}
              </span>
            ))
          : '—'}
      </td>
      <td className={styles.issueDate}>{issue.release_date || '—'}</td>
      <td>
        {queueEntry ? (
          <div className={styles.downloadProgress}>
            <Progress
              value={
                queueEntry.progress_is_percent !== false
                  ? Math.round(queueEntry.progress)
                  : queueEntry.size > 0
                    ? Math.round((queueEntry.progress / queueEntry.size) * 100)
                    : 0
              }
              tone="success"
              className={styles.issueProgressBar}
            />
            <span className={styles.queueTaskLabel}>
              {queueEntry.task_label || 'Downloading'}
            </span>
          </div>
        ) : (
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
        )}
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
            {isAutoSearching ? '…' : <SearchIcon />}
          </button>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="Manually search for this issue"
            aria-label="Manually search for this issue"
            onClick={onManualSearch}
          >
            <PersonIcon />
          </button>
          <button
            type="button"
            className={styles.issueActionBtn}
            title="View history for this issue"
            aria-label="View history for this issue"
            onClick={onHistory}
          >
            <HistoryIcon />
          </button>
          {pdfFile && (
            <button
              type="button"
              className={styles.issueActionBtn}
              title={`Add cover page to "${pdfFile.filename}"`}
              aria-label={`Add cover page to "${pdfFile.filename}"`}
              onClick={() => onAddCover(pdfFile.fileId, pdfFile.filename)}
            >
              <CoverPageIcon />
            </button>
          )}
          {issue.downloaded && issue.file_ids.length > 0 && (
            <Link
              to="/read/$fileId"
              params={{ fileId: String(issue.file_ids[0]) }}
              className={styles.issueActionBtn}
              title="Read this issue"
              aria-label="Read this issue"
            >
              <BookOpenIcon />
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}
