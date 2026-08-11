import { AuthenticatedImage } from '@/components/authenticated-resource';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card, Badge, Button } from '@/components/primitives';
import { PageHeader, StatusBanner } from '@/components/patterns';
import {
  comicStatsQueryOptions,
  mangaStatsQueryOptions,
  recentlyAddedQueryOptions,
  dashboardActiveSearchesQueryOptions,
  dashboardQueueQueryOptions,
  dashboardHistoryQueryOptions,
} from '../-dashboard.api';
import styles from './dashboard-page.module.css';

export function DashboardPage() {
  const queryClient = useQueryClient();
  const comicStatsQuery = useQuery(comicStatsQueryOptions());
  const mangaStatsQuery = useQuery(mangaStatsQueryOptions());
  const comicRecentQuery = useQuery(recentlyAddedQueryOptions('comic'));
  const mangaRecentQuery = useQuery(recentlyAddedQueryOptions('manga'));
  const activeSearchesQuery = useQuery(dashboardActiveSearchesQueryOptions());
  const queueQuery = useQuery(dashboardQueueQueryOptions());
  const historyQuery = useQuery(dashboardHistoryQueryOptions());
  const comicStats = comicStatsQuery.data;
  const mangaStats = mangaStatsQuery.data;
  const comicRecent = comicRecentQuery.data;
  const mangaRecent = mangaRecentQuery.data;
  const activeSearchesData = activeSearchesQuery.data;
  const queueData = queueQuery.data;
  const historyData = historyQuery.data;
  const hasError = [comicStatsQuery, mangaStatsQuery, comicRecentQuery, mangaRecentQuery, activeSearchesQuery, queueQuery, historyQuery]
    .some((query) => query.isError);
  const isRefreshing = [comicStatsQuery, mangaStatsQuery, comicRecentQuery, mangaRecentQuery, activeSearchesQuery, queueQuery, historyQuery]
    .some((query) => query.isFetching);

  const activeSearches = Array.isArray(activeSearchesData) ? activeSearchesData : [];
  const queueItems = Array.isArray(queueData) ? queueData : [];
  const historyEntries = (historyData?.entries ?? []).slice(0, 6);


  return (
    <div className={styles.page}>
      <PageHeader
        title="Dashboard"
        description="Library health, downloads, and recent additions at a glance."
        actions={
          <Button
            variant="secondary"
            disabled={isRefreshing}
            onClick={() => Promise.all([['volumes', 'stats'], ['volumes', 'recently-added'], ['system', 'tasks', 'dashboard', 'active-searches'], ['activity', 'queue', 'dashboard'], ['activity', 'history', 'dashboard']].map(queryKey => queryClient.invalidateQueries({ queryKey })))}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh dashboard'}
          </Button>
        }
      />
      {hasError && (
        <StatusBanner error>
          Some dashboard data could not be loaded. Existing sections may be stale.
        </StatusBanner>
      )}

      <div className={styles.metricsGrid}>
        <MetricCard label="Comics missing" value={comicStats?.missing_monitored ?? null} to="/library" search={{ section: 'comic', sort: 'wanted', status: 'missing', monitoring: 'all', view: 'grid', page: 1 }} />
        <MetricCard label="Manga missing" value={mangaStats?.missing_monitored ?? null} to="/library" search={{ section: 'manga', sort: 'wanted', status: 'missing', monitoring: 'all', view: 'grid', page: 1 }} />
        <MetricCard label="Comics upcoming" value={comicStats?.upcoming_monitored ?? null} to="/library" search={{ section: 'comic', sort: 'recently_released', status: 'upcoming', monitoring: 'all', view: 'grid', page: 1 }} />
        <MetricCard label="Manga upcoming" value={mangaStats?.upcoming_monitored ?? null} to="/library" search={{ section: 'manga', sort: 'recently_released', status: 'upcoming', monitoring: 'all', view: 'grid', page: 1 }} />
        <MetricCard label="Comics unmonitored" value={comicStats?.unmonitored_issues ?? null} to="/library" search={{ section: 'comic', sort: 'title', status: 'all', monitoring: 'unmonitored', view: 'grid', page: 1 }} />
        <MetricCard label="Manga unmonitored" value={mangaStats?.unmonitored_issues ?? null} to="/library" search={{ section: 'manga', sort: 'title', status: 'all', monitoring: 'unmonitored', view: 'grid', page: 1 }} />
        <MetricCard label="Failed downloads" value={comicStats?.failed_downloads ?? null} to="/activity/history" search={{ page: 1, status: 'failed', section: 'all' }} />
        <MetricCard label="Active downloads" value={comicStats?.active_downloads ?? null} to="/activity/queue" />
        <MetricCard label="Comic mismatches" value={comicStats?.mismatches ?? null} to="/activity/mismatches" search={{ section: 'comic' }} />
        <MetricCard label="Manga mismatches" value={mangaStats?.mismatches ?? null} to="/activity/mismatches" search={{ section: 'manga' }} />
      </div>

      {/* Active searches + Downloads + Recent activity */}
      <div className={styles.activityGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active Searches</h2>
            <Link to="/activity/search-history" search={{ page: 1 }} className={styles.sectionLink}>
              View all
            </Link>
          </div>
          <Card className={styles.sectionCard}>
            {activeSearches.length === 0 ? (
              <div className={styles.empty}>No active searches</div>
            ) : (
              <div className={styles.listItems}>
                {activeSearches.slice(0, 5).map((entry) => (
                  <div key={entry.id} className={styles.listRow}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{searchTaskTitle(entry)}</span>
                      <span className={styles.rowMeta}>{searchTaskMeta(entry)}</span>
                    </div>
                    <Badge tone={entry.status === 'running' ? 'info' : 'neutral'}>{entry.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active Downloads</h2>
            <Link to="/activity/queue" className={styles.sectionLink}>
              View all
            </Link>
          </div>
          <Card className={styles.sectionCard}>
            {queueItems.length === 0 ? (
              <div className={styles.empty}>Queue is empty</div>
            ) : (
              <div className={styles.listItems}>
                {queueItems.slice(0, 5).map((entry: any) => (
                  <div key={entry.id} className={styles.listRow}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{entry.title}</span>
                    </div>
                    <Badge tone="info">{entry.status ?? 'downloading'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent Activity</h2>
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
                  <div key={entry.id} className={styles.listRow}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{entry.title}</span>
                      <span className={styles.rowMeta}>
                        {entry.source} · {new Date(entry.downloaded_at).toLocaleDateString()}
                      </span>
                    </div>
                    <Badge
                      tone={
                        entry.state === 'downloaded'
                          ? 'success'
                          : entry.state === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {entry.state}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      </div>

      {/* ── Recently added ── */}
      <div className={styles.gridRow}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionBadge}>Comics</span>{' '}
              Recently Added
            </h2>
            <Link to="/library" search={{ section: 'comic' }} className={styles.sectionLink}>
              View all
            </Link>
          </div>
          {!comicRecent || comicRecent.length === 0 ? (
            <Card className={styles.emptyCard}>
              <div className={styles.empty}>No comics yet</div>
            </Card>
          ) : (
            <div className={styles.coverGrid}>
              {comicRecent.map((v) => (
                <Card key={v.id} className={styles.coverCard}>
                  <Link
                    to="/volumes/$volumeId"
                    params={{ volumeId: String(v.id) }}
                    className={styles.coverLink}
                  >
                    <AuthenticatedImage
                      endpoint={`volumes/${v.id}/cover`}
                      alt=""
                      className={styles.coverImg}
                      loading="lazy"
                    />
                  </Link>
                  <div className={styles.coverInfo}>
                    <Link
                      to="/volumes/$volumeId"
                      params={{ volumeId: String(v.id) }}
                      className={styles.coverTitle}
                    >
                      {v.title}
                    </Link>
                    <span className={styles.coverMeta}>
                      {v.year ?? ''}
                      {v.year && v.publisher ? ' · ' : ''}
                      {v.publisher ?? ''}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionBadge}>Manga</span>{' '}
              Recently Added
            </h2>
            <Link to="/library" search={{ section: 'manga' }} className={styles.sectionLink}>
              View all
            </Link>
          </div>
          {!mangaRecent || mangaRecent.length === 0 ? (
            <Card className={styles.emptyCard}>
              <div className={styles.empty}>No manga yet</div>
            </Card>
          ) : (
            <div className={styles.coverGrid}>
              {mangaRecent.map((v) => (
                <Card key={v.id} className={styles.coverCard}>
                  <Link
                    to="/volumes/$volumeId"
                    params={{ volumeId: String(v.id) }}
                    className={styles.coverLink}
                  >
                    <AuthenticatedImage
                      endpoint={`volumes/${v.id}/cover`}
                      alt=""
                      className={styles.coverImg}
                      loading="lazy"
                    />
                  </Link>
                  <div className={styles.coverInfo}>
                    <Link
                      to="/volumes/$volumeId"
                      params={{ volumeId: String(v.id) }}
                      className={styles.coverTitle}
                    >
                      {v.title}
                    </Link>
                    <span className={styles.coverMeta}>
                      {v.year ?? ''}
                      {v.year && v.publisher ? ' · ' : ''}
                      {v.publisher ?? ''}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


function MetricCard({ label, value, to, search }: { label: string; value: number | null; to: string; search?: Record<string, unknown> }) {
  return (
    <Link to={to} search={search as never} className={styles.metricLink}>
      <Card className={styles.metricCard}>
        <span className={styles.metricValue}>{value ?? '—'}</span>
        <span className={styles.metricLabel}>{label}</span>
      </Card>
    </Link>
  );
}

function searchTaskTitle(entry: { display_title: string; volume_title?: string | null; issue_number?: number | null }) {
  if (entry.volume_title && entry.issue_number != null) return `${entry.volume_title} #${entry.issue_number}`;
  if (entry.volume_title) return entry.volume_title;
  return entry.display_title;
}

function searchTaskMeta(entry: { message?: string | null; progress?: { processed_count?: number; total_count?: number | null } }) {
  const progress = entry.progress;
  if (progress?.total_count) return `${progress.processed_count ?? 0}/${progress.total_count} searched`;
  return entry.message || 'Waiting to search';
}
