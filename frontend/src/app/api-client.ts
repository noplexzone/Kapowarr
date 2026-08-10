import ky from 'ky';
import type { ZodType } from 'zod';
import { runtimeConfig } from './runtime-config';

const API_KEY_STORAGE_KEY = 'kapowarr_api_key';

export function getApiKey(): string | null {
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

export function getUrlBase(): string {
  return runtimeConfig.urlBase;
}

export const apiClient = ky.create({
  prefixUrl: runtimeConfig.apiBase,
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

export async function readJson<T>(response: Response, schema?: ZodType<T>): Promise<T> {
  const data = (await response.json()) as ApiEnvelope<unknown>;

  if (data.error) {
    throw new Error(data.error);
  }

  return schema ? schema.parse(data.result) : data.result as T;
}
