import { queryOptions } from '@tanstack/react-query';
import { apiClient, readJson } from '@/app/api-client';
import type { DiscoveryVolume, StoryArc, StoryArcDetail, DiscoverySection } from './-discovery.types';

export function discoveryVolumeQueryOptions(type: 'upcoming' | 'new', section: DiscoverySection) {
  return queryOptions({
    queryKey: ['discovery', type, section],
    queryFn: () =>
      apiClient
        .get('discovery', { searchParams: { type, section } })
        .then(res => readJson<DiscoveryVolume[]>(res)),
    staleTime: 5 * 60_000,
  });
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
