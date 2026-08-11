import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient, readJson } from '@/app/api-client';
import type { SearchHistoryEntry, SearchHistoryResponse, SearchOutcome } from './-search-history.types';

export const SEARCH_HISTORY_KEY = ['activity', 'search-history'] as const;

const issueOutcomeSchema = z.object({
  issue_number: z.union([z.string(), z.number()]).nullable().optional(),
  matched: z.boolean().optional(),
  display_title: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
}).passthrough();

const detailsSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  total_found: z.number().int().nonnegative().optional(),
  per_issue: z.array(issueOutcomeSchema).optional(),
  downloads: z.array(z.unknown()).optional(),
  results: z.array(z.object({ success: z.boolean().optional() }).passthrough()).optional(),
  per_volume: z.array(z.object({
    success: z.boolean().optional(),
    volume_title: z.string().nullable().optional(),
    total_found: z.number().int().nonnegative().optional(),
    download_count: z.number().int().nonnegative().optional(),
    per_issue: z.array(issueOutcomeSchema).optional(),
    message: z.string().nullable().optional(),
  }).passthrough()).optional(),
}).passthrough();

const rawTaskHistoryEntrySchema = z.object({
  task_name: z.string(),
  display_title: z.string(),
  run_at: z.number(),
  queued_at: z.number().nullable().optional(),
  started_at: z.number().nullable().optional(),
  volume_id: z.number().int().nullable().optional(),
  volume_title: z.string().nullable().optional(),
  issue_id: z.number().int().nullable().optional(),
  issue_number: z.union([z.string(), z.number()]).nullable().optional(),
  details: detailsSchema,
});

const taskHistoryResponseSchema = z.object({
  entries: z.array(rawTaskHistoryEntrySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
});

type RawTaskHistoryEntry = z.infer<typeof rawTaskHistoryEntrySchema>;

export function searchHistoryQueryOptions(offset: number) {
  return queryOptions({
    queryKey: [...SEARCH_HISTORY_KEY, offset],
    queryFn: () => getSearchHistory(offset),
    staleTime: 10_000,
  });
}

async function getSearchHistory(offset: number): Promise<SearchHistoryResponse> {
  const sp = new URLSearchParams({
    offset: String(offset),
    paginated: 'true',
    type: 'search',
  });
  const response = await apiClient.get('system/tasks/history', { searchParams: sp, timeout: 60_000 });
  const data = await readJson(response, taskHistoryResponseSchema);
  return {
    entries: data.entries.map(toSearchHistoryEntry),
    total: data.total,
    page_size: data.page_size,
  };
}

function toSearchHistoryEntry(raw: RawTaskHistoryEntry): SearchHistoryEntry {
  const details = raw.details ?? {};
  const perVolume = details.per_volume ?? [];
  const issues = perVolume.length > 0
    ? perVolume.flatMap((volume) => volume.per_issue ?? [])
    : (details.per_issue ?? []);
  const matchedCount = issues.filter((issue) => issue.matched).length;
  const issueCount = issues.length;
  const downloadsCount = (details.downloads?.length ?? 0)
    + (details.results?.filter((result) => result.success).length ?? 0)
    + perVolume.reduce((count, volume) => count + (volume.download_count ?? 0), 0);
  const totalFound = details.total_found
    ?? perVolume.reduce((count, volume) => count + (volume.total_found ?? 0), 0)
    ?? 0;
  const failedVolume = perVolume.find((volume) => volume.success === false);
  const failed = details.success === false || Boolean(details.error) || Boolean(failedVolume);
  const outcome = getOutcome(failed, downloadsCount, matchedCount, totalFound);
  return {
    id: `${raw.task_name}-${raw.run_at}-${raw.volume_id ?? 'all'}-${raw.issue_id ?? 'volume'}`,
    task_name: raw.task_name,
    title: searchTitle(raw),
    scope: searchScope(raw),
    run_at: raw.run_at * 1000,
    outcome,
    outcome_label: outcomeLabel(outcome),
    total_found: totalFound,
    matched_count: matchedCount,
    issue_count: issueCount,
    downloads_count: downloadsCount,
    message: details.message || failedVolume?.message || summaryText(outcome, totalFound, matchedCount, downloadsCount, issueCount),
    issues: issues.slice(0, 6).map((issue) => ({
      issue_number: String(issue.issue_number ?? '—'),
      matched: Boolean(issue.matched),
      title: issue.display_title || issue.title || 'No matching result',
      source: issue.source || '',
    })),
  };
}

function searchTitle(raw: RawTaskHistoryEntry): string {
  if (raw.task_name === 'search_all') return 'Search All';
  if (raw.volume_title && raw.issue_number != null) return `${raw.volume_title} #${raw.issue_number}`;
  return raw.volume_title || raw.display_title || 'Search';
}

function searchScope(raw: RawTaskHistoryEntry): string {
  if (raw.task_name === 'search_all') return 'All monitored volumes';
  if (raw.issue_number != null) return 'Issue search';
  return 'Volume search';
}

function getOutcome(failed: boolean, downloads: number, matches: number, totalFound: number): SearchOutcome {
  if (failed) return 'failed';
  if (downloads > 0 || matches > 0) return 'matched';
  if (totalFound > 0) return 'no_match';
  return 'no_results';
}

function outcomeLabel(outcome: SearchOutcome): string {
  switch (outcome) {
    case 'matched': return 'Matched';
    case 'no_match': return 'No matches';
    case 'no_results': return 'No results';
    case 'failed': return 'Failed';
  }
}

function summaryText(outcome: SearchOutcome, totalFound: number, matches: number, downloads: number, issues: number): string {
  if (outcome === 'matched') return `${downloads || matches} match${(downloads || matches) === 1 ? '' : 'es'} queued or selected`;
  if (outcome === 'no_match') return `${totalFound} result${totalFound === 1 ? '' : 's'} found, but none matched`;
  if (outcome === 'failed') return 'Search failed before completion';
  if (issues > 0) return `${issues} issue${issues === 1 ? '' : 's'} checked; no results found`;
  return 'No results found';
}
