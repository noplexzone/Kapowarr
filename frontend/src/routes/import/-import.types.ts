export interface BulkScanItem {
  folder: string;
  cv_id?: number;
  file_title: string;
  matched: boolean;
  id_type: string | null;
  match_type: 'comicinfo' | 'title' | null;
  match_title?: string;
  year?: number;
  volume_number?: number;
  publisher?: string;
}

export interface ImportSelection {
  folder: string;
  cv_id: string;
  file_title: string;
}
