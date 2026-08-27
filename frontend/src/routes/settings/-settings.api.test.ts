import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { delete: vi.fn(), put: vi.fn() },
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import {
  cancelMetronBackfill,
  deleteExternalClient,
  deleteNzbIndexer,
  deleteRemoteMapping,
  deleteRootFolder,
} from './-settings.api';

beforeEach(() => vi.clearAllMocks());

describe('destructive settings adapters', () => {
  it('unwraps every delete response so backend rejections reach the UI', async () => {
    const del = vi.mocked(apiClient.delete);
    const parse = vi.mocked(readJson);
    const responses = Array.from({ length: 4 }, () => ({} as Response));
    responses.forEach(response => del.mockResolvedValueOnce(response as never));
    parse.mockResolvedValue(undefined);

    await deleteNzbIndexer(1);
    await deleteExternalClient(2);
    await deleteRemoteMapping(3);
    await deleteRootFolder(4);

    expect(del.mock.calls.map(call => call[0])).toEqual([
      'nzbindexers/1',
      'externalclients/2',
      'remotemapping/3',
      'rootfolder/4',
    ]);
    expect(parse.mock.calls.map(call => call[0])).toEqual(responses);
  });

  it('cancels a Metron backfill through the delete endpoint', async () => {
    const response = {} as Response;
    vi.mocked(apiClient.delete).mockResolvedValue(response as never);
    vi.mocked(readJson).mockResolvedValue({ status: 'cancelling' });

    await expect(cancelMetronBackfill()).resolves.toEqual({ status: 'cancelling' });

    expect(apiClient.delete).toHaveBeenCalledWith('metadata/metron/backfill');
    expect(readJson).toHaveBeenCalledWith(response);
  });
});
