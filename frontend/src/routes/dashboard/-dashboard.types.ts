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
  files?: number;
  total_file_size?: number;
}
