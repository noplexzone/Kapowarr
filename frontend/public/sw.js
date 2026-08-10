// Kapowarr PWA service worker: cache only the public, same-origin app shell.
const CACHE_PREFIX = 'kapowarr-';
const CACHE_NAME = 'kapowarr-static-v2';
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/')
  ? SCOPE_URL.pathname
  : `${SCOPE_URL.pathname}/`;
const STATIC_EXTENSIONS = /\.(?:css|js|mjs|svg|png|ico|webp|avif|woff2?)$/i;
const BLOCKED_SEGMENTS = /\/(?:api|socket\.io|cover(?:s|-proxy)?|downloads?|history|tasks?|settings)(?:\/|$)/i;
const SHELL_PATHS = [
  SCOPE_PATH,
  `${SCOPE_PATH}favicon.svg`,
  `${SCOPE_PATH}icon-192.png`,
  `${SCOPE_PATH}icon-512.png`,
  `${SCOPE_PATH}manifest.json`,
];

function shouldCacheRequest(request) {
  if (request.method !== 'GET' || request.headers.has('Authorization')) return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.username || url.password || url.search) return false;
  if (!url.pathname.startsWith(SCOPE_PATH) || BLOCKED_SEGMENTS.test(url.pathname)) return false;

  if (SHELL_PATHS.includes(url.pathname)) return true;
  if (!url.pathname.startsWith(`${SCOPE_PATH}assets/`)) return false;
  return STATIC_EXTENSIONS.test(url.pathname);
}

function canStoreResponse(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  if (response.headers.has('Set-Cookie')) return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/(?:no-store|private)/i.test(cacheControl);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_PATHS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
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
