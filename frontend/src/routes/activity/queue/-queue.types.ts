export interface QueueEntry {
  id: number;
  title: string;
  volume_id: number;
  issue_id?: number;
  source_name: string;
  source_detail?: string | null;
  web_link?: string;
  web_title?: string;
  web_sub_title?: string;
  task_label?: string;
  status: string;
  size: number;
  speed: number;
  progress: number;
  progress_is_percent?: boolean;
  type?: string;
}
