import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const envelope = (result: unknown) => ({ error: null, result });
const stats = { volumes: 2, monitored: 1, unmonitored: 1, issues: 18, downloaded_issues: 7, missing_monitored: 11, upcoming_monitored: 2, unmonitored_issues: 3, failed_downloads: 1, active_downloads: 1, import_problems: 0, mismatches: 1, files: 7, total_file_size: 2048 };
const comicVolumes = [
  { id: 1, title: 'Acceptance Volume', year: 2026, volume_number: 1, publisher: 'Test Publisher', monitored: true, root_folder: '/comics', folder: '/comics/Acceptance Volume', special_version: '', issue_count: 10, issues_downloaded: 4 },
  { id: 2, title: 'Second Acceptance', year: 2025, volume_number: 2, publisher: 'Test Publisher', monitored: false, root_folder: '/comics', folder: '/comics/Second Acceptance', special_version: '', issue_count: 8, issues_downloaded: 3 },
];
const mangaVolumes = [
  { id: 3, title: 'Acceptance Manga', year: 2024, volume_number: 1, publisher: 'Manga Publisher', monitored: true, root_folder: '/manga', folder: '/manga/Acceptance Manga', special_version: '', issue_count: 12, issues_downloaded: 2 },
];

async function mockApi(route: Route) {
  const url = new URL(route.request().url());
  const { pathname, searchParams } = url;
  let result: unknown;
  if (pathname.endsWith('/api/public')) result = { authentication_method: 0 };
  else if (pathname.endsWith('/api/auth')) result = { api_key: 'browser-test-key' };
  else if (pathname.endsWith('/api/nav/badges')) result = { volumes: 3, comics: 2, manga: 1, queue: 1, library_import: 0, mismatch: 1 };
  else if (pathname.endsWith('/api/volumes/stats')) result = stats;
  else if (pathname.endsWith('/api/system/tasks/42')) {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'TaskNotFound', result: null }) });
    return;
  }
  else if (pathname.endsWith('/api/volumes/1/import')) result = { task_id: 42 };
  else if (pathname.endsWith('/api/volumes/search')) result = [{
    comicvine_id: 501, metadata_source: 'comicvine', metadata_id: '501', title: 'Acceptance Search Result',
    year: 2026, publisher: 'Test Publisher', volume_number: 1, cover_url: null, cover_link: null,
    description: null, aliases: null, issue_count: 5, already_added: null,
  }];
  else if (pathname.endsWith('/api/volumes/1')) result = {
    id: 1, comicvine_id: 101, title: 'Acceptance Volume', year: 2026,
    publisher: 'Test Publisher', volume_number: 1, section: 'comic', monitored: true,
    monitor_new_issues: true, folder: '/comics/Acceptance Volume', root_folder: 1,
    root_folder_path: '/comics', issue_count: 1, issues_downloaded: 1,
    issues: [{ id: 11, issue_number: '1', title: 'Pilot', monitored: true,
      files: [{ id: 21, filepath: '/comics/Acceptance Volume/Issue 1.cbz', size: 1024 }] }],
    general_files: [{ id: 31, filepath: '/comics/Acceptance Volume/Volume Notes.pdf', size: 2048, file_type: 'metadata' }],
  };
  else if (pathname.endsWith('/api/volumes')) {
    const section = searchParams.get('section');
    const items = section === 'manga' ? mangaVolumes : comicVolumes;
    result = { items, total: items.length, offset: 0, page_size: 60 };
  }
  else if (pathname.endsWith('/api/savedfilters')) result = [];
  else if (pathname.endsWith('/api/settings')) result = {
    host: '0.0.0.0', port: 5656, url_base: '', auth_password: '', auth_username: '', timezone: 'UTC', log_level: 'INFO',
    flaresolverr_base_url: '', proxy_ignored_addresses: [], proxy_type: '', proxy_host: '', proxy_port: 0, proxy_username: '', proxy_password: '',
    rename_downloaded_files: true, replace_illegal_characters: true, volume_folder_naming: '{series}', file_naming: '{series} #{issue_number}',
    file_naming_empty: '', file_naming_special_version: '', file_naming_vai: '', volume_as_issue: false, volume_as_issue_padding: 2,
    volume_regex: '', volume_regex_issue: '', long_special_version: false, volume_padding: 2, issue_padding: 3, create_empty_volume_folders: false,
    delete_empty_folders: false, unmonitor_deleted_issues: false, change_file_date: '', chmod_folder: '', chown_group: '', convert: false, extract_issue_ranges: false,
    format_preference: [], comic_source_priority: [], manga_source_priority: [], service_preference: [], download_folder: '/downloads', concurrent_direct_downloads: 1,
    failing_download_timeout: 0, seeding_handling: 'complete', delete_completed_downloads: false, suwayomi_base_url: '', suwayomi_username: '', suwayomi_password: '',
    suwayomi_source_ids: [], comicvine_api_key: '', date_type: 'cover_date',
  };
  else if (pathname.includes('/api/activity/queue')) result = [{ id: 41, title: 'Acceptance Volume #1', status: 'downloading', progress: 42, progress_is_percent: true, volume_id: 1, source: 'direct' }];
  else if (pathname.includes('/api/activity/history') && searchParams.has('issue_id')) result = [{ web_link: 'https://example.invalid/issue', web_title: 'Pilot issue release', web_sub_title: null, file_title: null, volume_id: 1, issue_id: 11, source: 'test', source_name: 'Test Source', downloaded_at: 100, success: true }];
  else if (pathname.includes('/api/activity/history') && searchParams.has('volume_id')) result = [{ web_link: 'https://example.invalid/volume', web_title: 'Volume bundle release', web_sub_title: null, file_title: null, volume_id: 1, issue_id: null, source: 'test', source_name: 'Test Source', downloaded_at: 101, success: true }];
  else if (pathname.endsWith('/api/activity/history')) result = { entries: [{ id: 71, title: 'Acceptance Volume #1', source: 'Test Source', state: 'failed', downloaded_at: 100, failure_reason: 'Network timeout', volume_id: 1 }], total: 1, offset: 0, page_size: 50 };
  else if (pathname.endsWith('/api/blocklist')) result = { entries: [], total: 0, offset: 0, page_size: 50 };
  else if (pathname.includes('/api/discovery')) result = [];
  else if (pathname.includes('/api/volumes/recent')) result = searchParams.get('section') === 'manga' ? mangaVolumes : comicVolumes;
  else if (pathname.includes('/api/rootfolder')) result = [{ id: 1, folder: '/comics', section: 'comic' }, { id: 2, folder: '/manga', section: 'manga' }];
  else if (pathname.endsWith('/api/files/21/info')) result = { id: 21, filepath: '/comics/Acceptance Volume/Issue 1.cbz', page_count: 2, is_pdf: false };
  else if (pathname.endsWith('/api/files/21/page/0') || pathname.endsWith('/api/files/21/page/1')) {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="100%" height="100%" fill="#111827"/><text x="32" y="80" fill="white">Reader page</text></svg>' });
    return;
  }
  else {
    await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled acceptance endpoint: ${pathname}`, result: null }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(result)) });
}

async function injectProductionBase(route: Route) {
  if (route.request().resourceType() !== 'document') {
    await route.continue();
    return;
  }
  const response = await route.fetch();
  const body = (await response.text()).replace('<head>', '<head><base href="/">');
  await route.fulfill({ response, body });
}

async function boot(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: width < 800 ? 844 : 800 });
  await page.route('**/api/**', mockApi);
  await page.goto('/home');
  await expect(page.getByTestId('application-shell')).toBeVisible();
}

test('canonical internal navigation preserves the application shell and browser history', async ({ page }) => {
  await boot(page);
  const shell = page.getByTestId('application-shell');
  const shellHandle = await shell.elementHandle();
  let documentRequests = 0;
  page.on('request', request => { if (request.resourceType() === 'document') documentRequests += 1; });

  await page.getByRole('link', { name: 'Comics', exact: true }).click();
  await expect(page).toHaveURL(/\/comics/);
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await expect(page).toHaveURL(/\/discover/);
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/\/activity\//);

  expect(await shellHandle?.evaluate(node => node.isConnected)).toBe(true);
  expect(documentRequests).toBe(0);
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.goBack();
  await expect(page).toHaveURL(/\/discover/);
  await page.goForward();
  await expect(page).toHaveURL(/\/activity\//);
  expect(await shellHandle?.evaluate(node => node.isConnected)).toBe(true);
});

test('mobile shell exposes six safe primary destinations without root overflow', async ({ page }) => {
  await boot(page, 390);
  const navigation = page.getByRole('navigation', { name: /primary/i });
  await expect(navigation).toBeVisible();
  for (const label of ['Home', 'Comics', 'Manga', 'Discover', 'Activity', 'Settings']) {
    const link = navigation.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const navRows = await navigation.getByRole('link').evaluateAll((links) => new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))).size);
  expect(navRows).toBe(1);
});

for (const route of ['/home', '/comics', '/manga', '/discover?section=comic&category=upcoming', '/activity/queue']) {
  test(`canonical route ${route} exposes one current destination and no axe violations`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/*', injectProductionBase);
    await page.route('**/api/**', mockApi);
    await page.goto(route);
    const shell = page.getByTestId('application-shell');
    try {
      await expect(shell).toBeVisible();
    } catch {
      throw new Error(`${route}: ${await page.locator('body').innerText()}`);
    }
    await expect(page.locator('nav:visible [aria-current="page"]')).toHaveCount(1);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, `${route}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  });
}

const workflowRoutes = [
  { route: '/add?section=comic', evidence: 'ComicVine' },
  { route: '/settings/general', evidence: 'Service configuration' },
  { route: '/volumes/1/files', evidence: 'Volume Notes.pdf' },
  { route: '/volumes/1/history', evidence: 'Volume bundle release' },
  { route: '/activity/blocklist', evidence: 'Blocklist' },
  { route: '/discover?section=comic&category=story-arcs', evidence: 'Story Arcs' },
] as const;

for (const { route, evidence } of workflowRoutes) {
  for (const width of [320, 390, 1280]) {
    for (const theme of ['kapowarr-noir', 'light'] as const) {
      test(`${route} is accessible at ${width}px in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 800 ? 844 : 800 });
        await page.addInitScript((selectedTheme) => localStorage.setItem('kapowarr-theme', selectedTheme), theme);
        await page.route('**/*', injectProductionBase);
        await page.route('**/api/**', mockApi);
        await page.goto(route);
        await expect(page.getByTestId('application-shell')).toBeVisible();
        await expect(page.getByText(evidence, { exact: false }).first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(results.violations, `${route} ${width}px ${theme}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
      });
    }
  }
}



test('Discover exposes a bottom Search/Add Comics control', async ({ page }) => {
  await boot(page);
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search to add comics' });
  await expect(search).toBeVisible();
  await search.fill('Acceptance');
  await expect(page.getByRole('button', { name: /Acceptance Search Result/ })).toBeVisible();
  await expect(page).toHaveURL(/\/discover/);
});

test('Add review modal is keyboard-operable, labelled, and mobile-safe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);
  await page.goto('/add?section=comic');
  const search = page.getByRole('searchbox', { name: 'Search Comics' });
  await search.fill('Acceptance');
  await search.press('Enter');
  const result = page.getByRole('button', { name: /Acceptance Search Result/ });
  await expect(result).toBeVisible();
  await result.focus();
  await result.press('Space');
  await expect(page.getByRole('dialog')).toBeVisible();
  for (const label of ['Root Folder', 'Volume Folder', 'Monitoring Scheme', 'Special Version', 'Monitor Volume', 'Monitor Issues', 'Auto Search']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('volume issue history dialog consumes the issue-history array contract', async ({ page }) => {
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);
  await page.goto('/volumes/1/issues');
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog')).toContainText('Pilot issue release');
});


test('volume detail imports multiple local files directly into the selected volume', async ({ page }) => {
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);
  await page.goto('/volumes/1/issues');

  await page.getByRole('button', { name: 'Import Files' }).click();
  await expect(page.getByRole('dialog')).toContainText('Upload comic archives directly into this volume folder');
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'Acceptance 001.cbz', mimeType: 'application/vnd.comicbook+zip', buffer: Buffer.from('one') },
    { name: 'Acceptance 002.cbz', mimeType: 'application/vnd.comicbook+zip', buffer: Buffer.from('two') },
  ]);
  await expect(page.getByText('2 file(s) selected')).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 Files' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Volume task completed.')).toBeVisible();
});

test('volume detail defaults to Issues without an Overview tab', async ({ page }) => {
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);
  await page.goto('/volumes/1');
  const sections = page.getByRole('navigation', { name: 'Volume sections' });
  await expect(sections.getByRole('link', { name: 'Issues' })).toHaveAttribute('aria-current', 'page');
  await expect(sections.getByRole('link', { name: 'Overview' })).toHaveCount(0);
});



test('principal redesign flows remain usable at mobile acceptance width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);

  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Run the collection, then browse it.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Comics missing', exact: true })).toBeVisible();
  await expect(page.getByText('Acceptance Volume').first()).toBeVisible();

  await page.getByRole('link', { name: 'Comics', exact: true }).click();
  const acceptanceVolume = page.getByRole('link', { name: 'Acceptance Volume' }).first();
  await expect(acceptanceVolume).toBeVisible();
  await acceptanceVolume.click();
  await expect(page.getByRole('heading', { name: 'Acceptance Volume' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Volume sections' }).getByRole('link', { name: 'Issues' })).toBeVisible();
  await page.getByRole('link', { name: 'Files' }).click();
  await expect(page.getByText('Volume Notes.pdf')).toBeVisible();

  await page.getByRole('navigation', { name: /primary/i }).getByRole('link', { name: 'Comics', exact: true }).click();
  await page.getByRole('button', { name: 'Manage' }).click();
  await page.getByRole('checkbox', { name: 'Select Acceptance Volume' }).check();
  await expect(page.getByTestId('bulk-toolbar')).toContainText('1 selected');
  await expect(page.getByRole('button', { name: 'Search Missing Selected' })).toBeVisible();

  await page.getByRole('link', { name: 'Manga', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Acceptance Manga' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/\/activity\//);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Service configuration')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('reader route still opens while reader polish remains deferred', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);
  await page.goto('/read/21');
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('login branding honors a prefixed production base path', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.text()).replace('<head>', '<head><base href="/kapowarr/"><meta name="kapowarr-url-base" content="/kapowarr">');
    await route.fulfill({ response, body });
  });
  await page.route('**/kapowarr/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/kapowarr/, '') || '/';
    const response = await route.fetch({ url: url.toString() });
    await route.fulfill({ response });
  });
  await page.route('**/api/public', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ authentication_method: 1 })) });
  });
  await page.goto('/login');
  const logo = page.getByAltText('Kapowarr');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /\/kapowarr\/static\/img\/favicon\.svg$/);
});
