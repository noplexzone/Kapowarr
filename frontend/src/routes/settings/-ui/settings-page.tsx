import { useState } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Notice } from '@/components/primitives';
import {
  settingsQueryOptions,
  updateSettings,
  SETTINGS_KEY,
  nzbIndexersQueryOptions,
  NZB_INDEXERS_KEY,
  addNzbIndexer,
  updateNzbIndexer,
  deleteNzbIndexer,
  testNzbIndexer,
  externalClientsQueryOptions,
  CLIENTS_KEY,
  clientOptionsQueryOptions,
  CLIENT_OPTIONS_KEY,
  addExternalClient,
  updateExternalClient,
  deleteExternalClient,
  testExternalClient,
  remoteMappingsQueryOptions,
  REMOTE_MAPPINGS_KEY,
  addRemoteMapping,
  updateRemoteMapping,
  deleteRemoteMapping,
} from '../-settings.api';
import type { AllSettings, NZBIndexer, ExternalClient, RemoteMapping } from '../-settings.types';
import styles from './settings-page.module.css';

const HOSTING_KEYS = new Set(['host', 'port', 'url_base']);

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const [form, setForm] = useState<AllSettings>(() => ({ ...settings }));
  const [savedMsg, setSavedMsg] = useState('');
  const [restartWarning, setRestartWarning] = useState(false);
  const [theme, setThemeState] = useState<string>(
    () => document.documentElement.dataset.theme || 'batman-mode'
  );

  const mutation = useMutation({
    mutationFn: (data: Partial<AllSettings>) => updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      setSavedMsg('Settings saved successfully.');
      setTimeout(() => setSavedMsg(''), 3000);
    },
  });

  const handleSave = () => {
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(form)) {
      if (JSON.stringify(form[key as keyof AllSettings]) !== JSON.stringify(settings[key as keyof AllSettings])) {
        changed[key] = form[key as keyof AllSettings];
      }
    }
    const willRestart = Object.keys(changed).some(k => HOSTING_KEYS.has(k));
    setRestartWarning(willRestart);
    mutation.mutate(changed as Partial<AllSettings>);
  };

  function set<K extends keyof AllSettings>(key: K, value: AllSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const setTheme = (val: string) => {
    setThemeState(val);
    localStorage.setItem('kapowarr-theme', val);
    document.documentElement.dataset.theme = val;
  };

  const str = (key: keyof AllSettings) => String((form[key] as string | number | boolean | null | undefined) ?? '');
  const num = (key: keyof AllSettings) => Number(form[key] ?? 0);
  const bool = (key: keyof AllSettings) => Boolean(form[key]);
  const arr = (key: keyof AllSettings): string[] => Array.isArray(form[key]) ? (form[key] as string[]) : [];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <div className={styles.toolbarRight}>
          {mutation.isError && <Notice tone="danger">Failed to save settings</Notice>}
          {savedMsg && <Notice tone="success">{savedMsg}</Notice>}
          <Button variant="primary" onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {restartWarning && (
        <Notice tone="warning">
          Server will restart to apply hosting changes (host, port, URL base).
        </Notice>
      )}

      <Section title="General" defaultOpen>
        <Field label="Host">
          <input className={styles.input} value={str('host')} onChange={e => set('host', e.target.value)} />
        </Field>
        <Field label="Port">
          <input className={styles.input} type="number" value={num('port')} onChange={e => set('port', Number(e.target.value))} />
        </Field>
        <Field label="URL Base">
          <input className={styles.input} value={str('url_base')} onChange={e => set('url_base', e.target.value)} />
        </Field>
        <Field label="Username">
          <input className={styles.input} value={str('auth_username')} onChange={e => set('auth_username', e.target.value)} />
        </Field>
        <Field label="Password">
          <input className={styles.input} type="password" value={str('auth_password')} onChange={e => set('auth_password', e.target.value)} />
        </Field>
        <Field label="Timezone">
          <input className={styles.input} value={str('timezone')} onChange={e => set('timezone', e.target.value)} />
        </Field>
        <Field label="Theme">
          <select className={styles.select} value={theme} onChange={e => setTheme(e.target.value)}>
            <option value="light">Light</option>
            <option value="dark-mode">Dark</option>
            <optgroup label="Superhero">
              <option value="batman-mode">Batman</option>
              <option value="spiderman-mode">Spider-Man</option>
              <option value="invincible-mode">Invincible</option>
              <option value="superman-mode">Superman</option>
              <option value="ironman-mode">Iron Man</option>
              <option value="wonderwoman-mode">Wonder Woman</option>
              <option value="flash-mode">The Flash</option>
              <option value="greenlantern-mode">Green Lantern</option>
              <option value="captainamerica-mode">Captain America</option>
            </optgroup>
          </select>
        </Field>
        <Field label="Log Level">
          <select className={styles.select} value={str('log_level')} onChange={e => set('log_level', e.target.value)}>
            <option value="DEBUG">Debug</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="ERROR">Error</option>
          </select>
        </Field>
        <Field label="FlareSolverr Base URL">
          <input className={styles.input} value={str('flaresolverr_base_url')} onChange={e => set('flaresolverr_base_url', e.target.value)} />
        </Field>
        <Field label="Proxy Ignored Addresses">
          <input className={styles.input} value={arr('proxy_ignored_addresses').join(', ')} onChange={e => set('proxy_ignored_addresses', e.target.value.split(',').map(s => s.trim()))} />
        </Field>
      </Section>

      <Section title="Media Management">
        <Field label="Volume Folder Naming">
          <input className={styles.input} value={str('volume_folder_naming')} onChange={e => set('volume_folder_naming', e.target.value)} />
        </Field>
        <Field label="File Naming">
          <input className={styles.input} value={str('file_naming')} onChange={e => set('file_naming', e.target.value)} />
        </Field>
        <Field label="File Naming (Empty)">
          <input className={styles.input} value={str('file_naming_empty')} onChange={e => set('file_naming_empty', e.target.value)} />
        </Field>
        <Field label="File Naming (Special Version)">
          <input className={styles.input} value={str('file_naming_special_version')} onChange={e => set('file_naming_special_version', e.target.value)} />
        </Field>
        <Field label="File Naming (VAI)">
          <input className={styles.input} value={str('file_naming_vai')} onChange={e => set('file_naming_vai', e.target.value)} />
        </Field>
        <ToggleField label="Volume as Issue" checked={bool('volume_as_issue')} onChange={v => set('volume_as_issue', v)} />
        <Field label="Volume as Issue Padding">
          <input className={styles.input} type="number" min={0} max={10} value={num('volume_as_issue_padding')} onChange={e => set('volume_as_issue_padding', Number(e.target.value))} />
        </Field>
        <Field label="Volume Regex">
          <input className={styles.input} value={str('volume_regex')} onChange={e => set('volume_regex', e.target.value)} />
        </Field>
        <Field label="Volume Regex (Issue)">
          <input className={styles.input} value={str('volume_regex_issue')} onChange={e => set('volume_regex_issue', e.target.value)} />
        </Field>
        <ToggleField label="Rename Downloaded Files" checked={bool('rename_downloaded_files')} onChange={v => set('rename_downloaded_files', v)} />
        <ToggleField label="Replace Illegal Characters" checked={bool('replace_illegal_characters')} onChange={v => set('replace_illegal_characters', v)} />
        <ToggleField label="Long Special Version" checked={bool('long_special_version')} onChange={v => set('long_special_version', v)} />
        <Field label="Volume Padding">
          <input className={styles.input} type="number" min={1} max={10} value={num('volume_padding')} onChange={e => set('volume_padding', Number(e.target.value))} />
        </Field>
        <Field label="Issue Padding">
          <input className={styles.input} type="number" min={1} max={10} value={num('issue_padding')} onChange={e => set('issue_padding', Number(e.target.value))} />
        </Field>
        <ToggleField label="Create Empty Volume Folders" checked={bool('create_empty_volume_folders')} onChange={v => set('create_empty_volume_folders', v)} />
        <ToggleField label="Delete Empty Folders" checked={bool('delete_empty_folders')} onChange={v => set('delete_empty_folders', v)} />
        <ToggleField label="Unmonitor Deleted Issues" checked={bool('unmonitor_deleted_issues')} onChange={v => set('unmonitor_deleted_issues', v)} />
        <Field label="Change File Date">
          <select className={styles.select} value={str('change_file_date')} onChange={e => {
            const v = e.target.value;
            set('change_file_date', v);
          }}>
            <option value="">Don't change</option>
            <option value="issue_release_date">Issue Release Date</option>
          </select>
        </Field>
        <Field label="chmod Folder">
          <input className={styles.input} value={str('chmod_folder')} onChange={e => set('chmod_folder', e.target.value)} />
        </Field>
        <Field label="chown Group">
          <input className={styles.input} value={str('chown_group')} onChange={e => set('chown_group', e.target.value)} />
        </Field>
        <ToggleField label="Convert" checked={bool('convert')} onChange={v => set('convert', v)} />
        <ToggleField label="Extract Issue Ranges" checked={bool('extract_issue_ranges')} onChange={v => set('extract_issue_ranges', v)} />
        <Field label="Format Preference">
          <input className={styles.input} value={arr('format_preference').join(', ')} onChange={e => set('format_preference', e.target.value.split(',').map(s => s.trim()))} />
        </Field>
        <Field label="Date Type">
          <select className={styles.select} value={str('date_type')} onChange={e => set('date_type', e.target.value)}>
            <option value="cover_date">Cover Date</option>
            <option value="store_date">Store Date</option>
          </select>
        </Field>
      </Section>

      <Section title="Download">
        <Field label="Comic Source Priority">
          <PriorityList value={arr('comic_source_priority')} onChange={v => set('comic_source_priority', v)} />
        </Field>
        <Field label="Manga Source Priority">
          <PriorityList value={arr('manga_source_priority')} onChange={v => set('manga_source_priority', v)} />
        </Field>
        <Field label="Service Preference">
          <input className={styles.input} value={arr('service_preference').join(', ')} onChange={e => set('service_preference', e.target.value.split(',').map(s => s.trim()))} />
        </Field>
        <Field label="Download Folder">
          <input className={styles.input} value={str('download_folder')} onChange={e => set('download_folder', e.target.value)} />
        </Field>
        <Field label="Concurrent Direct Downloads">
          <input className={styles.input} type="number" min={1} value={num('concurrent_direct_downloads')} onChange={e => set('concurrent_direct_downloads', Number(e.target.value))} />
        </Field>
        <Field label="Failing Download Timeout">
          <input className={styles.input} type="number" min={0} value={num('failing_download_timeout')} onChange={e => set('failing_download_timeout', Number(e.target.value))} />
        </Field>
        <Field label="Seeding Handling">
          <select className={styles.select} value={str('seeding_handling')} onChange={e => set('seeding_handling', e.target.value)}>
            <option value="complete">Complete (finish seeding, then move)</option>
            <option value="copy">Copy (copy while seeding, delete originals)</option>
          </select>
        </Field>
        <ToggleField label="Delete Completed Downloads" checked={bool('delete_completed_downloads')} onChange={v => set('delete_completed_downloads', v)} />
        <Field label="Suwayomi Base URL">
          <input className={styles.input} value={str('suwayomi_base_url')} onChange={e => set('suwayomi_base_url', e.target.value)} />
        </Field>
        <Field label="Suwayomi Username">
          <input className={styles.input} value={str('suwayomi_username')} onChange={e => set('suwayomi_username', e.target.value)} />
        </Field>
        <Field label="Suwayomi Password">
          <input className={styles.input} type="password" value={str('suwayomi_password')} onChange={e => set('suwayomi_password', e.target.value)} />
        </Field>
        <Field label="Suwayomi Source IDs">
          <input className={styles.input} value={arr('suwayomi_source_ids').join(', ')} onChange={e => set('suwayomi_source_ids', e.target.value.split(',').map(s => s.trim()))} />
        </Field>
      </Section>

      <Section title="Metadata">
        <Field label="ComicVine API Key">
          <input className={styles.input} value={str('comicvine_api_key')} onChange={e => set('comicvine_api_key', e.target.value)} />
        </Field>
      </Section>

      <Section title="Indexers">
        <NZBIndexersSection />
      </Section>

      <Section title="Download Clients">
        <ExternalClientsSection />
      </Section>

      <Section title="Remote Path Mappings">
        <RemoteMappingsSection />
      </Section>

      <Section title="Proxy">
        <Field label="Proxy Type">
          <select className={styles.select} value={str('proxy_type')} onChange={e => set('proxy_type', e.target.value)}>
            <option value="">None</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
            <option value="socks5h">SOCKS5H</option>
          </select>
        </Field>
        <Field label="Proxy Host">
          <input className={styles.input} value={str('proxy_host')} onChange={e => set('proxy_host', e.target.value)} />
        </Field>
        <Field label="Proxy Port">
          <input className={styles.input} type="number" value={num('proxy_port')} onChange={e => set('proxy_port', Number(e.target.value))} />
        </Field>
        <Field label="Proxy Username">
          <input className={styles.input} value={str('proxy_username')} onChange={e => set('proxy_username', e.target.value)} />
        </Field>
        <Field label="Proxy Password">
          <input className={styles.input} type="password" value={str('proxy_password')} onChange={e => set('proxy_password', e.target.value)} />
        </Field>
      </Section>
    </div>
  );
}

/* ---------- NZB Indexers Section ---------- */

function NZBIndexersSection() {
  const queryClient = useQueryClient();
  const { data: indexers } = useSuspenseQuery(nzbIndexersQueryOptions());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', base_url: '', api_key: '', categories: '', enabled: true });
  const [testResult, setTestResult] = useState<{success: boolean; description: string | null} | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: Partial<NZBIndexer>) => addNzbIndexer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NZB_INDEXERS_KEY });
      resetForm();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<NZBIndexer> }) => updateNzbIndexer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NZB_INDEXERS_KEY });
      resetForm();
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteNzbIndexer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NZB_INDEXERS_KEY });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: '', base_url: '', api_key: '', categories: '', enabled: true });
    setTestResult(null);
    setShowSecret(false);
  };

  const startEdit = (idx: NZBIndexer) => {
    setEditingId(idx.id);
    setFormData({ name: idx.name, base_url: idx.base_url, api_key: idx.api_key, categories: idx.categories, enabled: idx.enabled });
    setShowForm(true);
    setTestResult(null);
  };

  const handleTest = async () => {
    setTestPending(true);
    try {
      const result = await testNzbIndexer(formData.base_url, formData.api_key);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, description: 'Test request failed' });
    } finally {
      setTestPending(false);
    }
  };

  const handleSave = () => {
    if (editingId !== null) {
      editMutation.mutate({ id: editingId, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  return (
    <div>
      {indexers.length === 0 && !showForm && (
        <p className={styles.emptyList}>No NZB indexers configured.</p>
      )}
      {indexers.map(idx => (
        <div key={idx.id} className={styles.indexerRow}>
          <div className={styles.clientHeader}>
            <span><strong>{idx.name}</strong></span>
            <span className={styles.disabledLabel}>{idx.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className={styles.clientMeta}>{idx.base_url}</div>
          <div className={styles.actionBtns}>
            <button className={styles.smallBtn} type="button" onClick={() => startEdit(idx)}>Edit</button>
            <button className={styles.smallBtn} type="button" onClick={() => delMutation.mutate(idx.id)} disabled={delMutation.isPending}>Delete</button>
          </div>
        </div>
      ))}
      {showForm && (
        <div className={styles.inlineForm}>
          <Field label="Name">
            <input className={styles.input} value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} />
          </Field>
          <Field label="URL">
            <input className={styles.input} value={formData.base_url} onChange={e => setFormData(prev => ({ ...prev, base_url: e.target.value }))} />
          </Field>
          <Field label="API Key">
            <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
              <input className={styles.input} type={showSecret ? 'text' : 'password'}
                value={formData.api_key}
                onChange={e => setFormData(prev => ({ ...prev, api_key: e.target.value }))} />
              <button type="button" className={styles.smallBtn} onClick={() => setShowSecret(s => !s)}
                title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="Categories">
            <input className={styles.input} value={formData.categories} onChange={e => setFormData(prev => ({ ...prev, categories: e.target.value }))} />
          </Field>
          <ToggleField label="Enabled" checked={formData.enabled} onChange={v => setFormData(prev => ({ ...prev, enabled: v }))} />
          {testResult && (
            <div className={testResult.success ? styles.testSuccess : styles.testFailure}>
              {testResult.description || (testResult.success ? 'Connection successful' : 'Connection failed')}
            </div>
          )}
          <div className={styles.actionBtns}>
            <Button variant="secondary" onClick={handleTest} disabled={testPending}>
              {testPending ? 'Testing…' : 'Test'}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={addMutation.isPending || editMutation.isPending}>
              {editingId !== null ? 'Update' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
      {!showForm && (
        <div className={styles.addBtnRow}>
          <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>Add NZB Indexer</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- External Download Clients Section ---------- */

function ExternalClientsSection() {
  const queryClient = useQueryClient();
  const { data: clients } = useSuspenseQuery(externalClientsQueryOptions());
  const { data: clientOptions } = useSuspenseQuery(clientOptionsQueryOptions());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    client_type: '',
    title: '',
    base_url: '',
    username: '',
    password: '',
    api_token: '',
    category: '',
  });
  const [testResult, setTestResult] = useState<{success: boolean; description: string | null} | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // Backend returns download_type as integer: 1=direct, 2=torrent, 3=usenet
  const downloadTypeName = (t: number | string): string => {
    if (typeof t === 'string') return t;
    return ({ 1: 'direct', 2: 'torrent', 3: 'usenet' })[t] ?? String(t);
  };
  const torrentClients = clients.filter(c => String(c.download_type) === '2' || c.download_type === 'torrent');
  const usenetClients = clients.filter(c => String(c.download_type) === '3' || c.download_type === 'usenet');
  const optionsEntries = Object.entries(clientOptions || {});

  const addMutation = useMutation({
    mutationFn: (data: Partial<ExternalClient> & {client_type: string}) => addExternalClient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      queryClient.invalidateQueries({ queryKey: CLIENT_OPTIONS_KEY });
      resetForm();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExternalClient> }) => updateExternalClient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      resetForm();
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteExternalClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ client_type: '', title: '', base_url: '', username: '', password: '', api_token: '', category: '' });
    setTestResult(null);
    setShowSecret(false);
  };

  const startEdit = (c: ExternalClient) => {
    setEditingId(c.id);
    setFormData({
      client_type: c.client_type,
      title: c.title,
      base_url: c.base_url,
      username: c.username || '',
      password: c.password || '',
      api_token: c.api_token || '',
      category: c.category || '',
    });
    setShowForm(true);
    setTestResult(null);
  };

  const handleTest = async () => {
    setTestPending(true);
    try {
      const result = await testExternalClient({
        client_type: formData.client_type,
        base_url: formData.base_url,
        username: formData.username || undefined,
        password: formData.password || undefined,
        api_token: formData.api_token || undefined,
      });
      setTestResult(result);
    } catch {
      setTestResult({ success: false, description: 'Test request failed' });
    } finally {
      setTestPending(false);
    }
  };

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    if (editingId !== null) {
      // On edit, only send fields that have values (omit empty strings for optional ones)
      payload.client_type = formData.client_type;
      payload.title = formData.title;
      payload.base_url = formData.base_url;
      if (formData.username) payload.username = formData.username;
      if (formData.password) payload.password = formData.password;
      if (formData.api_token) payload.api_token = formData.api_token;
      if (formData.category) payload.category = formData.category;
      editMutation.mutate({ id: editingId, data: payload as Partial<ExternalClient> });
    } else {
      payload.client_type = formData.client_type;
      payload.title = formData.title;
      payload.base_url = formData.base_url;
      if (formData.username) payload.username = formData.username;
      if (formData.password) payload.password = formData.password;
      if (formData.api_token) payload.api_token = formData.api_token;
      if (formData.category) payload.category = formData.category;
      addMutation.mutate(payload as Partial<ExternalClient> & {client_type: string});
    }
  };

  const renderClientList = (items: ExternalClient[], label: string) => (
    <div>
      <h4 className={styles.subSectionTitle}>{label}</h4>
      {items.length === 0 && <p className={styles.emptyList}>No {label.toLowerCase()} configured.</p>}
      {items.map(c => (
        <div key={c.id} className={styles.clientCard}>
          <div className={styles.clientHeader}>
            <span><strong>{c.title}</strong></span>
            <span className={styles.clientType}>{downloadTypeName(c.download_type)} — {c.client_type}</span>
          </div>
          <div className={styles.clientMeta}>{c.base_url}</div>
          {c.category && <div className={styles.clientMeta}>Category: {c.category}</div>}
          <div className={styles.actionBtns}>
            <button className={styles.smallBtn} type="button" onClick={() => startEdit(c)}>Edit</button>
            <button className={styles.smallBtn} type="button" onClick={() => delMutation.mutate(c.id)} disabled={delMutation.isPending}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );

  // Determine the download type filter for the form based on editing
  const filteredOptions = optionsEntries.filter(() => true);

  return (
    <div>
      {renderClientList(torrentClients, 'External Torrent Clients')}
      {renderClientList(usenetClients, 'External Usenet Clients')}

      {showForm && (
        <div className={styles.inlineForm}>
          <Field label="Client Type">
            <select className={styles.select} value={formData.client_type} onChange={e => setFormData(prev => ({ ...prev, client_type: e.target.value }))}>
              <option value="">Select client type…</option>
              {filteredOptions.map(([key, opt]) => (
                <option key={key} value={key}>{key} ({downloadTypeName(opt.download_type)})</option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input className={styles.input} value={formData.title} onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} />
          </Field>
          <Field label="Base URL">
            <input className={styles.input} value={formData.base_url} onChange={e => setFormData(prev => ({ ...prev, base_url: e.target.value }))} />
          </Field>
          <Field label="Username">
            <input className={styles.input} value={formData.username} onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))} />
          </Field>
          <Field label="Password">
            <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
              <input className={styles.input} type={showSecret ? 'text' : 'password'}
                value={formData.password}
                onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))} />
              <button type="button" className={styles.smallBtn} onClick={() => setShowSecret(s => !s)}
                title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="API Token">
            <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
              <input className={styles.input} type={showSecret ? 'text' : 'password'}
                value={formData.api_token}
                onChange={e => setFormData(prev => ({ ...prev, api_token: e.target.value }))} />
              <button type="button" className={styles.smallBtn} onClick={() => setShowSecret(s => !s)}
                title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="Category">
            <input className={styles.input} value={formData.category} onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))} />
          </Field>
          {testResult && (
            <div className={testResult.success ? styles.testSuccess : styles.testFailure}>
              {testResult.description || (testResult.success ? 'Connection successful' : 'Connection failed')}
            </div>
          )}
          <div className={styles.actionBtns}>
            <Button variant="secondary" onClick={handleTest} disabled={testPending || !formData.client_type}>
              {testPending ? 'Testing…' : 'Test'}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={addMutation.isPending || editMutation.isPending || !formData.client_type}>
              {editingId !== null ? 'Update' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
      {!showForm && (
        <div className={styles.addBtnRow}>
          <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>Add Download Client</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Remote Path Mappings Section ---------- */

function RemoteMappingsSection() {
  const queryClient = useQueryClient();
  const { data: mappings } = useSuspenseQuery(remoteMappingsQueryOptions());
  const { data: clients } = useSuspenseQuery(externalClientsQueryOptions());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ external_download_client_id: 0, remote_path: '', local_path: '' });

  const clientLookup = new Map(clients.map(c => [c.id, c]));

  const addMutation = useMutation({
    mutationFn: (data: {external_download_client_id: number; remote_path: string; local_path: string}) => addRemoteMapping(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMOTE_MAPPINGS_KEY });
      resetForm();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RemoteMapping> }) => updateRemoteMapping(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMOTE_MAPPINGS_KEY });
      resetForm();
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteRemoteMapping(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMOTE_MAPPINGS_KEY });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ external_download_client_id: 0, remote_path: '', local_path: '' });
  };

  const startEdit = (m: RemoteMapping) => {
    setEditingId(m.id);
    setFormData({ external_download_client_id: m.external_download_client_id, remote_path: m.remote_path, local_path: m.local_path });
    setShowForm(true);
  };

  const handleSave = () => {
    if (editingId !== null) {
      editMutation.mutate({ id: editingId, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  return (
    <div>
      {mappings.length === 0 && !showForm && (
        <p className={styles.emptyList}>No remote path mappings configured.</p>
      )}
      {mappings.map(m => {
        const cl = clientLookup.get(m.external_download_client_id);
        return (
          <div key={m.id} className={styles.indexerRow}>
            <div className={styles.clientHeader}>
              <span><strong>{cl ? cl.title : `Client #${m.external_download_client_id}`}</strong></span>
            </div>
            <div className={styles.clientMeta}>{m.remote_path} → {m.local_path}</div>
            <div className={styles.actionBtns}>
              <button className={styles.smallBtn} type="button" onClick={() => startEdit(m)}>Edit</button>
              <button className={styles.smallBtn} type="button" onClick={() => delMutation.mutate(m.id)} disabled={delMutation.isPending}>Delete</button>
            </div>
          </div>
        );
      })}
      {showForm && (
        <div className={styles.inlineForm}>
          <Field label="External Client">
            <select className={styles.select}
              value={formData.external_download_client_id}
              onChange={e => setFormData(prev => ({ ...prev, external_download_client_id: Number(e.target.value) }))}>
              <option value={0}>Select client…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.title} ({c.client_type})</option>
              ))}
            </select>
          </Field>
          <Field label="Remote Path">
            <input className={styles.input} value={formData.remote_path} onChange={e => setFormData(prev => ({ ...prev, remote_path: e.target.value }))} />
          </Field>
          <Field label="Local Path">
            <input className={styles.input} value={formData.local_path} onChange={e => setFormData(prev => ({ ...prev, local_path: e.target.value }))} />
          </Field>
          <div className={styles.actionBtns}>
            <Button variant="primary" onClick={handleSave} disabled={addMutation.isPending || editMutation.isPending || formData.external_download_client_id === 0}>
              {editingId !== null ? 'Update' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
      {!showForm && (
        <div className={styles.addBtnRow}>
          <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>Add Remote Path Mapping</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Shared UI Helpers ---------- */

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className={styles.section} open={defaultOpen}>
      <summary className={styles.sectionHeader}>{title}</summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={styles.toggleField}>
      <span className={styles.fieldLabel}>{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    </div>
  );
}

function PriorityList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const move = (idx: number, dir: 'up' | 'down') => {
    const next = [...value];
    const target = dir === 'up' ? idx - 1 : idx + 1;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  if (value.length === 0) {
    return <span className={styles.emptyList}>No sources configured</span>;
  }

  return (
    <div className={styles.priorityList}>
      {value.map((item, idx) => (
        <div key={item} className={styles.priorityItem}>
          <span className={styles.priorityLabel}>{idx + 1}. {item}</span>
          <div className={styles.priorityActions}>
            <button className={styles.priorityBtn} type="button" onClick={() => move(idx, 'up')} disabled={idx === 0}>↑</button>
            <button className={styles.priorityBtn} type="button" onClick={() => move(idx, 'down')} disabled={idx === value.length - 1}>↓</button>
          </div>
        </div>
      ))}
    </div>
  );
}
