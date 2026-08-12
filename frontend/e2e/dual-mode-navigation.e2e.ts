import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const envelope = (result: unknown) => ({ error: null, result });
const stats = { volumes: 0, monitored: 0, unmonitored: 0, issues: 0, downloaded_issues: 0, missing_monitored: 0, upcoming_monitored: 0, unmonitored_issues: 0, failed_downloads: 0, active_downloads: 0, import_problems: 0, mismatches: 0, files: 0, total_file_size: 0 };

async function mockApi(route: Route) {
  const url = new URL(route.request().url());
  const { pathname, searchParams } = url;
  let result: unknown;
  if (pathname.endsWith('/api/public')) result = { authentication_method: 0 };
  else if (pathname.endsWith('/api/auth')) result = { api_key: 'browser-test-key' };
  else if (pathname.endsWith('/api/nav/badges')) result = { volumes: 0, comics: 0, manga: 0, queue: 0, library_import: 0, mismatch: 0 };
  else if (pathname.endsWith('/api/volumes/stats')) result = stats;
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
  else if (pathname.endsWith('/api/volumes')) result = { items: [], total: 0, offset: 0, page_size: 60 };
  else if (pathname.endsWith('/api/savedfilters')) result = [];
  else if (pathname.endsWith('/api/settings')) result = {
    host: '0.0.0.0', port: 5656, url_base: '', auth_password: '', auth_username: '',
    timezone: 'UTC', log_level: 'INFO', proxy_ignored_addresses: [], format_preference: [],
    comic_source_priority: [], manga_source_priority: [], service_preference: [], suwayomi_source_ids: [],
  };
  else if (pathname.includes('/api/activity/queue')) result = [];
  else if (pathname.includes('/api/activity/history') && searchParams.has('issue_id')) result = [{ web_link: 'https://example.invalid/issue', web_title: 'Pilot issue release', web_sub_title: null, file_title: null, volume_id: 1, issue_id: 11, source: 'test', source_name: 'Test Source', downloaded_at: 100, success: true }];
  else if (pathname.includes('/api/activity/history') && searchParams.has('volume_id')) result = [{ web_link: 'https://example.invalid/volume', web_title: 'Volume bundle release', web_sub_title: null, file_title: null, volume_id: 1, issue_id: null, source: 'test', source_name: 'Test Source', downloaded_at: 101, success: true }];
  else if (pathname.endsWith('/api/blocklist')) result = { entries: [], total: 0, offset: 0, page_size: 50 };
  else if (pathname.includes('/api/discovery') || pathname.includes('/api/volumes/recent')) result = [];
  else if (pathname.includes('/api/rootfolder')) result = [{ id: 1, folder: '/comics', section: 'comic' }];
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

test('mobile shell exposes five safe primary destinations without root overflow', async ({ page }) => {
  await boot(page, 390);
  const navigation = page.getByRole('navigation', { name: /primary/i });
  await expect(navigation).toBeVisible();
  for (const label of ['Home', 'Comics', 'Manga', 'Discover', 'Activity']) {
    const link = navigation.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
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
  { route: '/settings/general', evidence: 'General' },
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

test('volume detail defaults to Issues without an Overview tab', async ({ page }) => {
  await page.route('**/*', injectProductionBase);
  await page.route('**/api/**', mockApi);
  await page.goto('/volumes/1');
  const sections = page.getByRole('navigation', { name: 'Volume sections' });
  await expect(sections.getByRole('link', { name: 'Issues' })).toHaveAttribute('aria-current', 'page');
  await expect(sections.getByRole('link', { name: 'Overview' })).toHaveCount(0);
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
