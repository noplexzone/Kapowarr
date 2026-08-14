export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  anchor: string;
  sections: ChangelogSection[];
}

export interface ChangelogPayload {
  current_version: string | null;
  generated_at: string;
  entries: ChangelogEntry[];
  error: string | null;
}
