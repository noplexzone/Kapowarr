import { describe, expect, it } from 'vitest';
import { createRuntimeConfig, normalizeUrlBase } from './runtime-config';

describe('runtime URL configuration', () => {
  it('normalizes the root deployment', () => {
    expect(normalizeUrlBase('/')).toBe('');
    expect(createRuntimeConfig('')).toEqual(expect.objectContaining({
      urlBase: '',
      routerBasePath: '/',
      apiBase: '/api/',
      socketPath: '/api/socket.io',
      manifestUrl: '/manifest.json',
      serviceWorkerUrl: '/sw.js',
      serviceWorkerScope: '/',
    }));
  });

  it('uses one normalized reverse-proxy base for every runtime URL', () => {
    expect(createRuntimeConfig('kapowarr/')).toEqual(expect.objectContaining({
      urlBase: '/kapowarr',
      routerBasePath: '/kapowarr',
      apiBase: '/kapowarr/api/',
      socketPath: '/kapowarr/api/socket.io',
      manifestUrl: '/kapowarr/manifest.json',
      faviconUrl: '/kapowarr/favicon.svg',
      serviceWorkerUrl: '/kapowarr/sw.js',
      serviceWorkerScope: '/kapowarr/',
    }));
  });
});
