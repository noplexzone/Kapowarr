import { z } from 'zod';

export const SORT_OPTIONS = [
  'title',
  'volume_number',
  'year',
  'recently_added',
  'recently_released',
  'publisher',
  'completion',
] as const;

export const DIRECTION_OPTIONS = ['asc', 'desc'] as const;

export const FILTER_OPTIONS = ['', 'wanted', 'upcoming', 'unmonitored', 'monitored'] as const;

export const VIEW_OPTIONS = ['posters', 'table'] as const;

export const SORT_LABELS: Record<string, string> = {
  title: 'Title',
  volume_number: 'Volume Number',
  year: 'Year',
  recently_added: 'Recently Added',
  recently_released: 'Recently Released',
  publisher: 'Publisher',
  completion: 'Completion',
};

export const DIRECTION_LABELS: Record<string, string> = {
  asc: 'Sort ascending',
  desc: 'Sort descending',
};

export const COMPLETION_DIRECTION_LABELS: Record<string, string> = {
  asc: 'Lowest completion first',
  desc: 'Highest completion first',
};

export const VIEW_LABELS: Record<string, string> = {
  posters: 'Poster',
  table: 'Table',
};

export const FILTER_LABELS: Record<string, string> = {
  '': 'All',
  wanted: 'Missing',
  upcoming: 'Upcoming',
  unmonitored: 'Unmonitored Issues',
  monitored: 'Monitored',
};

export const STORAGE_KEY_SORT = 'kapowarr_sort';
export const STORAGE_KEY_VIEW = 'kapowarr_view';
export const STORAGE_KEY_FILTER = 'kapowarr_filter';
export const STORAGE_KEY_SEARCH = 'kapowarr_search';

export type SortOption = (typeof SORT_OPTIONS)[number];
export type FilterOption = (typeof FILTER_OPTIONS)[number];
export type DirectionOption = (typeof DIRECTION_OPTIONS)[number];
export type ViewOption = (typeof VIEW_OPTIONS)[number];

export const volumesSearchSchema = z.object({
  sort: z.enum(SORT_OPTIONS).default('title').catch('title'),
  filter: z.enum(FILTER_OPTIONS).default('').catch(''),
  view: z.enum(VIEW_OPTIONS).default('posters').catch('posters'),
  direction: z.enum(DIRECTION_OPTIONS).default('asc').catch('asc').optional(),
  search: z.string().optional().catch(undefined),
  offset: z.coerce.number().int().min(0).default(0).catch(0),
});

export type VolumesSearch = z.infer<typeof volumesSearchSchema>;

export type SectionType = 'comic' | 'manga';

export interface VolumeSummary {
  id: number;
  title: string;
  year: number;
  volume_number: number;
  publisher: string;
  monitored: boolean;
  root_folder: string;
  folder: string;
  special_version: string;
  progress: {
    have: number;
    total: number;
    completion?: number | null;
    upcoming?: number;
  };
  cover_url: string;
}

export interface VolumeListResponse {
  volumes: VolumeSummary[];
  total: number;
  offset: number;
  page_size: number;
}

export interface VolumeDetail extends VolumeSummary {
  description?: string;
  issues: IssueSummary[];
}

export interface IssueSummary {
  id: number;
  issue_number: string;
  issue_title?: string;
  calculated_issue_number: number;
  monitored: boolean;
  downloaded: boolean;
  release_date?: string;
}


export interface SavedFilter {
  id: number;
  section: SectionType;
  name: string;
  query: Partial<VolumesSearch>;
  created_at: number;
  updated_at: number;
}

export interface LibraryFacetItem {
  value: string;
  label?: string;
  filter?: FilterOption;
  count?: number;
}

export interface LibraryFacets {
  publishers: LibraryFacetItem[];
  years: LibraryFacetItem[];
  status: LibraryFacetItem[];
}
