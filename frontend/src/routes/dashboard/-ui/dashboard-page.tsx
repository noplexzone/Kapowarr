import { useCallback } from 'react';
import { AuthenticatedImage } from '@/components/authenticated-resource';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card, Badge, Button, Progress } from '@/components/primitives';
import { useSocketEvent } from '@/platform/socketio/socket';
import { StatusBanner } from '@/components/patterns';
import {
  DASHBOARD_SUMMARY_KEY,
  dashboardSummaryQueryOptions,
  recentlyAddedQueryOptions,
  dashboardActiveSearchesQueryOptions,
  dashboardQueueQueryOptions,
  dashboardHistoryQueryOptions,
} from '../-dashboard.api';
import type { DashboardSearchTask, DashboardSummary, VolumeCard } from '../-dashboard.types';
import styles from './dashboard-page.module.css';

interface QueueSummaryEntry {
  id: number;
  title?: string;
  status?: string;
  volume_title?: string;
  task_label?: string;
  progress?: number;
  progress_is_percent?: boolean;
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const summaryQuery = useQuery(dashboardSummaryQueryOptions());
  const comicRecentQuery = useQuery(recentlyAddedQueryOptions('comic'));
  const mangaRecentQuery = useQuery(recentlyAddedQueryOptions('manga'));
  const activeSearchesQuery = useQuery(dashboardActiveSearchesQueryOptions());
  const queueQuery = useQuery(dashboardQueueQueryOptions());
  const historyQuery = useQuery(dashboardHistoryQueryOptions());
  const summary = summaryQuery.data;
  const comicRecent = comicRecentQuery.data;
  const mangaRecent = mangaRecentQuery.data;
  const activeSearchesData = activeSearchesQuery.data;
  const queueData = queueQuery.data;
  const historyData = historyQuery.data;
  const dashboardQueries = [summaryQuery, comicRecentQuery, mangaRecentQuery, activeSearchesQuery, queueQuery, historyQuery];
  const hasError = dashboardQueries.some((query) => query.isError);
  const isRefreshing = dashboardQueries.some((query) => query.isFetching);
  const isSummaryUpdating = summaryQuery.isFetching && Boolean(summary);

  const activeSearches = Array.isArray(activeSearchesData) ? activeSearchesData : [];
  const queueItems = Array.isArray(queueData) ? queueData as QueueSummaryEntry[] : [];
  const historyEntries = (historyData?.entries ?? []).slice(0, 6);
  const missingTotal = summary?.library.missing_monitored ?? null;
  const upcomingTotal = summary?.library.upcoming_monitored ?? null;
  const failedDownloads = summary?.operations.failed_downloads ?? null;
  const activeDownloads = summary ? Math.max(summary.operations.active_downloads, queueItems.length) : null;
  const activeSearchCount = summary ? Math.max(summary.operations.active_searches, activeSearches.length) : null;
  const mismatchTotal = summary?.library.mismatches ?? null;
  const totalIssues = summary?.library.released_issues ?? 0;
  const downloadedIssues = summary?.library.downloaded_released_issues ?? 0;
  const completionPercent = Math.round(summary?.library.completion_percentage ?? 0);

  const refreshLiveOperations = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['system', 'tasks', 'dashboard', 'active-searches'] });
    void queryClient.invalidateQueries({ queryKey: ['activity', 'queue', 'dashboard'] });
  }, [queryClient]);

  const refreshCompletedWork = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_SUMMARY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['activity', 'queue', 'dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['activity', 'history', 'dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['volumes', 'recently-added'] });
    void queryClient.invalidateQueries({ queryKey: ['nav', 'badges'] });
  }, [queryClient]);

  const refreshDownloadedStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_SUMMARY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['volumes', 'recently-added'] });
    void queryClient.invalidateQueries({ queryKey: ['nav', 'badges'] });
  }, [queryClient]);

  useSocketEvent('task_added', refreshLiveOperations);
  useSocketEvent('task_status', refreshLiveOperations);
  useSocketEvent('task_ended', refreshCompletedWork);
  useSocketEvent('queue_added', refreshLiveOperations);
  useSocketEvent('queue_status', refreshLiveOperations);
  useSocketEvent('queue_ended', refreshCompletedWork);
  useSocketEvent('downloaded_status', refreshDownloadedStatus);

  const refreshHome = () => Promise.all([
    DASHBOARD_SUMMARY_KEY,
    ['volumes', 'recently-added'],
    ['system', 'tasks', 'dashboard', 'active-searches'],
    ['activity', 'queue', 'dashboard'],
    ['activity', 'history', 'dashboard'],
  ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));

  return (
    <div className={styles.page}>
      <div className={styles.topActions}>
        {isSummaryUpdating && <span className={styles.updatingIndicator}>Updating KPIs…</span>}
        <Button variant="secondary" disabled={isRefreshing} onClick={refreshHome}>
          {isRefreshing ? 'Refreshing…' : 'Refresh Home'}
        </Button>
      </div>
      {hasError && (
        <StatusBanner error>
          Some Home data could not be loaded. Preserve successful sections while retrying stale panels.
        </StatusBanner>
      )}

      <section className={styles.hero} aria-labelledby="home-command-center-title">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Kapowarr command center</span>
          <h1 id="home-command-center-title">Run the collection, then browse it.</h1>
          <p>
            Start with the work: missing monitored issues, failed downloads, active searches,
            and shelves worth checking after the queue settles.
          </p>
          <div className={styles.heroActions}>
            <Link className={`${styles.actionLink} ${styles.actionPrimary}`} to="/comics" search={{ status: 'missing', monitoring: 'all', sort: 'wanted', view: 'grid', page: 1 }}>
              Comics missing
            </Link>
            <Link className={`${styles.actionLink} ${styles.actionSecondary}`} to="/manga" search={{ status: 'missing', monitoring: 'all', sort: 'wanted', view: 'grid', page: 1 }}>
              Manga missing
            </Link>
            <Link className={`${styles.actionLink} ${styles.actionGhost}`} to="/activity/queue">Open queue</Link>
          </div>
        </div>
        <Card className={styles.heroPanel}>
          <div className={styles.panelLabel}>Library completion</div>
          <div className={styles.completionValue}>{summary ? `${completionPercent}%` : <MetricSkeleton label="Library completion" />}</div>
          <Progress value={completionPercent} tone={completionPercent >= 90 ? 'success' : 'accent'} aria-label="Library completion" />
          <dl className={styles.heroStats}>
            <div>
              <dt>Downloaded</dt>
              <dd>{summary ? formatCount(downloadedIssues) : <MetricSkeleton label="Downloaded released issues" />}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{summary ? formatCount(totalIssues) : <MetricSkeleton label="Released issues" />}</dd>
            </div>
            <div>
              <dt>Missing</dt>
              <dd>{summary ? formatCount(missingTotal ?? 0) : <MetricSkeleton label="Missing monitored" />}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <div className={styles.dashboardBody}>
        <div className={styles.mainColumn}>
          <div className={styles.commandGrid}>
            <MetricCard label="Missing monitored" value={missingTotal} meta="Released monitored missing issues" tone="danger" to="/comics" search={{ status: 'missing', monitoring: 'all', sort: 'completion', view: 'grid', page: 1 }} />
            <MetricCard label="Upcoming monitored" value={upcomingTotal} meta="Monitored issues not released yet" tone="info" to="/comics" search={{ status: 'upcoming', monitoring: 'all', sort: 'recently_released', view: 'grid', page: 1 }} />
            <MetricCard label="Mismatches" value={mismatchTotal} meta="Import records needing review" tone="warning" to="/activity/mismatches" search={{ section: 'comic' }} />
            <MetricCard label="Active downloads" value={activeDownloads} meta="Queue items moving now" tone="success" to="/activity/queue" />
            <MetricCard label="Failed downloads" value={failedDownloads} meta="History entries needing recovery" tone="warning" to="/activity/history" search={{ page: 1, status: 'failed', section: 'all' }} />
          </div>

          <div className={styles.operationalGrid}>
        <section className={styles.section} aria-labelledby="wanted-triage-heading">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Triage</span>
              <h2 id="wanted-triage-heading" className={styles.sectionTitle}>Wanted / Missing Triage</h2>
            </div>
            <Link to="/activity/history" search={{ page: 1, status: 'failed', section: 'all' }} className={styles.sectionLink}>
              Failure history
            </Link>
          </div>
          <Card className={styles.triageCard}>
            <TriageRow label="Comics missing" value={sectionMetric(summary, 'comic', 'missing_monitored')} to="/comics" search={{ status: 'missing', monitoring: 'all', sort: 'wanted', view: 'grid', page: 1 }} />
            <TriageRow label="Manga missing" value={sectionMetric(summary, 'manga', 'missing_monitored')} to="/manga" search={{ status: 'missing', monitoring: 'all', sort: 'wanted', view: 'grid', page: 1 }} />
            <TriageRow label="Comics upcoming" value={sectionMetric(summary, 'comic', 'upcoming_monitored')} to="/comics" search={{ status: 'upcoming', monitoring: 'all', sort: 'recently_released', view: 'grid', page: 1 }} />
            <TriageRow label="Manga upcoming" value={sectionMetric(summary, 'manga', 'upcoming_monitored')} to="/manga" search={{ status: 'upcoming', monitoring: 'all', sort: 'recently_released', view: 'grid', page: 1 }} />
            <TriageRow label="Comic mismatches" value={sectionMetric(summary, 'comic', 'mismatches')} to="/activity/mismatches" search={{ section: 'comic' }} />
            <TriageRow label="Manga mismatches" value={sectionMetric(summary, 'manga', 'mismatches')} to="/activity/mismatches" search={{ section: 'manga' }} />
          </Card>
        </section>

        <section className={styles.section} aria-labelledby="live-operations-heading">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Operations</span>
              <h2 id="live-operations-heading" className={styles.sectionTitle}>Live Operations</h2>
            </div>
            <Link to="/activity/search-history" search={{ page: 1 }} className={styles.sectionLink}>
              Search outcomes
            </Link>
          </div>
          <Card className={styles.sectionCard}>
            <MetricCard label="Active searches" value={activeSearchCount} meta="Search tasks running or queued" tone="info" to="/activity/search-history" search={{ page: 1 }} />
            <OperationList
              title="Active Searches"
              empty="No active searches"
              entries={activeSearches.slice(0, 4)}
              renderEntry={(entry) => (
                <OperationRow
                  key={entry.id}
                  title={searchTaskTitle(entry)}
                  meta={searchTaskMeta(entry)}
                  tone={entry.status === 'running' ? 'info' : 'neutral'}
                  badge={entry.status}
                />
              )}
            />
            <Link to="/activity/search-history" search={{ page: 1 }} className={styles.inlineSectionLink}>
              View active search outcomes
            </Link>
            <OperationList
              title="Active Downloads"
              empty="Queue is empty"
              entries={queueItems.slice(0, 4)}
              renderEntry={(entry) => (
                <OperationRow
                  key={entry.id}
                  title={entry.title ?? entry.volume_title ?? `Download ${entry.id}`}
                  meta={entry.task_label ?? progressLabel(entry)}
                  tone="info"
                  badge={entry.status ?? 'downloading'}
                />
              )}
            />
          </Card>
        </section>

        <section className={styles.section} aria-labelledby="recent-activity-heading">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionKicker}>History</span>
              <h2 id="recent-activity-heading" className={styles.sectionTitle}>Recent Activity</h2>
            </div>
            <Link to="/activity/history" className={styles.sectionLink}>
              View all
            </Link>
          </div>
          <Card className={styles.sectionCard}>
            {historyEntries.length === 0 ? (
              <div className={styles.empty}>No recent activity</div>
            ) : (
              <div className={styles.listItems}>
                {historyEntries.map((entry) => (
                  <OperationRow
                    key={entry.id}
                    title={entry.title}
                    meta={`${entry.source || 'Unknown source'} · ${new Date(entry.downloaded_at).toLocaleDateString()}`}
                    tone={entry.state === 'downloaded' ? 'success' : entry.state === 'failed' ? 'danger' : 'neutral'}
                    badge={entry.state}
                  />
                ))}
              </div>
            )}
          </Card>
        </section>
          </div>
        </div>

        <div className={styles.shelfGrid}>
          <CoverShelf title="Comics Recently Added" badge="Comics" empty="No comics yet" volumes={(comicRecent ?? []).slice(0, 3)} to="/comics" />
          <CoverShelf title="Manga Recently Added" badge="Manga" empty="No manga yet" volumes={(mangaRecent ?? []).slice(0, 3)} to="/manga" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, meta, tone, to, search }: { label: string; value: number | null; meta: string; tone: 'danger' | 'info' | 'success' | 'warning'; to: string; search?: Record<string, unknown> }) {
  return (
    <Link to={to} search={search as never} className={styles.metricLink}>
      <Card className={`${styles.metricCard} ${styles[`metric-${tone}`]}`}>
        <span className={styles.metricValue}>{value === null ? <MetricSkeleton label={label} /> : value}</span>
        <span className={styles.metricLabel}>{label}</span>
        <span className={styles.metricMeta}>{meta}</span>
      </Card>
    </Link>
  );
}

function TriageRow({ label, value, to, search }: { label: string; value: number | null; to: string; search?: Record<string, unknown> }) {
  return (
    <Link to={to} search={search as never} className={styles.triageRow}>
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </Link>
  );
}

function OperationList<T>({ title, empty, entries, renderEntry }: { title: string; empty: string; entries: T[]; renderEntry: (entry: T) => React.ReactNode }) {
  return (
    <div className={styles.operationBlock}>
      <h3>{title}</h3>
      {entries.length === 0 ? <div className={styles.empty}>{empty}</div> : <div className={styles.listItems}>{entries.map(renderEntry)}</div>}
    </div>
  );
}

function OperationRow({ title, meta, tone, badge }: { title: string; meta: string; tone: 'success' | 'danger' | 'info' | 'neutral'; badge: string }) {
  return (
    <div className={styles.listRow}>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowMeta}>{meta}</span>
      </div>
      <Badge tone={tone}>{badge}</Badge>
    </div>
  );
}

function CoverShelf({ title, badge, empty, volumes, to }: { title: string; badge: string; empty: string; volumes: VolumeCard[]; to: '/comics' | '/manga' }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          <span className={styles.sectionBadge}>{badge}</span>{' '}
          {title.replace(`${badge} `, '')}
        </h2>
        <Link to={to} className={styles.sectionLink}>
          View all
        </Link>
      </div>
      {volumes.length === 0 ? (
        <Card className={styles.emptyCard}>
          <div className={styles.empty}>{empty}</div>
        </Card>
      ) : (
        <div className={styles.coverGrid}>
          {volumes.map((v) => (
            <Card key={v.id} className={styles.coverCard}>
              <Link to="/volumes/$volumeId" params={{ volumeId: String(v.id) }} className={styles.coverLink} aria-label={`Open ${v.title}`}>
                <AuthenticatedImage endpoint={`volumes/${v.id}/cover`} alt={`Cover for ${v.title}`} className={styles.coverImg} loading="lazy" />
              </Link>
              <div className={styles.coverInfo}>
                <Link to="/volumes/$volumeId" params={{ volumeId: String(v.id) }} className={styles.coverTitle}>
                  {v.title}
                </Link>
                <span className={styles.coverMeta}>
                  {v.year ?? ''}{v.year && v.publisher ? ' · ' : ''}{v.publisher ?? ''}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function searchTaskTitle(entry: DashboardSearchTask) {
  if (entry.volume_title && entry.issue_number != null) return `${entry.volume_title} #${entry.issue_number}`;
  if (entry.volume_title) return entry.volume_title;
  return entry.display_title;
}

function searchTaskMeta(entry: DashboardSearchTask) {
  const progress = entry.progress;
  if (progress?.total_count) return `${progress.processed_count ?? 0}/${progress.total_count} searched`;
  return entry.message || 'Waiting to search';
}

function progressLabel(entry: QueueSummaryEntry) {
  if (entry.progress_is_percent && typeof entry.progress === 'number') return `${Math.round(entry.progress)}% complete`;
  return 'Download queued';
}

function sectionMetric(summary: DashboardSummary | undefined, section: 'comic' | 'manga', key: keyof DashboardSummary['library']['sections']['comic']) {
  return summary?.library.sections[section][key] ?? null;
}

function MetricSkeleton({ label }: { label: string }) {
  return <span className={styles.metricSkeleton} aria-label={`Loading ${label}`} />;
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}
