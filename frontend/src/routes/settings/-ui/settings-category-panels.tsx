import type { AllSettings, SuwayomiSource } from '../-settings.types';
import { SettingsField as Field, SettingsSection as Section, ToggleField } from './settings-field';
import styles from './settings-page.module.css';

export type SettingsCategory = 'general' | 'media-management' | 'root-folders' | 'download' | 'metadata' | 'indexers' | 'download-clients' | 'remote-mappings' | 'proxy';
export const SETTINGS_CATEGORIES: { id: SettingsCategory; label: string; searchText: string }[] = [
  { id: 'general', label: 'General', searchText: 'host port url base username password timezone theme log level flaresolverr proxy ignored addresses hosting restart network interface' },
  { id: 'media-management', label: 'Media Management', searchText: 'volume folder naming file naming padding regex rename downloaded illegal characters empty folders chmod chown convert format date issue' },
  { id: 'root-folders', label: 'Root Folders', searchText: 'root folders library path comics manga storage' },
  { id: 'download', label: 'Download', searchText: 'source priority service preference download folder concurrent timeout seeding completed suwayomi username password source' },
  { id: 'metadata', label: 'Metadata', searchText: 'comicvine api key metadata provider' },
  { id: 'indexers', label: 'Indexers', searchText: 'nzb indexers usenet api key categories' },
  { id: 'download-clients', label: 'Download Clients', searchText: 'torrent usenet external download clients credentials category' },
  { id: 'remote-mappings', label: 'Remote Path Mappings', searchText: 'remote local path mapping download client' },
  { id: 'proxy', label: 'Proxy', searchText: 'proxy type host port username password socks http hosting restart' },
];

type Props = { form: AllSettings; set: <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => void; errors: Partial<Record<keyof AllSettings, string>>; theme: string; setTheme: (value: string) => void; suwayomiSources: SuwayomiSource[]; suwayomiSourcesLoading: boolean };
const str = (form: AllSettings, key: keyof AllSettings) => String((form[key] as string | number | boolean | null | undefined) ?? '');
const bool = (form: AllSettings, key: keyof AllSettings) => Boolean(form[key]);
const arr = (form: AllSettings, key: keyof AllSettings): string[] => Array.isArray(form[key]) ? form[key] as string[] : [];

export function SettingsCategoryPanel({ category, ...props }: Props & { category: SettingsCategory }) {
  const { form, set, errors } = props;
  const text = (key: keyof AllSettings, label: string, help?: string, type?: string) => <Field id={`setting-${String(key)}`} label={label} help={help} error={errors[key]}><input className={styles.input} type={type} value={str(form,key)} onChange={e => set(key, (type === 'number' ? Number(e.target.value) : e.target.value) as AllSettings[typeof key])}/></Field>;
  const toggle = (key: keyof AllSettings, label: string, help?: string) => <ToggleField id={`setting-${String(key)}`} label={label} help={help} checked={bool(form,key)} onChange={v => set(key, v as AllSettings[typeof key])}/>;
  if (category === 'general') return <Section title="General">
    {text('host','Host','Network interface Kapowarr listens on. Changing this hosting setting requires a restart.')}
    {text('port','Port','Listening port. Changing this hosting setting requires a restart.','number')}
    {text('url_base','URL Base','Optional path prefix used when hosting behind a reverse proxy. Changing it requires a restart.')}
    {text('auth_username','Username','Username required to access Kapowarr.')}{text('auth_password','Password','Password required to access Kapowarr.','password')}
    {text('timezone','Timezone','Timezone used for dates and scheduled tasks.')}
    <Field id="setting-theme" label="Theme" help="Choose the visual theme for this browser."><select className={styles.select} value={props.theme} onChange={e=>props.setTheme(e.target.value)}><option value="light">Light</option><option value="dark-mode">Dark</option><option value="batman-mode">Batman</option><option value="spiderman-mode">Spider-Man</option><option value="invincible-mode">Invincible</option><option value="superman-mode">Superman</option><option value="ironman-mode">Iron Man</option><option value="wonderwoman-mode">Wonder Woman</option><option value="flash-mode">The Flash</option><option value="greenlantern-mode">Green Lantern</option><option value="captainamerica-mode">Captain America</option></select></Field>
    <Field id="setting-log_level" label="Log Level" help="Minimum severity written to the application log."><select className={styles.select} value={str(form,'log_level')} onChange={e=>set('log_level',e.target.value)}><option value="DEBUG">Debug</option><option value="INFO">Info</option><option value="WARNING">Warning</option><option value="ERROR">Error</option></select></Field>
    {text('flaresolverr_base_url','FlareSolverr Base URL','URL of an optional FlareSolverr service.')}
    <Field id="setting-proxy_ignored_addresses" label="Proxy Ignored Addresses" help="Comma-separated hosts that bypass the proxy."><input className={styles.input} value={arr(form,'proxy_ignored_addresses').join(', ')} onChange={e=>set('proxy_ignored_addresses',e.target.value.split(',').map(s=>s.trim()))}/></Field>
  </Section>;
  if (category === 'media-management') return <Section title="Media Management">
    {text('volume_folder_naming','Volume Folder Naming','Template used when naming volume folders.')}{text('file_naming','File Naming','Template used for issue files.')}{text('file_naming_empty','File Naming (Empty)')}{text('file_naming_special_version','File Naming (Special Version)')}{text('file_naming_vai','File Naming (VAI)')}
    {toggle('volume_as_issue','Volume as Issue')}{text('volume_as_issue_padding','Volume as Issue Padding',undefined,'number')}{text('volume_regex','Volume Regex')}{text('volume_regex_issue','Volume Regex (Issue)')}{toggle('rename_downloaded_files','Rename Downloaded Files')}{toggle('replace_illegal_characters','Replace Illegal Characters')}{toggle('long_special_version','Long Special Version')}{text('volume_padding','Volume Padding','Number of digits used for volume numbers.','number')}{text('issue_padding','Issue Padding','Number of digits used for issue numbers.','number')}{toggle('create_empty_volume_folders','Create Empty Volume Folders')}{toggle('delete_empty_folders','Delete Empty Folders')}{toggle('unmonitor_deleted_issues','Unmonitor Deleted Issues')}
    <Field id="setting-change_file_date" label="Change File Date"><select className={styles.select} value={str(form,'change_file_date')} onChange={e=>set('change_file_date',e.target.value)}><option value="">Don't change</option><option value="issue_release_date">Issue Release Date</option></select></Field>
    {text('chmod_folder','chmod Folder')}{text('chown_group','chown Group')}{toggle('convert','Convert')}{toggle('extract_issue_ranges','Extract Issue Ranges')}
    <Field id="setting-format_preference" label="Format Preference" help="Comma-separated preferred file formats."><input className={styles.input} value={arr(form,'format_preference').join(', ')} onChange={e=>set('format_preference',e.target.value.split(',').map(s=>s.trim()))}/></Field>
    <Field id="setting-date_type" label="Date Type"><select className={styles.select} value={str(form,'date_type')} onChange={e=>set('date_type',e.target.value)}><option value="cover_date">Cover Date</option><option value="store_date">Store Date</option></select></Field>
  </Section>;
  if (category === 'download') return <Section title="Download">
    <Field id="setting-comic_source_priority" label="Comic Source Priority" help="Comma-separated source names in preferred order."><input className={styles.input} value={arr(form,'comic_source_priority').join(', ')} onChange={e=>set('comic_source_priority',e.target.value.split(',').map(s=>s.trim()))}/></Field>
    <Field id="setting-manga_source_priority" label="Manga Source Priority" help="Comma-separated source names in preferred order."><input className={styles.input} value={arr(form,'manga_source_priority').join(', ')} onChange={e=>set('manga_source_priority',e.target.value.split(',').map(s=>s.trim()))}/></Field>
    <Field id="setting-service_preference" label="Service Preference"><input className={styles.input} value={arr(form,'service_preference').join(', ')} onChange={e=>set('service_preference',e.target.value.split(',').map(s=>s.trim()))}/></Field>
    {text('download_folder','Download Folder')}{text('concurrent_direct_downloads','Concurrent Direct Downloads','Maximum number of simultaneous direct downloads.','number')}{text('failing_download_timeout','Failing Download Timeout','Seconds before a stalled download is considered failed.','number')}
    <Field id="setting-seeding_handling" label="Seeding Handling"><select className={styles.select} value={str(form,'seeding_handling')} onChange={e=>set('seeding_handling',e.target.value)}><option value="complete">Complete (finish seeding, then move)</option><option value="copy">Copy (copy while seeding, delete originals)</option></select></Field>
    {toggle('delete_completed_downloads','Delete Completed Downloads')}{text('suwayomi_base_url','Suwayomi Base URL')}{text('suwayomi_username','Suwayomi Username')}{text('suwayomi_password','Suwayomi Password',undefined,'password')}
    <Field id="setting-suwayomi_source_ids" label="Suwayomi Source Priority" help={props.suwayomiSourcesLoading ? 'Loading Suwayomi sources…' : 'Comma-separated Suwayomi source IDs in preferred order.'}><input className={styles.input} value={arr(form,'suwayomi_source_ids').join(', ')} onChange={e=>set('suwayomi_source_ids',e.target.value.split(',').map(s=>s.trim()))}/></Field>
  </Section>;
  if (category === 'metadata') return <Section title="Metadata">{text('comicvine_api_key','ComicVine API Key','API key used to retrieve comic metadata.')}</Section>;
  if (category === 'proxy') return <Section title="Proxy">
    <Field id="setting-proxy_type" label="Proxy Type" help="Proxy protocol. Proxy hosting changes require a restart."><select className={styles.select} value={str(form,'proxy_type')} onChange={e=>set('proxy_type',e.target.value)}><option value="">None</option><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option><option value="socks5h">SOCKS5H</option></select></Field>
    {text('proxy_host','Proxy Host','Changing proxy hosting settings requires a restart.')}{text('proxy_port','Proxy Port','Changing proxy hosting settings requires a restart.','number')}{text('proxy_username','Proxy Username')}{text('proxy_password','Proxy Password',undefined,'password')}
  </Section>;
  return null;
}
