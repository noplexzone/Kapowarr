import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card, Badge, Button } from '@/components/primitives';
import { PageHeader, StatusBanner } from '@/components/patterns';
import { getCoverUrl } from '@/routes/comics/-comics.helpers';
import {
  comicStatsQueryOptions,
  mangaStatsQueryOptions,
  recentlyAddedQueryOptions,
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
  const queueQuery = useQuery(dashboardQueueQueryOptions());
  const historyQuery = useQuery(dashboardHistoryQueryOptions());
  const comicStats = comicStatsQuery.data;
  const mangaStats = mangaStatsQuery.data;
  const comicRecent = comicRecentQuery.data;
  const mangaRecent = mangaRecentQuery.data;
  const queueData = queueQuery.data;
  const historyData = historyQuery.data;
  const hasError = [comicStatsQuery, mangaStatsQuery, comicRecentQuery, mangaRecentQuery, queueQuery, historyQuery]
    .some((query) => query.isError);
  const isRefreshing = [comicStatsQuery, mangaStatsQuery, comicRecentQuery, mangaRecentQuery, queueQuery, historyQuery]
    .some((query) => query.isFetching);

  const queueItems = Array.isArray(queueData) ? queueData : [];
  const historyEntries = (historyData?.entries ?? []).slice(0, 6);

  const comicWanted =
    comicStats != null ? Math.max(0, comicStats.issues - comicStats.downloaded_issues) : null;
  const mangaWanted =
    mangaStats != null ? Math.max(0, mangaStats.issues - mangaStats.downloaded_issues) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Dashboard"
        description="Library health, downloads, and recent additions at a glance."
        actions={
          <Button
            variant="secondary"
            disabled={isRefreshing}
            onClick={() => queryClient.invalidateQueries()}
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

      {/* ── Section stats row (Comics + Manga) ── */}
      <div className={styles.statsRow}>
        <SectionStatCard
          label="Comics"
          volumes={comicStats?.volumes ?? null}
          downloaded={comicStats?.downloaded_issues ?? null}
          wanted={comicWanted}
          accent
        />
        <SectionStatCard
          label="Manga"
          volumes={mangaStats?.volumes ?? null}
          downloaded={mangaStats?.downloaded_issues ?? null}
          wanted={mangaWanted}
        />
      </div>

      {/* ── Recent activity + Queue ── */}
      <div className={styles.gridRow}>
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

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active Queue</h2>
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
      </div>

      {/* ── Recently added ── */}
      <div className={styles.gridRow}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionBadge}>Comics</span>{' '}
              Recently Added
            </h2>
            <Link to="/comics" className={styles.sectionLink}>
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
                    <img
                      src={getCoverUrl(v.id)}
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
            <Link to="/manga" className={styles.sectionLink}>
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
                    <img
                      src={getCoverUrl(v.id)}
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

/* ── Per-section stat card ── */

function SectionStatCard({
  label,
  volumes,
  downloaded,
  wanted,
  accent,
}: {
  label: string;
  volumes: number | null;
  downloaded: number | null;
  wanted: number | null;
  accent?: boolean;
}) {
  return (
    <Card className={`${styles.statCard} ${accent ? styles.statCardAccent : ''}`}>
      <div className={styles.statSectionLabel}>{label}</div>
      <div className={styles.statSectionRow}>
        <div className={styles.statSectionItem}>
          <div className={styles.statSectionValue}>{volumes ?? '—'}</div>
          <div className={styles.statSectionDetail}>Volumes</div>
        </div>
        <div className={styles.statSectionItem}>
          <div className={styles.statSectionValue}>{downloaded ?? '—'}</div>
          <div className={styles.statSectionDetail}>Downloaded</div>
        </div>
        <div className={styles.statSectionItem}>
          <div className={styles.statSectionValue}>{wanted ?? '—'}</div>
          <div className={styles.statSectionDetail}>Wanted</div>
        </div>
      </div>
    </Card>
  );
}
