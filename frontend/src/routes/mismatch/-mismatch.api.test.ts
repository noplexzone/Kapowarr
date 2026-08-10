import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from '@/app/api-client';
import { scanMismatch } from './-mismatch.api';

beforeEach(() => vi.clearAllMocks());

it('scans the legacy full volume list without treating it as a pagination envelope', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      error: null,
      result: [{
        id: 1,
        comicvine_id: 99,
        title: 'Saga',
        year: 2012,
        publisher: 'Image',
        folder: '/library/Wrong Folder (2012)',
        issue_count: 10,
        issues_downloaded: 4,
        monitored: true,
      }],
    }),
  } as unknown as Response);

  const results = [];
  for await (const item of scanMismatch('comic')) results.push(item);

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ cv_id: 99, file_title: 'Saga', status: 'unmatched' });
  expect(apiClient.get).toHaveBeenCalledWith('volumes', {
    searchParams: { section: 'comic' },
  });
});
