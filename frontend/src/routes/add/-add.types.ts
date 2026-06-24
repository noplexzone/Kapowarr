export interface SearchResult {
  comicvine_id: number;
  title: string;
  year: number;
  publisher: string;
  volume_number: number;
  cover_url?: string;
  cover_link?: string;
  description?: string;
  aliases?: string;
  translated?: boolean;
  id?: number;
}

export interface RootFolder {
  id: number;
  folder: string;
}
