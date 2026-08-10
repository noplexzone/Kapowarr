export interface RuntimeConfig {
  urlBase: string;
  routerBasePath: string;
  apiBase: string;
  socketPath: string;
  manifestUrl: string;
  faviconUrl: string;
  icon192Url: string;
  icon512Url: string;
  serviceWorkerUrl: string;
  serviceWorkerScope: string;
  assetUrl: (path: string) => string;
}

export function normalizeUrlBase(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

export function createRuntimeConfig(value: string | null | undefined): RuntimeConfig {
  const urlBase = normalizeUrlBase(value);
  const assetUrl = (path: string) => `${urlBase}/${path.replace(/^\/+/, '')}`;

  return {
    urlBase,
    routerBasePath: urlBase || '/',
    apiBase: assetUrl('api/'),
    socketPath: assetUrl('api/socket.io'),
    manifestUrl: assetUrl('manifest.json'),
    faviconUrl: assetUrl('favicon.svg'),
    icon192Url: assetUrl('icon-192.png'),
    icon512Url: assetUrl('icon-512.png'),
    serviceWorkerUrl: assetUrl('sw.js'),
    serviceWorkerScope: `${urlBase}/`,
    assetUrl,
  };
}

function injectedUrlBase(): string {
  if (typeof document === 'undefined') return '';
  return document
    .querySelector<HTMLMetaElement>('meta[name="kapowarr-url-base"]')
    ?.content ?? '';
}

export const runtimeConfig = createRuntimeConfig(injectedUrlBase());

export function applyRuntimeDocumentUrls(): void {
  if (typeof document === 'undefined') return;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (manifest) manifest.href = runtimeConfig.manifestUrl;
  if (favicon) favicon.href = runtimeConfig.faviconUrl;
  if (appleIcon) appleIcon.href = runtimeConfig.icon192Url;
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register(runtimeConfig.serviceWorkerUrl, {
    scope: runtimeConfig.serviceWorkerScope,
    updateViaCache: 'none',
  });
}
