export interface SearchResult {
  comicvine_id: number;
  metadata_source?: 'comicvine' | 'mangadex';
  metadata_id?: string;
  metadata_language?: string;
  available_languages?: string[];
  title: string;
  year: number;
  publisher: string;
  volume_number: number;
  cover_url?: string;
  cover_link?: string;
  description?: string;
  aliases?: string;
  translated?: boolean;
  issue_count?: number;
  already_added?: number | null;
  id?: number;
}

export interface RootFolder {
  id: number;
  folder: string;
  section: 'comic' | 'manga';
}
