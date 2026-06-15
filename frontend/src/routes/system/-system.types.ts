export interface SystemAbout {
  version: string;
  python_version: string;
  database_version: string;
  platform: string;
  start_time?: string;
  uptime?: number;
  [key: string]: unknown;
}

export interface SystemTask {
  id: number;
  action: string;
  status: string;
  display: string;
  started_at: string | null;
  ended_at: string | null;
  [key: string]: unknown;
}
