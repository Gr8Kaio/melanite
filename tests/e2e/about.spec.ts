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
});
