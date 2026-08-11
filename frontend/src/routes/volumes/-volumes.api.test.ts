import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import {
  downloadIssue,
  downloadVolume,
  deleteRawFile,
  fetchIssueHistory,
  fetchVolumeHistory,
  manualSearchIssue,
  manualSearchVolume,
  updateVolume,
} from './-volumes.api';

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const put = vi.mocked(apiClient.put);
const del = vi.mocked(apiClient.delete);
const parse = vi.mocked(readJson);


describe('volume edit updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    put.mockResolvedValue({} as Response);
    parse.mockResolvedValue({});
  });

  it('does not send the UI-only automatic special-version token to the backend', async () => {
    await updateVolume(1264, {
      monitored: true,
      monitor_new_issues: true,
      root_folder: 1,
      volume_folder: 'X-Men Annual (1992)',
      special_version: 'auto',
    });

    expect(put).toHaveBeenCalledWith('volumes/1264', {
      json: {
        monitored: true,
        monitor_new_issues: true,
        root_folder: 1,
        volume_folder: 'X-Men Annual (1992)',
        special_version_locked: false,
      },
    });
    expect(parse).toHaveBeenCalled();
  });
});

describe('direct-download request budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({} as Response);
    post.mockResolvedValue({} as Response);
    parse.mockResolvedValue({ result: 1, fail_reason: null });
  });

  it('allows issue download admission to wait up to five minutes', async () => {
    await downloadIssue(2, 'https://example.invalid/file', false, 'Issue');

    expect(post).toHaveBeenCalledWith(
      'issues/2/download',
      expect.objectContaining({ timeout: 300000 }),
    );
  });

  it('allows volume download admission to wait up to five minutes', async () => {
    await downloadVolume(3, 'https://example.invalid/file', 'Volume');

    expect(post).toHaveBeenCalledWith(
      'volumes/3/download',
      expect.objectContaining({ timeout: 300000 }),
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
        timeout: 300000,
      }),
    );
  });

  it('preserves metadata-generated issue search when the query is blank', async () => {
    await manualSearchIssue(7, '   ');

    expect(get).toHaveBeenCalledWith(
      'issues/7/manualsearch',
      expect.objectContaining({
        searchParams: undefined,
        timeout: 300000,
      }),
    );
  });
});

describe('issue history compatibility', () => {
  it('consumes the legacy list response used by the issue dialog', async () => {
    const entries = [{ web_title: 'Saga #1', downloaded_at: 100 }];
    get.mockResolvedValue({} as Response);
    parse.mockResolvedValue(entries);

    await expect(fetchIssueHistory(7)).resolves.toEqual(entries);
    expect(get).toHaveBeenCalledWith('activity/history', {
      searchParams: { issue_id: 7 },
    });
  });
  it('requests all history records for a volume', async () => {
    const entries = [{ web_title: 'Volume bundle', downloaded_at: 101 }];
    get.mockResolvedValue({} as Response);
    parse.mockResolvedValue(entries);

    await expect(fetchVolumeHistory(3)).resolves.toEqual(entries);
    expect(get).toHaveBeenCalledWith('activity/history', {
      searchParams: { volume_id: 3 },
    });
  });

});


describe('unmatched file deletion', () => {
  it('sends only the volume-scoped server identifier', async () => {
    del.mockResolvedValue({} as Response);
    parse.mockResolvedValue({});

    await deleteRawFile(42, 'opaque-id');

    expect(del).toHaveBeenCalledWith('files/raw', {
      json: { volume_id: 42, unmatched_file_id: 'opaque-id' },
    });
    expect(parse).toHaveBeenCalled();
  });
});
