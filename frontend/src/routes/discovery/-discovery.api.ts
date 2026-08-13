import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import { discoveryVolumeSchema, storyArcSchema, storyArcDetailSchema, discoveryPageSchema } from './-discovery.types';
import type { DiscoveryVolume, DiscoverySection, DiscoveryPage } from './-discovery.types';

const discoveryItemsSchema = z.array(z.record(z.unknown()));

export function discoveryVolumeQueryOptions(type: 'upcoming' | 'new', section: DiscoverySection) {
  return queryOptions({
    queryKey: ['discovery', type, section],
    queryFn: () => apiClient.get('discovery', { searchParams: { type, section } })
      .then(res => readJson(res, discoveryItemsSchema))
      .then(items => items.map(item => normalizeDiscoveryItem(item, type))),
    staleTime: 5 * 60_000,
    refetchOnMount: false,
  });
}

export async function fetchDiscoveryVolumePage(type: 'upcoming' | 'new', section: DiscoverySection, offset: number, limit = 50): Promise<DiscoveryPage> {
  const response = await apiClient.get('discovery', {
    searchParams: { type, section, paginated: 'true', offset: String(offset), limit: String(limit) },
    timeout: 60_000,
  });
  const page = await readJson(response, discoveryPageSchema);
  return {
    ...page,
    items: page.items.map(item => normalizeDiscoveryItem(item, type)),
  };
}

export function normalizeDiscoveryItem(item: Record<string, unknown>, type: 'upcoming' | 'new'): DiscoveryVolume {
  const normalized = type === 'upcoming' ? {
    ...item,
    comicvine_id: item.volume_id ?? item.comicvine_id,
    metadata_source: item.metadata_source ?? 'comicvine',
    metadata_id: item.metadata_id ?? String(item.volume_id ?? item.comicvine_id ?? ''),
    title: item.volume_title || item.title || '',
    already_added: item.already_added ?? null,
    id: item.issue_id,
  } : {
    ...item,
    metadata_source: item.metadata_source ?? 'comicvine',
    metadata_id: item.metadata_id ?? String(item.comicvine_id ?? ''),
    title: item.title || '',
    already_added: item.already_added ?? null,
  };
  return discoveryVolumeSchema.parse(normalized);
}

export function storyArcsQueryOptions(query: string, section: DiscoverySection) {
  return queryOptions({
    queryKey: ['discovery', 'story-arcs', query, section],
    queryFn: () => apiClient.get('discovery', { searchParams: { type: 'story-arcs', query, section } })
      .then(res => readJson(res, z.array(storyArcSchema))),
    staleTime: 5 * 60_000,
    enabled: query.length >= 2,
    refetchOnMount: false,
  });
}

export function storyArcDetailQueryOptions(id: number) {
  return queryOptions({
    queryKey: ['discovery', 'story-arc', id],
    queryFn: () => apiClient.get(`discovery/story-arc/${id}`).then(res => readJson(res, storyArcDetailSchema)),
    staleTime: 5 * 60_000,
  });
}
