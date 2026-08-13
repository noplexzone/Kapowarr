import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import type { ShouldBlockFn } from '@tanstack/react-router';
import { Button, Notice } from '@/components/primitives';
import { DEFAULT_THEME, useShellStore } from '@/platform/shell/store';
import { settingsQueryOptions, updateSettings, SETTINGS_KEY, suwayomiSourcesQueryOptions } from '../-settings.api';
import type { AllSettings } from '../-settings.types';
import { getChangedSettings, requiresRestart } from '../-settings-change';
import { validateChangedSettings } from '../-settings-validation';
import { SETTINGS_CATEGORIES, SettingsCategoryPanel } from './settings-category-panels';
import type { SettingsCategory } from './settings-category-panels';
import { ExternalClientsSection, NZBIndexersSection, RemoteMappingsSection, RootFoldersSection } from './settings-service-editors';
import { SettingsDirtyStateProvider, useSettingsDirtySource, useSettingsDirtyState } from './settings-dirty-state';
import { SettingsSection } from './settings-field';
import styles from './settings-page.module.css';

export function SettingsPage(props: { category?: SettingsCategory; onCategoryChange?: (category: SettingsCategory) => void }) {
  return <SettingsDirtyStateProvider><SettingsPageContent {...props} /></SettingsDirtyStateProvider>;
}

function SettingsPageContent({ category = 'general', onCategoryChange }: { category?: SettingsCategory; onCategoryChange?: (category: SettingsCategory) => void }) {
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const [baseline, setBaseline] = useState<AllSettings>(() => ({ ...settings }));
  const [form, setForm] = useState<AllSettings>(() => ({ ...settings }));
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof AllSettings, string>>>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [restartWarning, setRestartWarning] = useState(false);
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || DEFAULT_THEME);
  const { data: suwayomiSourcesData, isFetching: suwayomiSourcesFetching } = useQuery({ ...suwayomiSourcesQueryOptions(), enabled: Boolean(form.suwayomi_base_url) });
  const changedSettings = useMemo(() => getChangedSettings(form, baseline), [form, baseline]);
  const topLevelDirtyCount = Object.keys(changedSettings).length;
  useSettingsDirtySource('settings-form', topLevelDirtyCount > 0, { label: 'settings' });
  const { dirtySources } = useSettingsDirtyState();
  const childDirtyCount = dirtySources.filter(source => source.label !== 'settings').length;
  const dirtyCount = topLevelDirtyCount + childDirtyCount;
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
  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? SETTINGS_CATEGORIES.filter(item => `${item.label} ${item.description} ${item.searchText}`.toLowerCase().includes(query)) : SETTINGS_CATEGORIES;
  }, [search]);
  const activeCategory = SETTINGS_CATEGORIES.find(item => item.id === category) ?? SETTINGS_CATEGORIES[0];
  const dirtyByCategory = useMemo(() => new Map(dirtySources.filter(source => source.category).map(source => [source.category, source.label])), [dirtySources]);

  const mutation = useMutation({
    mutationFn: (data: Partial<AllSettings>) => updateSettings(data),
    onSuccess: (_, submitted) => {
      setBaseline(previous => ({ ...previous, ...submitted }));
      setRestartWarning(requiresRestart(submitted));
      setSavedMsg('Settings saved successfully.');
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  function set<K extends keyof AllSettings>(key: K, value: AllSettings[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
    setSavedMsg('');
  }
  const selectCategory = (next: SettingsCategory) => onCategoryChange?.(next);
  const handleSearch = (value: string) => {
    setSearch(value);
  };
  const handleSave = () => {
    const validation = validateChangedSettings(changedSettings);
    if (!validation.data) { setErrors(validation.errors); return; }
    const willRestart = requiresRestart(validation.data);
    if (willRestart && !window.confirm('Apply hosting changes? Kapowarr will restart and may be briefly unavailable.')) return;
    mutation.mutate(validation.data);
  };
  const discard = () => { setForm({ ...baseline }); setErrors({}); setSavedMsg(''); setRestartWarning(false); };
  const setTheme = (value: string) => {
    setThemeState(value); localStorage.setItem('kapowarr-theme', value); document.documentElement.dataset.theme = value; useShellStore.getState().setTheme(value);
  };

  let content;
  if (category === 'root-folders') content = <SettingsSection title="Root Folders"><RootFoldersSection /></SettingsSection>;
  else if (category === 'indexers') content = <SettingsSection title="Indexers"><NZBIndexersSection /></SettingsSection>;
  else if (category === 'download-clients') content = <SettingsSection title="Download Clients"><ExternalClientsSection /></SettingsSection>;
  else if (category === 'remote-mappings') content = <SettingsSection title="Remote Path Mappings"><RemoteMappingsSection /></SettingsSection>;
  else content = <SettingsCategoryPanel category={category} form={form} set={set} errors={errors} theme={theme} setTheme={setTheme} suwayomiSources={suwayomiSourcesData?.sources ?? []} suwayomiSourcesLoading={suwayomiSourcesFetching} />;

  return <div className={styles.page}>
    <h1 className={styles.srOnly}>Settings</h1>
    <div className={styles.toolbar}>
      <div className={styles.currentCategory}><strong>{activeCategory.label}</strong><span>{activeCategory.description}</span><em className={styles.dirtyState} role="status">{dirtyCount ? `${dirtyCount} unsaved ${dirtyCount === 1 ? 'change' : 'changes'}` : 'All changes saved'}</em></div>
      <div className={styles.toolbarRight}>
        <Button variant="secondary" onClick={discard} disabled={!topLevelDirtyCount || mutation.isPending}>Discard</Button>
        <Button variant="primary" onClick={handleSave} disabled={!topLevelDirtyCount || mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save Changes'}</Button>
      </div>
    </div>
    {mutation.isError && <Notice tone="danger">{mutation.error instanceof Error ? mutation.error.message : 'Failed to save settings'}</Notice>}
    {savedMsg && <Notice tone="success">{savedMsg}</Notice>}
    {restartWarning && <Notice tone="warning">Server will restart to apply hosting changes (host, port, URL base, or proxy).</Notice>}
    <div className={styles.settingsSearch}><label htmlFor="settings-search">Search settings</label><input id="settings-search" className={styles.input} type="search" value={search} onChange={event => handleSearch(event.target.value)} placeholder="Search labels and help text" /></div>
    <nav className={styles.categoryNav} aria-label="Settings categories">
      {filteredCategories.map(item => {
        const dirtyLabel = dirtyByCategory.get(item.id);
        return <button key={item.id} type="button" aria-current={item.id === category ? 'page' : undefined} className={item.id === category ? styles.categoryActive : styles.categoryButton} onClick={() => selectCategory(item.id)}>
          <span>{item.label}</span>
          <small>{item.description}</small>
          {dirtyLabel && <em>Unsaved {dirtyLabel}</em>}
        </button>;
      })}
      {filteredCategories.length === 0 && <span className={styles.emptyList}>No settings match “{search}”.</span>}
    </nav>
    {content}
  </div>;
}
