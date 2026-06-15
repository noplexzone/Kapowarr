export interface AllSettings {
  host: string;
  port: number;
  url_base: string;
  auth_password: string;
  auth_username: string;
  timezone: string;
  log_level: string;
  flaresolverr_base_url: string;
  proxy_ignored_addresses: string[];
  proxy_type: string;
  proxy_host: string;
  proxy_port: number;
  proxy_username: string;
  proxy_password: string;
  rename_downloaded_files: boolean;
  replace_illegal_characters: boolean;
  volume_folder_naming: string;
  file_naming: string;
  file_naming_empty: string;
  file_naming_special_version: string;
  file_naming_vai: string;
  volume_as_issue: boolean;
  volume_as_issue_padding: number;
  volume_regex: string;
  volume_regex_issue: string;
  long_special_version: boolean;
  volume_padding: number;
  issue_padding: number;
  create_empty_volume_folders: boolean;
  delete_empty_folders: boolean;
  unmonitor_deleted_issues: boolean;
  change_file_date: string;
  chmod_folder: string;
  chown_group: string;
  convert: boolean;
  extract_issue_ranges: boolean;
  format_preference: string[];
  comic_source_priority: string[];
  manga_source_priority: string[];
  service_preference: string[];
  download_folder: string;
  concurrent_direct_downloads: number;
  failing_download_timeout: number;
  seeding_handling: string;
  delete_completed_downloads: boolean;
  suwayomi_base_url: string;
  suwayomi_username: string;
  suwayomi_password: string;
  suwayomi_source_ids: string[];
  comicvine_api_key: string;
  date_type: string;
  [key: string]: unknown;
}

export interface NZBIndexer {
  id: number;
  name: string;
  base_url: string;
  api_key: string;
  categories: string;
  enabled: boolean;
}

export interface ExternalClient {
  id: number;
  download_type: string | number;
  client_type: string;
  title: string;
  base_url: string;
  username: string | null;
  password: string | null;
  api_token: string | null;
  category: string | null;
}

export interface ClientOption {
  tokens: string[];
  download_type: string;
}

export interface RemoteMapping {
  id: number;
  external_download_client_id: number;
  remote_path: string;
  local_path: string;
}
