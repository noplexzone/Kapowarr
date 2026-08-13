import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import type { ChangelogPayload } from './-changelog.types';

export const CHANGELOG_KEY = ['changelog'] as const;

const changelogPayloadSchema = z.object({
  current_version: z.string().nullable(),
  generated_at: z.string(),
  error: z.string().nullable(),
  entries: z.array(z.object({
    version: z.string(),
    date: z.string().nullable(),
    anchor: z.string(),
    sections: z.array(z.object({
      title: z.string(),
      items: z.array(z.string()),
    })),
  })),
});

export function changelogQueryOptions() {
  return queryOptions({
    queryKey: CHANGELOG_KEY,
    queryFn: () => apiClient.get('changelog').then((r) => readJson<ChangelogPayload>(r, changelogPayloadSchema)),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
