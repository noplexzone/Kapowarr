import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import type { ShouldBlockFn } from '@tanstack/react-router';
import { runtimeConfig } from '@/app/runtime-config';
import { Notice } from '@/components/primitives';
import { DEFAULT_THEME, useShellStore } from '@/platform/shell/store';
import { settingsQueryOptions, updateSettings, SETTINGS_KEY, suwayomiSourcesQueryOptions } from '../-settings.api';
import type { AllSettings } from '../-settings.types';
import { requiresRestart } from '../-settings-change';
import { validateChangedSettings } from '../-settings-validation';
import { SETTINGS_CATEGORIES, SettingsCategoryPanel } from './settings-category-panels';
import type { SettingsCategory } from './settings-category-panels';
import { ExternalClientsSection, NZBIndexersSection, RemoteMappingsSection, RootFoldersSection } from './settings-service-editors';
import { SettingsDirtyStateProvider, useSettingsDirtyState } from './settings-dirty-state';
import { SettingsSection } from './settings-field';
import styles from './settings-page.module.css';

export function SettingsPage(props: { category?: SettingsCategory; onCategoryChange?: (category: SettingsCategory) => void }) {
  return <SettingsDirtyStateProvider><SettingsPageContent {...props} /></SettingsDirtyStateProvider>;
}

function SettingsPageContent({ category = 'general', onCategoryChange }: { category?: SettingsCategory; onCategoryChange?: (category: SettingsCategory) => void }) {
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const [form, setForm] = useState<AllSettings>(() => ({ ...settings }));
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof AllSettings, string>>>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [restartWarning, setRestartWarning] = useState(false);
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<keyof AllSettings, string>>>({});
  const saveTimers = useRef<Partial<Record<keyof AllSettings, ReturnType<typeof setTimeout>>>>({});
  const saveSeq = useRef<Partial<Record<keyof AllSettings, number>>>({});
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || DEFAULT_THEME);
  const { data: suwayomiSourcesData, isFetching: suwayomiSourcesFetching } = useQuery({ ...suwayomiSourcesQueryOptions(), enabled: Boolean(form.suwayomi_base_url) });
  const pendingFieldCount = Object.values(fieldStatus).filter(value => value === 'Saving…' || value === 'Could not save').length;
  const { dirtySources } = useSettingsDirtyState();
  const childDirtyCount = dirtySources.filter(source => source.label !== 'settings').length;
  const dirtyCount = pendingFieldCount + childDirtyCount;
  const shouldBlockNavigation = useCallback<ShouldBlockFn>(({ current, next }) => {
    const staysInSettings = current.pathname.startsWith('/settings') && next.pathname.startsWith('/settings');
    const categoryFromPath = next.pathname.split('/')[2];
    const nextCategory = (categoryFromPath || (next.search as { category?: SettingsCategory }).category) as SettingsCategory | undefined;
    const sourcesAtRisk = staysInSettings
      ? dirtySources.filter((source) => source.category && source.category !== nextCategory)
      : dirtySources;
    if (sourcesAtRisk.length === 0) return false;
    const labels = [...new Set(sourcesAtRisk.map(source => source.label))].join(' and ');
    return !window.confirm(`Continue and discard unsaved ${labels} changes?`);
  }, [dirtySources]);
  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: dirtySources.length > 0,
    disabled: dirtySources.length === 0,
  });
  useEffect(() => () => {
    Object.values(saveTimers.current).forEach(timer => { if (timer) clearTimeout(timer); });
  }, []);
  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? SETTINGS_CATEGORIES.filter(item => `${item.label} ${item.description} ${item.searchText}`.toLowerCase().includes(query)) : SETTINGS_CATEGORIES;
  }, [search]);
  const activeCategory = SETTINGS_CATEGORIES.find(item => item.id === category) ?? SETTINGS_CATEGORIES[0];
  const dirtyByCategory = useMemo(() => new Map(dirtySources.filter(source => source.category).map(source => [source.category, source.label])), [dirtySources]);

  const saveField = useCallback(<K extends keyof AllSettings>(key: K, value: AllSettings[K]) => {
    if (key === 'metron_api_token' && value === form.metron?.token_masked) return;
    const validation = validateChangedSettings({ [key]: value } as Partial<AllSettings>);
    if (!validation.data) {
      setErrors(previous => ({ ...previous, ...validation.errors }));
      setFieldStatus(previous => ({ ...previous, [key]: 'Could not save' }));
      return;
    }
    const seq = (saveSeq.current[key] ?? 0) + 1;
    saveSeq.current[key] = seq;
    setFieldStatus(previous => ({ ...previous, [key]: 'Saving…' }));
    updateSettings(validation.data)
      .then(() => {
        if (seq !== saveSeq.current[key]) return;
        if (requiresRestart(validation.data)) setRestartWarning(true);
        setSavedMsg('Saved');
        setFieldStatus(previous => ({ ...previous, [key]: 'Saved' }));
        void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      })
      .catch(() => {
        if (seq !== saveSeq.current[key]) return;
        setFieldStatus(previous => ({ ...previous, [key]: 'Could not save' }));
      });
  }, [form.metron?.token_masked, queryClient]);

  function set<K extends keyof AllSettings>(key: K, value: AllSettings[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
    setSavedMsg('');
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    setFieldStatus(previous => ({ ...previous, [key]: 'Saving…' }));
    const immediate = typeof value === 'boolean';
    saveTimers.current[key] = setTimeout(() => saveField(key, value), immediate ? 0 : 600);
  }
  const saveNow = <K extends keyof AllSettings>(key: K) => {
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveField(key, form[key] as AllSettings[K]);
  };
  const selectCategory = (next: SettingsCategory) => onCategoryChange?.(next);
  const handleSearch = (value: string) => {
    setSearch(value);
  };
  const setTheme = (value: string) => {
    setThemeState(value); localStorage.setItem('kapowarr-theme', value); document.documentElement.dataset.theme = value; useShellStore.getState().setTheme(value);
  };

  let content;
  if (category === 'root-folders') content = <SettingsSection title="Root Folders"><RootFoldersSection /></SettingsSection>;
  else if (category === 'indexers') content = <SettingsSection title="Indexers"><NZBIndexersSection /></SettingsSection>;
  else if (category === 'download-clients') content = <SettingsSection title="Download Clients"><ExternalClientsSection /></SettingsSection>;
  else if (category === 'remote-mappings') content = <SettingsSection title="Remote Path Mappings"><RemoteMappingsSection /></SettingsSection>;
  else content = <SettingsCategoryPanel category={category} form={form} set={set} saveNow={saveNow} fieldStatus={fieldStatus} errors={errors} theme={theme} setTheme={setTheme} suwayomiSources={suwayomiSourcesData?.sources ?? []} suwayomiSourcesLoading={suwayomiSourcesFetching} />;

  return <div className={styles.page}>
    <h1 className={styles.srOnly}>Settings</h1>
    <div className={styles.toolbar}>
      <div className={styles.currentCategory}><strong>{activeCategory.label}</strong><span>{activeCategory.description}</span><em className={styles.dirtyState} role="status">{dirtyCount ? `${dirtyCount} pending ${dirtyCount === 1 ? 'item' : 'items'}` : 'All changes saved'}</em></div>
      <div className={styles.toolbarRight}>
        <span className={styles.dirtyState}>Auto-save enabled</span>
      </div>
    </div>
    {savedMsg && <Notice tone="success">{savedMsg}</Notice>}
    {restartWarning && <Notice tone="warning">Restart required to apply hosting changes. <button type="button" onClick={() => fetch('/api/system/power/restart', { method: 'POST' })}>Restart now</button> <button type="button" onClick={() => setRestartWarning(false)}>Later</button></Notice>}
    <div className={styles.settingsSearch}><label htmlFor="settings-search">Search settings</label><input id="settings-search" className={styles.input} type="search" value={search} onChange={event => handleSearch(event.target.value)} placeholder="Search labels and help text" /></div>
    <nav className={styles.categoryNav} aria-label="Settings categories">
      {filteredCategories.map(item => {
        const dirtyLabel = dirtyByCategory.get(item.id);
        return <button key={item.id} type="button" className={item.id === category ? styles.categoryActive : styles.categoryButton} onClick={() => selectCategory(item.id)}>
          <span>{item.label}</span>
          <small>{item.description}</small>
          {dirtyLabel && <em>Unsaved {dirtyLabel}</em>}
        </button>;
      })}
      {filteredCategories.length === 0 && <span className={styles.emptyList}>No settings match “{search}”.</span>}
    </nav>
    {content}
    <SettingsSection title="About">
      <p>Review packaged release notes and the running Kapowarr version.</p>
      <a href={runtimeConfig.assetUrl('changelog')}>Open changelog</a>
    </SettingsSection>
  </div>;
}
