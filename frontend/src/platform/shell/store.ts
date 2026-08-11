import { create } from 'zustand';

interface ShellState {
  theme: string;
  sidebarCollapsed: boolean;
  setTheme: (theme: string) => void;
  toggleSidebar: () => void;
}

export const DEFAULT_THEME = 'kapowarr-noir';
const THEME_KEY = 'hero_theme';
const LEGACY_THEME_KEY = 'kapowarr-theme';
const SIDEBAR_KEY = 'sidebar_collapsed';

function loadTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export const useShellStore = create<ShellState>((set) => ({
  theme: loadTheme(),
  sidebarCollapsed: loadSidebarCollapsed(),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(LEGACY_THEME_KEY, theme);
    set({ theme });
  },
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      return { sidebarCollapsed: next };
    }),
}));
