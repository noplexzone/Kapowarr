import ky from 'ky';

const API_KEY_STORAGE_KEY = 'kapowarr_api_key';

function getApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

/**
 * Derive the URL base from the current page location.
 * The SPA always loads at /ui/ — everything before /ui/ is the base prefix.
 * Examples:
 *   /ui/comics       → base = ''
 *   /kapowarr/ui/    → base = '/kapowarr'
 */
export function getUrlBase(): string {
  const path = window.location.pathname;
  const uiIndex = path.indexOf('/ui/');
  if (uiIndex > 0) {
    return path.substring(0, uiIndex);
  }
  // Also handle root path when SPA redirects to /ui/
  if (path === '/' || path === '') return '';
  return '';
}

function apiPrefix(): string {
  const base = getUrlBase();
  return `${base}/api/`;
}

export const apiClient = ky.create({
  prefixUrl: typeof window !== 'undefined' ? apiPrefix() : '/api/',
  hooks: {
    beforeRequest: [
      (request) => {
        const apiKey = getApiKey();
        if (apiKey) {
          request.headers.set('X-Api-Key', apiKey);
        }
      },
    ],
  },
});

interface ApiEnvelope<T> {
  error: string | null;
  result: T;
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as ApiEnvelope<T>;

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}
