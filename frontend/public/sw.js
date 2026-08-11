// Kapowarr PWA service worker. The build replaces the version token.
const CACHE_PREFIX = 'kapowarr-';
const CACHE_NAME = 'kapowarr-static-__KAPOWARR_BUILD_VERSION__';
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const STATIC_EXTENSIONS = /\.(?:css|js|mjs|svg|png|ico|webp|avif|woff2?)$/i;
const BLOCKED_SEGMENTS = /\/(?:api|auth|socket\.io|cover(?:s|-proxy)?|downloads?|history|queue|tasks?|settings|reader)(?:\/|$)/i;

function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('Accept') || '').includes('text/html');
}

function shouldCacheRequest(request) {
  if (request.method !== 'GET' || isNavigationRequest(request)) return false;
  if (request.headers.has('Authorization') || request.headers.has('X-Api-Key')) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.username || url.password || url.search) return false;
  if (!url.pathname.startsWith(SCOPE_PATH) || BLOCKED_SEGMENTS.test(url.pathname)) return false;
  return url.pathname.startsWith(`${SCOPE_PATH}assets/`) && STATIC_EXTENSIONS.test(url.pathname);
}

function canStoreResponse(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  if (response.headers.has('Set-Cookie')) return false;
  return !/(?:no-store|private)/i.test(response.headers.get('Cache-Control') || '');
}

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  if (isNavigationRequest(event.request)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  if (!shouldCacheRequest(event.request)) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (canStoreResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
