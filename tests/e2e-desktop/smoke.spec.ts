// Humo de la app de escritorio. Uso: npm run desktop:build && npx playwright test -c playwright.desktop.config.ts
// Lanza el ejecutable empaquetado (release/win-unpacked) con un userData temporal.
import { test, expect, _electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.cwd(), 'release', 'win-unpacked', 'Melanite.exe');
const launch = (dir: string) => _electron.launch({ executablePath: exe, args: [`--user-data-dir=${dir}`] });

test('abre, crea una nota y la conserva al reabrir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'melanite-e2e-'));

  let app = await launch(dir);
  let page = await app.firstWindow();
  await expect(page).toHaveTitle('Melanite');
  await expect(page.locator('body')).toContainText('Welcome to Melanite');
  expect(await page.evaluate(() => location.origin)).toBe('app://melanite');
  await page.evaluate(() => (window as any).app.vault.create('Prueba escritorio.md', 'hola desde electron'));
  await page.screenshot({ path: 'test-results/desktop.png' });
  await app.close();

  app = await launch(dir);
  page = await app.firstWindow();
  await expect(page.locator('body')).toContainText('Prueba escritorio');
  await app.close();
});
