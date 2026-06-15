import { useState } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Notice } from '@/components/primitives';
import { settingsQueryOptions, updateSettings, SETTINGS_KEY } from '../-settings.api';
import type { AllSettings } from '../-settings.types';
import styles from './settings-page.module.css';

const HOSTING_KEYS = new Set(['host', 'port', 'url_base']);

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const [form, setForm] = useState<AllSettings>(() => ({ ...settings }));
  const [savedMsg, setSavedMsg] = useState('');
  const [restartWarning, setRestartWarning] = useState(false);

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
        <Field label="Log Level">
          <select className={styles.select} value={str('log_level')} onChange={e => set('log_level', e.target.value)}>
            <option value="DEBUG">Debug</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="ERROR">Error</option>
          </select>
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
      </Section>

      <Section title="Download">
        <Field label="Comic Source Priority">
          <PriorityList value={arr('comic_source_priority')} onChange={v => set('comic_source_priority', v)} />
        </Field>
        <Field label="Manga Source Priority">
          <PriorityList value={arr('manga_source_priority')} onChange={v => set('manga_source_priority', v)} />
        </Field>
        <Field label="GetComics Service Preference">
          <input className={styles.input} value={str('getcomics_service_preference')} onChange={e => set('getcomics_service_preference', e.target.value)} />
        </Field>
        <Field label="Suwayomi Base URL">
          <input className={styles.input} value={str('suwayomi_base_url')} onChange={e => set('suwayomi_base_url', e.target.value)} />
        </Field>
        <Field label="Suwayomi Username">
          <input className={styles.input} value={str('suwayomi_username')} onChange={e => set('suwayomi_username', e.target.value)} />
        </Field>
        <Field label="Suwayomi Password">
          <input className={styles.input} type="password" value={str('suwayomi_password')} onChange={e => set('suwayomi_password', e.target.value)} />
        </Field>
      </Section>

      <Section title="Metadata">
        <Field label="ComicVine API Key">
          <input className={styles.input} value={str('comicvine_api_key')} onChange={e => set('comicvine_api_key', e.target.value)} />
        </Field>
      </Section>

      <Section title="Indexers">
        <Field label="NZB Indexer URL">
          <input className={styles.input} value={str('nzb_indexer_url')} onChange={e => set('nzb_indexer_url', e.target.value)} />
        </Field>
        <Field label="NZB Indexer API Key">
          <input className={styles.input} value={str('nzb_indexer_api_key')} onChange={e => set('nzb_indexer_api_key', e.target.value)} />
        </Field>
      </Section>

      <Section title="Proxy">
        <Field label="Proxy Type">
          <select className={styles.select} value={str('proxy_type')} onChange={e => set('proxy_type', e.target.value)}>
            <option value="">None</option>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
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
