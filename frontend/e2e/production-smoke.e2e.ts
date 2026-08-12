import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const volumeItems = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1,
  title: `Dashboard Volume ${index + 1}`,
  year: 2020 + index,
  publisher: index % 2 === 0 ? 'Marvel' : 'Image',
  issue_count: 12,
  issues_downloaded: 12,
}));

const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 180"><rect width="120" height="180" fill="#151b23"/><rect x="10" y="10" width="100" height="160" rx="8" fill="#e2b84b"/><text x="60" y="96" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#111827">K</text></svg>`;

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
  mismatches: 0,
};

function envelope(result: unknown) {
  return { error: null, result };
}

async function fulfillApi(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  let result: unknown;
  if (/\/api\/volumes\/\d+\/cover$/.test(path)) {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: coverSvg });
    return;
  }
  if (path.endsWith('/api/public')) result = { authentication_method: 0 };
  else if (path.endsWith('/api/auth')) result = { api_key: 'browser-test-key' };
  else if (path.endsWith('/api/nav/badges')) {
    result = { volumes: 0, comics: 0, manga: 0, queue: 0, library_import: 0, mismatch: 0 };
  } else if (path.endsWith('/api/volumes/stats')) result = emptyStats;
  else if (path.endsWith('/api/volumes')) result = { items: volumeItems, total: volumeItems.length, offset: 0, page_size: 60 };
  else if (path.endsWith('/api/activity/queue')) result = [];
  else if (path.endsWith('/api/activity/history')) result = [];
  else if (path.endsWith('/api/system/tasks')) result = [];
  else {
    await route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ error: `Unhandled production-smoke endpoint: ${path}`, result: null }),
    });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(envelope(result)),
  });
}

async function openDashboard(page: Page, width: number, height = 820) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/**', fulfillApi);
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
}

for (const width of [1280, 390, 320]) {
  test(`production dashboard is accessible without horizontal overflow at ${width}px`, async ({ page }) => {
    await openDashboard(page, width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (width === 1280) {
      const verticalOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(verticalOverflow).toBeLessThanOrEqual(1);
    }

    await page.keyboard.press('Tab');
    const focusIsVisible = await page.evaluate(() => document.activeElement !== document.body);
    expect(focusIsVisible).toBe(true);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    await expect(page.locator('#root')).toHaveScreenshot(`dashboard-${width}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.005,
    });
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


test("production dashboard fits Caleb's desktop viewport with one-row shelves", async ({ page }) => {
  await openDashboard(page, 1920, 930);
  const verticalOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(verticalOverflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { name: 'Recently Added' }).first()).toBeVisible();
  await expect(page.getByText('Dashboard Volume 1').first()).toBeVisible();
  await expect(page.getByText('Dashboard Volume 3').first()).toBeVisible();
  await expect(page.getByText('Dashboard Volume 4')).toHaveCount(0);
  await expect(page.locator('#root')).toHaveScreenshot('dashboard-1920-fit.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  });
});
