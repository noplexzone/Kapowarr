import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { post: vi.fn() },
  getUrlBase: vi.fn(),
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { deleteUnmatched } from './-import.api';

const post = vi.mocked(apiClient.post);
const parse = vi.mocked(readJson);

describe('deleteUnmatched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({} as Response);
    parse.mockResolvedValue(undefined);
  });

  it('posts the folder array expected by the backend and validates the response envelope', async () => {
    const folders = ['/library/Unmatched One', '/library/Unmatched Two'];

    await deleteUnmatched(folders);

    expect(post).toHaveBeenCalledWith('libraryimport/delete', { json: folders });
    expect(parse).toHaveBeenCalledWith({});
  });
});
