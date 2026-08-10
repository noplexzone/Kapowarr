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
