import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  apiClient: { post: vi.fn() },
  getUrlBase: vi.fn(() => ''),
  readJson: vi.fn(),
}));

import { apiClient, readJson } from '@/app/api-client';
import { deleteUnmatched, scanBulk } from './-import.api';

const post = vi.mocked(apiClient.post);
const parse = vi.mocked(readJson);

async function collectScan() {
  const items = [];
  for await (const item of scanBulk()) items.push(item);
  return items;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
});

describe('scanBulk', () => {
  it('normalizes the real backend stream shape and derives matched state from cv_id', async () => {
    const stream = [
      { folder: '/library/Matched', file_title: 'Matched', cv_id: 123, id_type: 'volume', match_type: 'comicinfo' },
      { folder: '/library/Unmatched', file_title: 'Unmatched', cv_id: null, id_type: null, match_type: null },
    ].map(item => JSON.stringify(item)).join('\n') + '\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    await expect(collectScan()).resolves.toEqual([
      {
        folder: '/library/Matched',
        file_title: 'Matched',
        cv_id: 123,
        id_type: 'volume',
        match_type: 'comicinfo',
        matched: true,
      },
      {
        folder: '/library/Unmatched',
        file_title: 'Unmatched',
        id_type: null,
        match_type: null,
        matched: false,
      },
    ]);
  });

  it('ignores backend status events instead of treating them as deletable folders', async () => {
    const stream = [
      { type: 'status', message: 'Rate limited' },
      { folder: '/library/Unmatched', file_title: 'Unmatched', cv_id: null, id_type: null, match_type: null },
    ].map(item => JSON.stringify(item)).join('\n') + '\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const items = await collectScan();
    expect(items).toHaveLength(1);
    expect(items[0]?.folder).toBe('/library/Unmatched');
  });

  it.each(['series', 'book', ''])(
    'fails closed on unknown id_type %j',
    async idType => {
      const stream = JSON.stringify({
        folder: '/library/Ambiguous',
        file_title: 'Ambiguous',
        cv_id: 123,
        id_type: idType,
        match_type: 'comicinfo',
      }) + '\n';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

      await expect(collectScan()).rejects.toThrow(/invalid id_type/i);
    },
  );

  it.each([
    { cv_id: null, id_type: null, match_type: 'title' },
    { cv_id: 123, id_type: 'volume', match_type: null },
    { cv_id: null, id_type: 'volume', match_type: null },
  ])('fails closed on inconsistent match metadata: %j', async classification => {
    const stream = JSON.stringify({
      folder: '/library/Ambiguous',
      file_title: 'Ambiguous',
      ...classification,
    }) + '\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    await expect(collectScan()).rejects.toThrow(/inconsistent match classification/i);
  });

  it.each(['cv_id', 'id_type', 'match_type'] as const)(
    'fails closed when a folder result omits the %s classification field',
    async missingField => {
      const classification: Record<string, unknown> = {
        cv_id: null,
        id_type: null,
        match_type: null,
      };
      delete classification[missingField];
      const stream = JSON.stringify({
        folder: '/library/Ambiguous',
        file_title: 'Ambiguous',
        ...classification,
      }) + '\n';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

      await expect(collectScan()).rejects.toThrow(new RegExp(`missing ${missingField}`, 'i'));
    },
  );
});

describe('deleteUnmatched', () => {
  it('posts the raw folder list and validates the API envelope', async () => {
    const response = {} as Response;
    post.mockResolvedValue(response as never);
    parse.mockResolvedValue(undefined);
    const folders = ['/library/Unmatched One', '/library/Unmatched Two'];

    await deleteUnmatched(folders);

    expect(post).toHaveBeenCalledWith('libraryimport/delete', { json: folders });
    expect(parse).toHaveBeenCalledWith(response);
  });
});
