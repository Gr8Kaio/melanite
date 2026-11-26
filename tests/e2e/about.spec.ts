import { test, expect } from '@playwright/test';

// Regresión: About congelaba la app (un .then() de promesa devolvía un Setting, que es thenable)
test('abrir About no congela la app', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(() => (window as unknown as { app: { openSettings(): void } }).app.openSettings());
  await page.locator('.vertical-tab-nav-item', { hasText: 'About' }).click();
  const answer = await Promise.race([page.evaluate(() => 1 + 1), new Promise((r) => setTimeout(() => r('colgada'), 5000))]);
  expect(answer).toBe(2);
  await expect(page.locator('.setting-badge')).toBeVisible();

  // buscar actualizaciones: en la web responde con el service worker
  const row = page.locator('.setting-item', { hasText: 'Updates' });
  await row.locator('button', { hasText: 'Check for updates' }).click();
  await expect(row.locator('.setting-item-description')).toHaveText(/latest version|new version|cannot check/);
  await page.screenshot({ path: `test-results/about-${test.info().project.name}.png` });
});

test('buscar actualizaciones dice cuál hay y pregunta antes de bajarla', async ({ page }) => {
  await page.route('**/version.json', (r) => r.fulfill({ json: { version: '9.9.9' } }));
  await page.goto('./');
  await expect(page.locator('.cm-content').first()).toContainText('Welcome');
  // el service worker tiene que estar registrado para que la web pueda buscar
  await page.waitForFunction(() => navigator.serviceWorker?.getRegistration().then((r) => !!r));
  await page.evaluate(() => (window as unknown as { app: { openSettings(): void } }).app.openSettings());
  await page.locator('.vertical-tab-nav-item', { hasText: 'About' }).click();
  const row = page.locator('.setting-item', { hasText: 'Updates' });
  await row.locator('button', { hasText: 'Check for updates' }).click();
  await expect(row.locator('.setting-item-description')).toHaveText(/new version is available: 9\.9\.9 \(you have \d+\.\d+\.\d+\)\. Download it\?/);
  await expect(row.locator('button', { hasText: 'Download' })).toBeVisible();
});
