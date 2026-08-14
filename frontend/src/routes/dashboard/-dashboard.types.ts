export interface NavBadges {
  volumes: number;
  comics: number;
  manga: number;
  queue: number;
  library_import?: number;
  mismatch?: number;
}

export interface VolumeStats {
  volumes: number;
  monitored: number;
  unmonitored: number;
  issues: number;
  downloaded_issues: number;
  missing_monitored: number;
  upcoming_monitored: number;
  unmonitored_issues: number;
  failed_downloads: number;
  active_downloads: number;
  mismatches: number;
  files?: number;
  total_file_size?: number;
}

export interface VolumeCard {
  id: number;
  title: string;
  year: number | null;
  publisher: string | null;
  issue_count: number;
  issues_downloaded: number;
  section: 'comics' | 'manga';
}


export interface DashboardSearchProgress {
  processed_count?: number;
  total_count?: number | null;
  phase?: string | null;
  eta_seconds?: number | null;
  elapsed_seconds?: number | null;
  last_progress_at?: number | null;
  seconds_since_progress?: number | null;
}

export interface DashboardSearchTask {
  id: number;
  action: 'auto_search' | 'auto_search_issue' | 'search_all';
  display_title: string;
  status: string;
  message?: string | null;
  volume_id?: number | null;
  volume_title?: string | null;
  issue_id?: number | null;
  issue_number?: number | null;
  queued_at?: number | null;
  started_at?: number | null;
  progress?: DashboardSearchProgress;
}

export interface DashboardSummary {
  generated_at: string;
  library: {
    released_issues: number;
    downloaded_released_issues: number;
    completion_percentage: number | null;
    missing_monitored: number;
    upcoming_monitored: number;
    mismatches: number;
  };
  operations: {
    active_downloads: number;
    failed_downloads: number;
    active_searches: number;
  };
  sections: {
    comic: { missing_monitored: number; upcoming_monitored: number; mismatches: number };
    manga: { missing_monitored: number; upcoming_monitored: number; mismatches: number };
  };
}
