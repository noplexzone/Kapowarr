export type SearchOutcome = 'matched' | 'no_match' | 'no_results' | 'failed';

export interface SearchHistoryIssueOutcome {
  issue_number: string;
  matched: boolean;
  title: string;
  source: string;
}

export interface SearchHistoryEntry {
  id: string;
  task_name: string;
  title: string;
  scope: string;
  volume_id?: number | null;
  run_at: number;
  outcome: SearchOutcome;
  outcome_label: string;
  total_found: number;
  matched_count: number;
  issue_count: number;
  downloads_count: number;
  message: string;
  queries: string[];
  issues: SearchHistoryIssueOutcome[];
}

export interface SearchHistoryResponse {
  entries: SearchHistoryEntry[];
  total: number;
  page_size: number;
}
