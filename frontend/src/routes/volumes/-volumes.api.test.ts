import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import {
  downloadIssue,
  downloadVolume,
  manualSearchIssue,
  manualSearchVolume,
} from './-volumes.api';

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const parse = vi.mocked(readJson);

describe('direct-download request budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({} as Response);
    post.mockResolvedValue({} as Response);
    parse.mockResolvedValue({ result: 1, fail_reason: null });
  });

  it('allows issue download admission to wait up to 60 seconds', async () => {
    await downloadIssue(2, 'https://example.invalid/file', false, 'Issue');

    expect(post).toHaveBeenCalledWith(
      'issues/2/download',
      expect.objectContaining({ timeout: 60000 }),
    );
  });

  it('allows volume download admission to wait up to 60 seconds', async () => {
    await downloadVolume(3, 'https://example.invalid/file', 'Volume');

    expect(post).toHaveBeenCalledWith(
      'volumes/3/download',
      expect.objectContaining({ timeout: 60000 }),
    );
  });

  it('forwards the force-match choice for volume downloads', async () => {
    await downloadVolume(3, 'https://example.invalid/file', 'Volume', true);

    expect(post).toHaveBeenCalledWith(
      'volumes/3/download',
      expect.objectContaining({
        json: expect.objectContaining({ force_match: true }),
      }),
    );
  });
});

describe('manual search query overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({} as Response);
    parse.mockResolvedValue([]);
  });

  it('sends a trimmed custom volume query', async () => {
    await manualSearchVolume(3, '  Teen Titans 2003  ');

    expect(get).toHaveBeenCalledWith(
      'volumes/3/manualsearch',
      expect.objectContaining({
        searchParams: { query: 'Teen Titans 2003' },
        timeout: 60000,
      }),
    );
  });

  it('preserves metadata-generated issue search when the query is blank', async () => {
    await manualSearchIssue(7, '   ');

    expect(get).toHaveBeenCalledWith(
      'issues/7/manualsearch',
      expect.objectContaining({
        searchParams: undefined,
        timeout: 60000,
      }),
    );
  });
});
