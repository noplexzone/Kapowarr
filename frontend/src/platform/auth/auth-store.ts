import { create } from 'zustand';
import { setApiKey, clearApiKey, getUrlBase, readJson } from '@/app/api-client';
import { z } from 'zod';

const loginResultSchema = z.object({ api_key: z.string().min(1) });
const publicSettingsSchema = z.object({ authentication_method: z.number().int() }).passthrough();
const emptyObjectSchema = z.object({}).strict();

const API_KEY_STORAGE_KEY = 'kapowarr_api_key';

interface AuthState {
  apiKey: string | null;
  isAuthenticated: boolean;
  isChecking: boolean;
  authRequired: boolean;
  initialized: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  apiKey: null,
  isAuthenticated: false,
  isChecking: false,
  authRequired: true,
  initialized: false,

  login: async (username: string, password: string) => {
    const base = getUrlBase();
    const response = await fetch(`${base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const msg = response.status === 401 ? 'Invalid credentials' : `Login failed (${response.status})`;
      throw new Error(msg);
    }
    const data = await readJson(response, loginResultSchema);
    setApiKey(data.api_key);
    set({ apiKey: data.api_key, isAuthenticated: true });
  },

  logout: () => {
    clearApiKey();
    set({ apiKey: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    if (get().initialized || get().isChecking) return;
    set({ isChecking: true });
    try {
      const base = getUrlBase();
      const pubRes = await fetch(`${base}/api/public`);
      if (pubRes.ok) {
        const pubData = await readJson(pubRes, publicSettingsSchema);
        if (pubData.authentication_method === 0) {
          const keyResponse = await fetch(`${base}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!keyResponse.ok) throw new Error('Failed to provision API key');
          const keyData = await readJson(keyResponse, loginResultSchema);
          setApiKey(keyData.api_key);
          set({
            apiKey: keyData.api_key,
            isAuthenticated: true,
            authRequired: false,
            isChecking: false,
            initialized: true,
          });
          return;
        }
      }

      const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (!storedKey) {
        set({ isAuthenticated: false, isChecking: false, initialized: true });
        return;
      }

      const checkRes = await fetch(`${base}/api/auth/check`, {
        method: 'POST',
        headers: { 'X-Api-Key': storedKey },
      });

      if (checkRes.ok) {
        await readJson(checkRes, emptyObjectSchema);
        setApiKey(storedKey);
        set({ apiKey: storedKey, isAuthenticated: true, isChecking: false, initialized: true });
      } else {
        clearApiKey();
        set({ apiKey: null, isAuthenticated: false, isChecking: false, initialized: true });
      }
    } catch {
      set({ isChecking: false, initialized: true, isAuthenticated: false });
    }
  },
}));
