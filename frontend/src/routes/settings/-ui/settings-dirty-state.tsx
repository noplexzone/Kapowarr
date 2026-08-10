import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { SettingsCategory } from './settings-category-panels';

type DirtySource = {
  category?: SettingsCategory;
  label: string;
};

type DirtyStateContextValue = {
  dirtySources: DirtySource[];
  setSourceDirty: (id: string, source: DirtySource | null) => void;
};

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);

export function SettingsDirtyStateProvider({ children }: PropsWithChildren) {
  const [sources, setSources] = useState<Record<string, DirtySource>>({});
  const setSourceDirty = useCallback((id: string, source: DirtySource | null) => {
    setSources(previous => {
      if (source) {
        const current = previous[id];
        if (current && current.category === source.category && current.label === source.label) return previous;
        return { ...previous, [id]: source };
      }
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ dirtySources: Object.values(sources), setSourceDirty }), [sources, setSourceDirty]);
  return <DirtyStateContext.Provider value={value}>{children}</DirtyStateContext.Provider>;
}

export function useSettingsDirtyState() {
  const value = useContext(DirtyStateContext);
  if (!value) throw new Error('Settings dirty state must be used inside SettingsDirtyStateProvider');
  return value;
}

export function useSettingsDirtySource(id: string, dirty: boolean, source: DirtySource) {
  const { setSourceDirty } = useSettingsDirtyState();
  useEffect(() => {
    setSourceDirty(id, dirty ? source : null);
  }, [dirty, id, setSourceDirty, source.category, source.label]);
  useEffect(() => () => setSourceDirty(id, null), [id, setSourceDirty]);
}
