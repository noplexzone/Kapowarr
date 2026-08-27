import { type ReactElement, useEffect, useState } from 'react';
import type { AllSettings, SuwayomiSource } from '../-settings.types';
import { cancelMetronBackfill, dismissMetronReview, fetchMetronReviews, selectMetronCandidate, startMetronBackfill, testMetronConnection, type MetronReviewCandidate } from '../-settings.api';
import { SettingsField as Field, SettingsSection as Section, ToggleField } from './settings-field';
import styles from './settings-page.module.css';

export type SettingsCategory = 'general' | 'media-management' | 'root-folders' | 'download' | 'metadata' | 'indexers' | 'download-clients' | 'remote-mappings' | 'proxy';
export const SETTINGS_CATEGORIES: { id: SettingsCategory; label: string; description: string; searchText: string }[] = [
  { id: 'general', label: 'General', description: 'Hosting, authentication, theme, logs, and local browser identity.', searchText: 'host port url base username password timezone theme log level flaresolverr proxy ignored addresses hosting restart network interface' },
  { id: 'media-management', label: 'Media Management', description: 'Naming, file operations, conversion, issue ranges, and library cleanup defaults.', searchText: 'volume folder naming file naming padding regex rename downloaded illegal characters empty folders chmod chown convert format date issue' },
  { id: 'root-folders', label: 'Root Folders', description: 'Storage locations for Comics and Manga libraries.', searchText: 'root folders library path comics manga storage' },
  { id: 'download', label: 'Download', description: 'Download folders, source priority, concurrency, seeding, and Suwayomi preferences.', searchText: 'source priority service preference download folder concurrent timeout seeding completed suwayomi username password source' },
  { id: 'metadata', label: 'Metadata', description: 'ComicVine and metadata-provider credentials.', searchText: 'comicvine api key metadata provider' },
  { id: 'indexers', label: 'Indexers', description: 'NZB indexer services, API keys, categories, and connection tests.', searchText: 'nzb indexers usenet api key categories' },
  { id: 'download-clients', label: 'Download Clients', description: 'Torrent and Usenet clients with credential test/save flows.', searchText: 'torrent usenet external download clients credentials category' },
  { id: 'remote-mappings', label: 'Remote Path Mappings', description: 'Client path translations from remote download paths to local library paths.', searchText: 'remote local path mapping download client' },
  { id: 'proxy', label: 'Proxy', description: 'Proxy host, authentication, and protocol settings for outbound requests.', searchText: 'proxy type host port username password socks http hosting restart' },
];

type Props = { form: AllSettings; set: <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => void; saveNow?: <K extends keyof AllSettings>(key: K) => void; fieldStatus?: Partial<Record<keyof AllSettings, string>>; errors: Partial<Record<keyof AllSettings, string>>; theme: string; setTheme: (value: string) => void; suwayomiSources: SuwayomiSource[]; suwayomiSourcesLoading: boolean };
const str = (form: AllSettings, key: keyof AllSettings) => String((form[key] as string | number | boolean | null | undefined) ?? '');
const bool = (form: AllSettings, key: keyof AllSettings) => Boolean(form[key]);
const arr = (form: AllSettings, key: keyof AllSettings): string[] => Array.isArray(form[key]) ? form[key] as string[] : [];
const formatMetronDate = (value: number | null | undefined) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value * 1000)) : 'Never';


function MetronSettingsPanel({ form, toggle, text }: { form: AllSettings; toggle: (key: keyof AllSettings, label: string, help?: string) => ReactElement; text: (key: keyof AllSettings, label: string, help?: string, type?: string) => ReactElement }) {
  const [metronStatus, setMetronStatus] = useState<string>('');
  const [reviews, setReviews] = useState<MetronReviewCandidate[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const metron = form.metron;
  const backfill = metron?.backfill ?? {};
  const persistedBackfillStatus = String(backfill.status ?? 'idle');
  const [backfillStatus, setBackfillStatus] = useState(persistedBackfillStatus);
  const [backfillActive, setBackfillActive] = useState(
    persistedBackfillStatus === 'running' || persistedBackfillStatus === 'rate_limit_paused',
  );
  const [backfillRequest, setBackfillRequest] = useState<'start' | 'cancel' | null>(null);
  useEffect(() => {
    setBackfillStatus(persistedBackfillStatus);
    setBackfillActive(
      persistedBackfillStatus === 'running' || persistedBackfillStatus === 'rate_limit_paused',
    );
  }, [persistedBackfillStatus]);
  const refreshReviews = () => {
    setReviewsLoading(true);
    fetchMetronReviews()
      .then((result) => setReviews(result.candidates))
      .catch((error) => setMetronStatus(`Could not load Metron reviews: ${String(error)}`))
      .finally(() => setReviewsLoading(false));
  };
  useEffect(() => { refreshReviews(); }, []);
  const selectCandidate = (candidate: MetronReviewCandidate) => {
    selectMetronCandidate(candidate.id)
      .then((result) => {
        setMetronStatus(result.duplicate ? 'Metron candidate selected; enrichment already queued.' : `Metron candidate selected; enrichment queued${result.task_id ? ` as task ${result.task_id}` : ''}.`);
        refreshReviews();
      })
      .catch((error) => setMetronStatus(String(error)));
  };
  const dismissCandidate = (candidate: MetronReviewCandidate) => {
    dismissMetronReview(candidate.volume_id)
      .then(() => { setMetronStatus('Metron review dismissed.'); refreshReviews(); })
      .catch((error) => setMetronStatus(String(error)));
  };
  const startBackfill = () => {
    setBackfillRequest('start');
    startMetronBackfill()
      .then((result) => {
        setBackfillStatus(result.status ?? (result.duplicate ? 'already_queued' : 'queued'));
        setBackfillActive(true);
        setMetronStatus(result.duplicate ? 'Backfill is already queued.' : `Backfill queued${result.task_id ? ` as task ${result.task_id}` : ''}`);
      })
      .catch((error) => setMetronStatus(String(error)))
      .finally(() => setBackfillRequest(null));
  };
  const cancelBackfill = () => {
    setBackfillRequest('cancel');
    cancelMetronBackfill()
      .then((result) => {
        setBackfillStatus(result.status);
        setBackfillActive(false);
        setMetronStatus(`Backfill ${result.status}.`);
      })
      .catch((error) => setMetronStatus(String(error)))
      .finally(() => setBackfillRequest(null));
  };
  return <div className={styles.clientCard}>
    <h3>Metadata / Integrations — Metron</h3>
    <p>Metron enriches Comics only. ComicVine remains canonical; Manga is unchanged.</p>
    {toggle('metron_enabled','Enable Metron','Allow optional asynchronous comic enrichment after ComicVine adds and refreshes.')}
    {text('metron_api_token','Metron API token','Write-only bearer token. Saved settings return only a masked value.','password')}
    <div className={styles.actionBtns}>
      <button className={styles.smallBtn} type="button" onClick={() => testMetronConnection().then(r => setMetronStatus(`${r.success ? 'Connection successful' : 'Connection failed'}: ${r.status}`)).catch(e => setMetronStatus(String(e)))}>Test Connection</button>
      <button className={styles.smallBtn} type="button" onClick={startBackfill} disabled={backfillActive || backfillRequest !== null}>{backfillRequest === 'start' ? 'Starting backfill…' : 'Backfill Existing Comics'}</button>
      {backfillActive ? <button className={styles.smallBtn} type="button" onClick={cancelBackfill} disabled={backfillRequest !== null} aria-label="Cancel Backfill">{backfillRequest === 'cancel' ? 'Cancelling backfill…' : 'Cancel Backfill'}</button> : null}
      <button className={styles.smallBtn} type="button" onClick={refreshReviews} disabled={reviewsLoading}>{reviewsLoading ? 'Refreshing reviews…' : 'Refresh Reviews'}</button>
    </div>
    <dl className={styles.clientMeta}>
      <div><dt>Token</dt><dd>{metron?.token_configured ? 'Configured (masked)' : 'Not configured'}</dd></div>
      <div><dt>Last successful connection</dt><dd>{formatMetronDate(metron?.last_successful_connection ?? form.metron_last_successful_connection)}</dd></div>
      <div><dt>Last enrichment</dt><dd>{formatMetronDate(metron?.last_enrichment ?? form.metron_last_enrichment_run)}</dd></div>
      <div><dt>Rate status</dt><dd>{String((metron?.rate_limit?.last_status as string | undefined) ?? 'Unknown')}</dd></div>
      <div><dt>Backfill status</dt><dd>{backfillStatus}</dd></div>
      <div><dt>Backfill progress</dt><dd>{Number(backfill.processed ?? 0)} processed · {Number(backfill.matched ?? 0)} matched · {Number(backfill.failed ?? 0)} failed · cursor {String(backfill.last_terminal_volume_id ?? 0)}</dd></div>
      {backfill.rate_limit_paused_until ? <div><dt>Paused until</dt><dd>{formatMetronDate(Number(backfill.rate_limit_paused_until))}</dd></div> : null}
    </dl>
    <div className={styles.priorityList} aria-label="Metron review candidates">
      <h4 className={styles.subSectionTitle}>Multiple-match review</h4>
      {reviewsLoading ? <p className={styles.emptyList}>Loading Metron reviews…</p> : reviews.length === 0 ? <p className={styles.emptyList}>No Metron reviews pending.</p> : reviews.map((candidate) => <article key={candidate.id} className={styles.priorityItem}>
        <div><strong>{candidate.title}</strong><p className={styles.fieldHelp}>Volume {candidate.volume_id} · Metron ID {candidate.candidate_external_id}{candidate.year ? ` · ${candidate.year}` : ''}{candidate.publisher ? ` · ${candidate.publisher}` : ''}</p></div>
        <div className={styles.actionBtns}>
          <button className={styles.smallBtn} type="button" onClick={() => selectCandidate(candidate)}>Select candidate</button>
          <button className={styles.smallBtn} type="button" onClick={() => dismissCandidate(candidate)}>Dismiss review</button>
        </div>
      </article>)}
    </div>
    {metronStatus && <p role="status">{metronStatus}</p>}
  </div>;
}

export function SettingsCategoryPanel({ category, ...props }: Props & { category: SettingsCategory }) {
  const { form, set, saveNow, fieldStatus = {}, errors } = props;
  const status = (key: keyof AllSettings) => fieldStatus[key] ? <p className={styles.fieldHelp} role="status">{fieldStatus[key]}</p> : null;
  const text = (key: keyof AllSettings, label: string, help?: string, type?: string) => <Field id={`setting-${String(key)}`} label={label} help={help} error={errors[key]}><><input className={styles.input} type={type} value={str(form,key)} onChange={e => set(key, (type === 'number' ? Number(e.target.value) : e.target.value) as AllSettings[typeof key])} onBlur={() => saveNow?.(key)} onKeyDown={e => { if (e.key === 'Enter') saveNow?.(key); }}/>{status(key)}</></Field>;
  const toggle = (key: keyof AllSettings, label: string, help?: string) => <ToggleField id={`setting-${String(key)}`} label={label} help={help} checked={bool(form,key)} onChange={v => set(key, v as AllSettings[typeof key])}/>;
  if (category === 'general') return <Section title="General">
    {text('host','Host','Network interface Kapowarr listens on. Changing this hosting setting requires a restart.')}
    {text('port','Port','Listening port. Changing this hosting setting requires a restart.','number')}
    {text('url_base','URL Base','Optional path prefix used when hosting behind a reverse proxy. Changing it requires a restart.')}
    {text('auth_username','Username','Username required to access Kapowarr.')}{text('auth_password','Password','Password required to access Kapowarr.','password')}
    {text('timezone','Timezone','Timezone used for dates and scheduled tasks.')}
    <Field id="setting-theme" label="Theme" help="Choose the visual theme for this browser."><select className={styles.select} value={props.theme} onChange={e=>props.setTheme(e.target.value)}><option value="kapowarr-noir">Kapowarr Noir</option><option value="light">Light</option><option value="dark-mode">Dark</option><option value="batman-mode">Batman</option><option value="spiderman-mode">Spider-Man</option><option value="invincible-mode">Invincible</option><option value="superman-mode">Superman</option><option value="ironman-mode">Iron Man</option><option value="wonderwoman-mode">Wonder Woman</option><option value="flash-mode">The Flash</option><option value="greenlantern-mode">Green Lantern</option><option value="captainamerica-mode">Captain America</option></select></Field>
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
  if (category === 'metadata') return <Section title="Metadata">
    {text('comicvine_api_key','ComicVine API Key','API key used to retrieve canonical comic metadata.')}
    <MetronSettingsPanel form={form} toggle={toggle} text={text} />
  </Section>;
  if (category === 'proxy') return <Section title="Proxy">
    <Field id="setting-proxy_type" label="Proxy Type" help="Proxy protocol. Proxy hosting changes require a restart."><select className={styles.select} value={str(form,'proxy_type')} onChange={e=>set('proxy_type',e.target.value)}><option value="">None</option><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option><option value="socks5h">SOCKS5H</option></select></Field>
    {text('proxy_host','Proxy Host','Changing proxy hosting settings requires a restart.')}{text('proxy_port','Proxy Port','Changing proxy hosting settings requires a restart.','number')}{text('proxy_username','Proxy Username')}{text('proxy_password','Proxy Password',undefined,'password')}
  </Section>;
  return null;
}
