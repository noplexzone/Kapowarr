import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllSettings } from '../-settings.types';

const { updateSettings, useBlocker } = vi.hoisted(() => ({ updateSettings: vi.fn(), useBlocker: vi.fn() }));
const settings: AllSettings = {
  host: '0.0.0.0', port: 5656, url_base: '', auth_password: '', auth_username: '', timezone: 'UTC', log_level: 'INFO', flaresolverr_base_url: '', proxy_ignored_addresses: [], proxy_type: '', proxy_host: '', proxy_port: 0, proxy_username: '', proxy_password: '', rename_downloaded_files: true, replace_illegal_characters: true, volume_folder_naming: '{series}', file_naming: '{series} #{issue_number}', file_naming_empty: '', file_naming_special_version: '', file_naming_vai: '', volume_as_issue: false, volume_as_issue_padding: 2, volume_regex: '', volume_regex_issue: '', long_special_version: false, volume_padding: 2, issue_padding: 3, create_empty_volume_folders: false, delete_empty_folders: false, unmonitor_deleted_issues: false, change_file_date: '', chmod_folder: '', chown_group: '', convert: false, extract_issue_ranges: false, format_preference: [], comic_source_priority: [], manga_source_priority: [], service_preference: [], download_folder: '/downloads', concurrent_direct_downloads: 1, failing_download_timeout: 0, seeding_handling: 'complete', delete_completed_downloads: false, suwayomi_base_url: '', suwayomi_username: '', suwayomi_password: '', suwayomi_source_ids: [], comicvine_api_key: '', date_type: 'cover_date',
};
vi.mock('@tanstack/react-router', () => ({ useBlocker }));
vi.mock('../-settings.api', async () => {
  const actual = await vi.importActual<typeof import('../-settings.api')>('../-settings.api');
  return { ...actual, updateSettings, settingsQueryOptions: () => ({ queryKey: ['settings'], queryFn: async () => settings, staleTime: Infinity }), suwayomiSourcesQueryOptions: () => ({ queryKey: ['suwayomi-sources'], queryFn: async () => ({ sources: [] }) }) };
});
import { SettingsPage } from './settings-page';
import { SettingsField } from './settings-field';

function renderPage(props: Partial<React.ComponentProps<typeof SettingsPage>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SettingsPage {...props} /></QueryClientProvider>);
}

describe('SettingsField', () => {
  it('associates labels with nested secret controls rather than their wrapper', () => {
    render(<SettingsField label="API Token"><div><input type="password" /></div></SettingsField>);
    const input = screen.getByLabelText('API Token');
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toMatch(/^setting-/);
  });
});

describe('SettingsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); updateSettings.mockResolvedValue(undefined); document.documentElement.dataset.theme = 'dark-mode'; });
  it('searches user-facing labels and help text and selects the matching category', async () => {
    const onCategoryChange = vi.fn(); renderPage({ onCategoryChange });
    fireEvent.change(await screen.findByLabelText('Search settings'), { target: { value: 'API key' } });
    expect(screen.getByRole('button', { name: 'Metadata' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull();
    expect(onCategoryChange).toHaveBeenCalledWith('metadata');
  });
  it('associates labels and help descriptions with controls', async () => {
    renderPage(); const host = await screen.findByLabelText('Host');
    expect(host.id).toBe('setting-host');
    expect(host.getAttribute('aria-describedby')).toBe('setting-host-help');
    expect(screen.getByText(/Network interface Kapowarr listens on/i).id).toBe('setting-host-help');
  });
  it('shows dirty state, disables no-op save, and discards edits', async () => {
    renderPage(); const save = await screen.findByRole('button', { name: 'Save Changes' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: '127.0.0.1' } });
    expect(screen.getByText('1 unsaved change')).toBeTruthy(); expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('0.0.0.0');
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });
  it('warns before SPA or browser navigation with unsaved settings', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Host'), { target: { value: '127.0.0.1' } });
    const options = useBlocker.mock.calls[useBlocker.mock.calls.length - 1]?.[0];
    expect(options.disabled).toBe(false);
    expect(options.enableBeforeUnload).toBe(true);
    expect(options.shouldBlockFn()).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/unsaved settings/i));
    confirm.mockReturnValue(true);
    expect(options.shouldBlockFn()).toBe(false);
    confirm.mockRestore();
  });
  it('blocks invalid edited settings and renders an inline error', async () => {
    renderPage(); fireEvent.change(await screen.findByLabelText('Port'), { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Port must be between 1 and 65535.');
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Port').getAttribute('aria-invalid')).toBe('true');
  });
  it('keeps dirty edits and reports a save failure', async () => {
    updateSettings.mockRejectedValue(new Error('server refused settings'));
    renderPage(); fireEvent.change(await screen.findByLabelText('Log Level'), { target: { value: 'DEBUG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('server refused settings');
    expect((screen.getByLabelText('Log Level') as HTMLSelectElement).value).toBe('DEBUG');
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
  });
  it('requires explicit confirmation before saving hosting changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage(); fireEvent.change(await screen.findByLabelText('Host'), { target: { value: '127.0.0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/restart/i)); expect(updateSettings).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ host: '127.0.0.1' }));
    confirm.mockRestore();
  });
});
