export interface SystemAbout {
  version: string;
  python_version: string;
  database_version: string;
  platform: string;
  start_time?: string;
  uptime?: number;
  [key: string]: unknown;
}

export interface PerIssueEntry {
  issue_number: number | [number, number] | null;
  matched: boolean;
  display_title?: string | null;
  source?: string | null;
}

export interface DownloadEntry {
  display_title: string;
  source: string;
  issue_number: number | [number, number] | null;
  filename: string;
}

export interface DownloadResultEntry {
  title: string;
  success: boolean;
  failure_reason?: string | null;
}

export type TaskDetails =
  | { per_issue: PerIssueEntry[]; downloads: DownloadEntry[] }
  | { results: DownloadResultEntry[] };

export interface SystemTaskProgress {
  processed_count: number;
  total_count: number | null;
}

export interface SystemTask {
  id: number;
  action: string;
  display_title: string;
  status: string;
  message?: string | null;
  volume_id?: number | null;
  volume_title?: string | null;
  issue_id?: number | null;
  issue_number?: number | null;
  queued_at?: number | null;
  started_at?: number | null;
  progress?: SystemTaskProgress;
}

export interface TaskHistoryEntry {
  task_name: string;
  display_title: string;
  run_at: number | null;
  queued_at: number | null;
  started_at: number | null;
  volume_id?: number | null;
  volume_title?: string | null;
  issue_id?: number | null;
  issue_number?: number | null;
  details: TaskDetails;
}

export interface TaskPlanningEntry {
  task_name: string;
  display_name: string;
  interval: number;
  next_run: number | null;
  last_run: number | null;
}
