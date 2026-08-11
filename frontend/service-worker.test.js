import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync('./public/sw.js', 'utf8')
  .replace('__KAPOWARR_BUILD_VERSION__', 'test-build');

function loadWorker(scope = 'https://example.test/kapowarr/') {
  const listeners = {};
  const deleted = [];
  const context = {
    URL,
    Promise,
    console,
    Request,
    fetch: vi.fn(),
    caches: {
      open: vi.fn(async () => ({ addAll: vi.fn(), put: vi.fn() })),
      match: vi.fn(),
      keys: vi.fn(async () => []),
      delete: vi.fn(async (key) => { deleted.push(key); return true; }),
    },
    self: {
      location: new URL(scope),
      registration: { scope },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener(type, handler) { listeners[type] = handler; },
    },
  };
  vm.runInNewContext(`${source}\n;globalThis.__test = { CACHE_NAME, shouldCacheRequest, isNavigationRequest };`, context);
  return { context, listeners, deleted, api: context.__test };
}

describe('Kapowarr service worker cache boundaries', () => {
  it('never intercepts API, socket, sensitive route, authenticated, or credential-bearing requests', () => {
    const { api } = loadWorker();
    const blocked = [
      new Request('https://example.test/kapowarr/api/volumes'),
      new Request('https://example.test/kapowarr/api/socket.io/?EIO=4'),
      new Request('https://example.test/kapowarr/activity/history'),
      new Request('https://example.test/kapowarr/activity/queue'),
      new Request('https://example.test/kapowarr/reader/42'),
      new Request('https://example.test/kapowarr/downloads/file.cbz'),
      new Request('https://example.test/kapowarr/settings'),
      new Request('https://example.test/kapowarr/assets/app.js?token=secret'),
      new Request('https://example.test/kapowarr/assets/app.js', { headers: { Authorization: 'Bearer secret' } }),
      { method: 'GET', url: 'https://user:secret@example.test/kapowarr/assets/app.js', headers: new Headers() },
    ];
    for (const request of blocked) expect(api.shouldCacheRequest(request)).toBe(false);
  });

  it('does not intercept API fetch events', () => {
    const { listeners } = loadWorker();
    const event = {
      request: new Request('https://example.test/kapowarr/api/settings'),
      respondWith: vi.fn(),
    };
    listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('allows only same-origin shell and static frontend assets', () => {
    const { api } = loadWorker();
    expect(api.shouldCacheRequest(new Request('https://example.test/kapowarr/'))).toBe(false);
    expect(api.shouldCacheRequest(new Request('https://example.test/kapowarr/manifest.json'))).toBe(false);
    expect(api.shouldCacheRequest(new Request('https://example.test/kapowarr/assets/app-a1b2c3.js'))).toBe(true);
    expect(api.shouldCacheRequest(new Request('https://cdn.example/app-a1b2c3.js'))).toBe(false);
  });

  it('versions its cache and deletes only stale Kapowarr cache namespaces', async () => {
    const { context, listeners, deleted, api } = loadWorker();
    context.caches.keys.mockResolvedValue([
      'kapowarr-v1',
      'kapowarr-static-v1',
      api.CACHE_NAME,
      'another-application-v1',
    ]);
    let activation;
    listeners.activate({ waitUntil(promise) { activation = promise; } });
    await activation;
    expect(api.CACHE_NAME).toBe('kapowarr-static-test-build');
    expect(deleted).toEqual(['kapowarr-v1', 'kapowarr-static-v1']);
    expect(context.self.clients.claim).toHaveBeenCalled();
  });

  it('uses network-only handling for HTML navigations', async () => {
    const { context, listeners } = loadWorker();
    const response = new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
    context.fetch.mockResolvedValue(response);
    let handled;
    const request = new Request('https://example.test/kapowarr/library', { headers: { Accept: 'text/html' } });
    listeners.fetch({ request, respondWith(promise) { handled = promise; } });
    expect(await handled).toBe(response);
    expect(context.caches.match).not.toHaveBeenCalled();
  });
});
