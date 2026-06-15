export interface DiscoveryVolume {
  comicvine_id: number;
  title: string;
  year?: number;
  publisher?: string;
  volume_number?: number;
  cover_link?: string;
  id?: number;
  already_added?: number | null;
  issue_count?: number;
  issue_number?: string;
  cover_date?: string;
  date_added?: string;
  volume_title?: string;
}

export interface StoryArc {
  id: number;
  name: string;
  issue_count?: number;
  cover_url?: string;
  description?: string;
}

export interface StoryArcDetail {
  volumes: DiscoveryVolume[];
}

export type DiscoveryType = 'upcoming' | 'new' | 'story-arcs';
export type DiscoverySection = 'comic' | 'manga';
