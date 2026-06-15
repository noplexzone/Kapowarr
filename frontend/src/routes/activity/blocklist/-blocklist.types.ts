export interface BlocklistEntry {
  id: number;
  web_link: string;
  web_title?: string;
  web_sub_title?: string;
  download_link?: string;
  reason: string;
  added_at: string;
}

export interface BlocklistResponse {
  entries: BlocklistEntry[];
  total: number;
  page_size: number;
}
