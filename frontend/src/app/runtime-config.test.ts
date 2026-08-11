import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeConfig, normalizeUrlBase, setupServiceWorkerUpdateHandling } from './runtime-config';

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


describe('service worker update handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates waiting workers and reloads once after an existing controller changes', () => {
    const serviceWorkerListeners = new Map<string, () => void>();
    const postMessage = vi.fn();
    const update = vi.fn();
    const registrationListeners = new Map<string, () => void>();
    const registration = {
      waiting: { postMessage },
      installing: null,
      update,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        registrationListeners.set(event, handler);
      }),
    } as unknown as ServiceWorkerRegistration;
    const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        addEventListener: vi.fn((event: string, handler: () => void) => {
          serviceWorkerListeners.set(event, handler);
        }),
      },
    });
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    setupServiceWorkerUpdateHandling(registration);

    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    serviceWorkerListeners.get('controllerchange')?.();
    serviceWorkerListeners.get('controllerchange')?.();
    expect(reload).toHaveBeenCalledTimes(1);

    if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });
});
