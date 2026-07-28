import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { post: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { downloadIssue, downloadVolume } from './-volumes.api';

const post = vi.mocked(apiClient.post);
const parse = vi.mocked(readJson);

describe('direct-download request budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
