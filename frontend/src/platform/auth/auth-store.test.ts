import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/api-client', () => ({
  setApiKey: vi.fn(),
  clearApiKey: vi.fn(),
  getUrlBase: vi.fn(() => '/kapowarr'),
  readJson: vi.fn(),
}));

import { readJson, setApiKey } from '@/app/api-client';
import { useAuthStore } from './auth-store';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    apiKey: null,
    isAuthenticated: false,
    isChecking: false,
    authRequired: true,
    initialized: false,
  });
});

it('provisions and stores the API key for a fresh passwordless client', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true } as Response)
    .mockResolvedValueOnce({ ok: true } as Response);
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(readJson)
    .mockResolvedValueOnce({ authentication_method: 0 })
    .mockResolvedValueOnce({ api_key: 'fresh-key' });

  await useAuthStore.getState().checkAuth();

  expect(fetchMock).toHaveBeenNthCalledWith(1, '/kapowarr/api/public');
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/kapowarr/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(setApiKey).toHaveBeenCalledWith('fresh-key');
  expect(useAuthStore.getState()).toMatchObject({
    apiKey: 'fresh-key',
    isAuthenticated: true,
    authRequired: false,
    initialized: true,
  });
});
