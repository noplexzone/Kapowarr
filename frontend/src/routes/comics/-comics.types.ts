import { z } from 'zod';

export const SORT_OPTIONS = [
  'title',
  'volume_number',
  'year',
  'recently_added',
  'recently_released',
  'publisher',
  'wanted',
] as const;

export const FILTER_OPTIONS = ['', 'wanted', 'monitored'] as const;

export const VIEW_OPTIONS = ['posters', 'table'] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];
export type FilterOption = (typeof FILTER_OPTIONS)[number];
export type ViewOption = (typeof VIEW_OPTIONS)[number];

export const volumesSearchSchema = z.object({
  sort: z.enum(SORT_OPTIONS).default('title').catch('title'),
  filter: z.enum(FILTER_OPTIONS).default('').catch(''),
  view: z.enum(VIEW_OPTIONS).default('posters').catch('posters'),
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
  };
  cover_url: string;
}

export interface VolumeListResponse {
  volumes: VolumeSummary[];
  total: number;
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
