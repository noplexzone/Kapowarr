export interface MismatchItem {
  folder: string;
  file_title: string;
  cv_id?: number;
  issue_count?: number;
  status: string;
  match_type?: string;
}

export interface MismatchSelection {
  folder: string;
  cv_id: string;
  file_title: string;
}
