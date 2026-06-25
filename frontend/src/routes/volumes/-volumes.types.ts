export interface IssueDetail {
  id: number;
  issue_number: string;
  title?: string;
  release_date?: string;
  monitored: boolean;
  downloaded: boolean;
  size: number;
  issue_folder?: string;
  file_ids: number[];
  filenames: string[];
}

export interface VolumeDetailFull {
  id: number;
  comicvine_id: number;
  title: string;
  year: number;
  publisher: string;
  volume_number: number;
  special_version: string;
  section: string;
  description?: string;
  site_url?: string;
  monitored: boolean;
  monitor_new_issues: boolean;
  folder: string;
  root_folder: number;
  root_folder_path: string;
  issue_count: number;
  issues_downloaded: number;
  cover?: string;
  issues: IssueDetail[];
}

export interface ManualSearchResult {
  link: string;
  display_title: string;
  source: string;
  match: boolean;
  match_issue: string | null;
}

export interface IssueHistoryEntry {
  web_link: string;
  web_title: string | null;
  web_sub_title: string | null;
  file_title: string | null;
  volume_id: number;
  issue_id: number | null;
  source: string;
  source_name: string | null;
  downloaded_at: number | null;
  success: boolean | null;
}

export interface RootFolder {
  id: number;
  folder: string;
  section: string;
  total: number;
  used: number;
  free: number;
  free_pct: number;
  is_available: boolean;
}

export interface ComicVineSearchResult {
  comicvine_id: number;
  title: string;
  year: number | null;
  volume_number: number;
  issue_count: number;
  publisher: string | null;
  description: string;
  special_version: string;
}

export interface RenameEntry {
  before: string;
  after: string;
}

export interface FileMatch {
  file_id?: number;
  filepath: string;
  issue_ids: number[];
  general_file: boolean;
  forced_match: boolean;
}

export interface IssueFile {
  id: number;
  filepath: string;
  size: number;
}

export interface CoverCandidate {
  source: string;
  manga_id: string;
  manga_title: string;
  volume: string;
  cover_id: string;
  file_name: string;
  image_url: string;
  thumbnail_url: string;
  locale?: string | null;
  description?: string | null;
}

export interface AddCoverResult {
  file_id: number;
  size: number;
}

export interface IssueData {
  id: number;
  volume_id: number;
  issue_number: string;
  title?: string;
  date?: string;
  description?: string;
  monitored: boolean;
  files: IssueFile[];
}
