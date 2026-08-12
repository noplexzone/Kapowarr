export interface HistoryEntry {
  id: number;
  title: string;
  source: string;
  downloaded_at: number;
  state: string;
  failure_reason?: string | null;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  total: number;
  page_size: number;
}
