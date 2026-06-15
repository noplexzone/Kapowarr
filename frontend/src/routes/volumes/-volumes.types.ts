export interface IssueDetail {
  id: number;
  issue_number: string;
  title?: string;
  release_date?: string;
  monitored: boolean;
  downloaded: boolean;
  size: number;
  issue_folder?: string;
}

export interface VolumeDetailFull {
  id: number;
  comicvine_id: number;
  title: string;
  year: number;
  publisher: string;
  volume_number: number;
  special_version: string;
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
