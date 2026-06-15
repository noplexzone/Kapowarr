export interface HistoryEntry {
  id: number;
  title: string;
  source: string;
  downloaded_at: string;
  state: string;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  total: number;
  page_size: number;
}
