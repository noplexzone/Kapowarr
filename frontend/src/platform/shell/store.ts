import { create } from 'zustand';

interface ShellState {
  theme: string;
  sidebarCollapsed: boolean;
  setTheme: (theme: string) => void;
  toggleSidebar: () => void;
}

const THEME_KEY = 'hero_theme';

function loadTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) || 'batman-mode';
  } catch {
    return 'batman-mode';
  }
}

export const useShellStore = create<ShellState>((set) => ({
  theme: loadTheme(),
  sidebarCollapsed: false,
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
