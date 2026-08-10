import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const emptyStats = {
  volumes: 0,
  monitored: 0,
  unmonitored: 0,
  issues: 0,
  downloaded_issues: 0,
  missing_monitored: 0,
  upcoming_monitored: 0,
  unmonitored_issues: 0,
  failed_downloads: 0,
  active_downloads: 0,
  import_problems: 0,
  files: 0,
  total_file_size: 0,
};

function envelope(result: unknown) {
  return { error: null, result };
}

async function fulfillApi(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  let result: unknown = {};
  if (path.endsWith('/api/public')) result = { authentication_method: 0 };
  else if (path.endsWith('/api/auth')) result = { api_key: 'browser-test-key' };
  else if (path.endsWith('/api/nav/badges')) {
    result = { volumes: 0, comics: 0, manga: 0, queue: 0, library_import: 0, mismatch: 0 };
  } else if (path.endsWith('/api/volumes/stats')) result = emptyStats;
  else if (path.endsWith('/api/volumes')) result = [];
  else if (path.endsWith('/api/activity/queue')) result = [];
  else if (path.endsWith('/api/activity/history')) result = [];
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(envelope(result)),
  });
}

async function openDashboard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 820 });
  await page.route('**/api/**', fulfillApi);
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

for (const width of [1280, 390, 320]) {
  test(`production dashboard is accessible without horizontal overflow at ${width}px`, async ({ page }) => {
    await openDashboard(page, width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.keyboard.press('Tab');
    const focusIsVisible = await page.evaluate(() => document.activeElement !== document.body);
    expect(focusIsVisible).toBe(true);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test('production dashboard renders in both supported themes', async ({ page }) => {
  await openDashboard(page, 1280);
  await page.evaluate(() => localStorage.setItem('kapowarr-theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.evaluate(() => localStorage.setItem('kapowarr-theme', 'batman-mode'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'batman-mode');
});
