import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { DiscoveryVolume, StoryArc, StoryArcDetail, DiscoverySection } from './-discovery.types';

export function discoveryVolumeQueryOptions(type: 'upcoming' | 'new', section: DiscoverySection) {
  return queryOptions({
    queryKey: ['discovery', type, section],
    queryFn: () =>
      apiClient
        .get('discovery', { searchParams: { type, section } })
        .then(res => readJson<any[]>(res))
        .then(items => items.map(item => normalizeDiscoveryItem(item, type))),
    staleTime: 5 * 60_000,
    refetchOnMount: false,
  });
}

/** Normalise both response shapes (upcoming=issues, new=volumes) into DiscoveryVolume. */
function normalizeDiscoveryItem(item: any, type: 'upcoming' | 'new'): DiscoveryVolume {
  if (type === 'upcoming') {
    // Upcoming returns issue data — remap volume_id → comicvine_id, volume_title becomes the card title
    return {
      comicvine_id: item.volume_id ?? item.comicvine_id,
      title: item.volume_title || item.title || '',
      cover_link: item.cover_link,
      already_added: item.already_added ?? null,
      issue_number: item.issue_number,
      cover_date: item.cover_date,
      id: item.issue_id,
      // Upcoming issues don't have year/publisher/issue_count from the backend
    };
  }
  // New volumes returns VolumeMetadata — already in the right shape
  return {
    comicvine_id: item.comicvine_id,
    title: item.title || '',
    year: item.year,
    publisher: item.publisher,
    volume_number: item.volume_number,
    cover_link: item.cover_link,
    already_added: item.already_added ?? null,
    issue_count: item.issue_count,
    date_added: item.date_added,
    id: item.id,
  };
}

export function storyArcsQueryOptions(query: string, section: DiscoverySection) {
  return queryOptions({
    queryKey: ['discovery', 'story-arcs', query, section],
    queryFn: () =>
      apiClient
        .get('discovery', { searchParams: { type: 'story-arcs', query, section } })
        .then(res => readJson<StoryArc[]>(res)),
    staleTime: 5 * 60_000,
    enabled: query.length >= 2,
    refetchOnMount: false,
  });
}

export function storyArcDetailQueryOptions(id: number) {
  return queryOptions({
    queryKey: ['discovery', 'story-arc', id],
    queryFn: () =>
      apiClient
        .get(`discovery/story-arc/${id}`)
        .then(res => readJson<StoryArcDetail>(res)),
    staleTime: 5 * 60_000,
  });
}
