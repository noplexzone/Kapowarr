import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card, Badge } from '@/components/primitives';
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
  const { data: comicStats } = useQuery(comicStatsQueryOptions());
  const { data: mangaStats } = useQuery(mangaStatsQueryOptions());
  const { data: comicRecent } = useQuery(recentlyAddedQueryOptions('comic'));
  const { data: mangaRecent } = useQuery(recentlyAddedQueryOptions('manga'));
  const { data: queueData } = useQuery(dashboardQueueQueryOptions());
  const { data: historyData } = useQuery(dashboardHistoryQueryOptions());

  const queueItems = Array.isArray(queueData) ? queueData : [];
  const historyEntries = (historyData?.entries ?? []).slice(0, 6);

  const comicWanted =
    comicStats != null ? Math.max(0, comicStats.issues - comicStats.downloaded_issues) : null;
  const mangaWanted =
    mangaStats != null ? Math.max(0, mangaStats.issues - mangaStats.downloaded_issues) : null;
  const totalWanted =
    comicWanted != null && mangaWanted != null ? comicWanted + mangaWanted : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Dashboard</h1>

      {/* ── Stats row ── */}
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
        <Card className={styles.statCard}>
          <div className={styles.statValue}>{queueItems.length}</div>
          <div className={styles.statLabel}>In Queue</div>
        </Card>
        <Card className={styles.statCard}>
          <div className={styles.statValue}>{totalWanted ?? '—'}</div>
          <div className={styles.statLabel}>Wanted</div>
        </Card>
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
