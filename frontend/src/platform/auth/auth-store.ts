import { create } from 'zustand';
import { setApiKey, clearApiKey, getUrlBase } from '@/app/api-client';

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
    const data = await response.json() as { error: string | null; result: { api_key: string } };
    if (data.error) throw new Error(data.error);
    setApiKey(data.result.api_key);
    set({ apiKey: data.result.api_key, isAuthenticated: true });
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
        const pubData = await pubRes.json() as {
          error: string | null;
          result: { authentication_method: number };
        };
        if (pubData.result?.authentication_method === 0) {
          set({ isAuthenticated: true, authRequired: false, isChecking: false, initialized: true });
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
