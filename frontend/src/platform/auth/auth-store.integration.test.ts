import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/app/runtime-config', () => ({
  runtimeConfig: {
    urlBase: 'http://localhost/kapowarr',
    apiBase: 'http://localhost/kapowarr/api',
    socketPath: 'http://localhost/kapowarr/api/socket.io',
  },
}));

import { apiClient, clearApiKey } from '@/app/api-client';
import { useAuthStore } from './auth-store';

function envelope(result: unknown): Response {
  return new Response(JSON.stringify({ error: null, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  clearApiKey();
  vi.restoreAllMocks();
  useAuthStore.setState({
    apiKey: null,
    isAuthenticated: false,
    isChecking: false,
    authRequired: true,
    initialized: false,
  });
});

it('sends the provisioned key on a fresh passwordless mutation', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.endsWith('/api/public')) {
      return envelope({ authentication_method: 0 });
    }
    if (request.url.endsWith('/api/auth')) {
      return envelope({ api_key: 'fresh-key' });
    }
    return envelope({});
  }));

  await useAuthStore.getState().checkAuth();
  await apiClient.delete('files/raw', {
    json: { volume_id: 7, unmatched_file_id: 'opaque-id' },
  });

  const mutation = requests.find(request => request.method === 'DELETE');
  expect(mutation?.headers.get('X-Api-Key')).toBe('fresh-key');
});
