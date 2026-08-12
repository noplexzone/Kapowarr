import { expect, test } from '@playwright/test';

test('a new build activates and removes an older Kapowarr cache without clearing site data', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => {
    try {
      await page.evaluate(async () => {
        for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
        await caches.open('kapowarr-static-build-a');
        const registration = await navigator.serviceWorker.register('/sw.js?upgrade=build-b', { updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        await registration.update();
      });
      return 'ready';
    } catch (error) {
      return String(error).includes('Execution context was destroyed') ? 'reloading' : 'failed';
    }
  }).toBe('ready');
  await expect.poll(async () => {
    try {
      return await page.evaluate(async () => (await caches.keys()).includes('kapowarr-static-build-a'));
    } catch {
      return true;
    }
  }).toBe(false);
  const workerSource = await page.request.get('/sw.js').then((response) => response.text());
  expect(workerSource).not.toContain('__KAPOWARR_BUILD_VERSION__');
  expect(workerSource).toMatch(/kapowarr-static-[a-f0-9]{16}/);
});
