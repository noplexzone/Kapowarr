import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card, Badge, Progress } from '@/components/primitives';
import {
  navBadgesQueryOptions,
  volumeStatsQueryOptions,
  dashboardQueueQueryOptions,
  dashboardHistoryQueryOptions,
  dashboardTasksQueryOptions,
} from '../-dashboard.api';
import styles from './dashboard-page.module.css';

export function DashboardPage() {
  const { data: badges } = useQuery(navBadgesQueryOptions());
  const { data: stats } = useQuery(volumeStatsQueryOptions());
  const { data: queueData } = useQuery(dashboardQueueQueryOptions());
  const { data: historyData } = useQuery(dashboardHistoryQueryOptions());
  const { data: tasksData } = useQuery(dashboardTasksQueryOptions());

  const queueItems = Array.isArray(queueData) ? queueData : [];
  const historyEntries = (historyData?.entries ?? []).slice(0, 5);
  const recentTasks = (Array.isArray(tasksData) ? tasksData : []).slice(0, 3);

  const totalVolumes = stats?.volumes ?? badges?.volumes ?? null;
  const downloadedIssues = stats?.downloaded_issues ?? null;
  const wantedIssues = stats != null ? Math.max(0, stats.issues - stats.downloaded_issues) : null;
  const queueCount = queueItems.length > 0 ? queueItems.length : (badges?.queue ?? null);

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Dashboard</h1>

      <div className={styles.statsRow}>
        <Card className={styles.statCard}>
          <div className={styles.statValue}>{totalVolumes ?? '—'}</div>
          <div className={styles.statLabel}>Total Volumes</div>
        </Card>
        <Card className={styles.statCard}>
          <div className={styles.statValue}>{downloadedIssues ?? '—'}</div>
          <div className={styles.statLabel}>Downloaded Issues</div>
        </Card>
        <Card className={styles.statCard}>
          <div className={styles.statValue}>{queueCount ?? '—'}</div>
          <div className={styles.statLabel}>Queue Count</div>
        </Card>
        <Card className={styles.statCard}>
          <div className={styles.statValue}>{wantedIssues ?? '—'}</div>
          <div className={styles.statLabel}>Wanted Issues</div>
        </Card>
      </div>

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
                      <span className={styles.rowMeta}>{entry.source}</span>
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
                {queueItems.slice(0, 5).map((entry) => (
                  <div key={entry.id} className={styles.listRow}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{entry.title}</span>
                      <Progress
                        value={entry.progress_is_percent ? entry.progress : 0}
                        className={styles.queueProgress}
                      />
                    </div>
                    <Badge tone="info">{entry.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      </div>

      {recentTasks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>System Tasks</h2>
            <Link to="/system/tasks" className={styles.sectionLink}>
              View all
            </Link>
          </div>
          <Card className={styles.sectionCard}>
            <div className={styles.listItems}>
              {recentTasks.map((task) => (
                <div key={task.id} className={styles.listRow}>
                  <span className={styles.rowTitle}>{task.display}</span>
                  <Badge
                    tone={
                      task.status === 'done'
                        ? 'success'
                        : task.status === 'running'
                          ? 'info'
                          : 'neutral'
                    }
                  >
                    {task.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
