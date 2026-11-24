// Espejo vault ↔ carpeta real. Uso: npm run desktop:build && npx playwright test -c playwright.desktop.config.ts
import { test, expect, _electron, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.cwd(), 'release', 'win-unpacked', 'Melanite.exe');
const launch = (userData: string, vaultDir: string) =>
  _electron.launch({ executablePath: exe, args: [`--user-data-dir=${userData}`], env: { ...process.env, MELANITE_VAULT_DIR: vaultDir } });

const vaultText = (page: Page, path: string) => page.evaluate((p) => {
  const app = (window as any).app;
  const f = app.vault.getFileByPath(p);
  return f ? app.vault.cachedReadSync(f) : null;
}, path);
const disk = (dir: string, rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8') : null);

test('la carpeta y el vault se mantienen iguales en los dos sentidos', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'melanite-ud-'));
  const vaultDir = mkdtempSync(join(tmpdir(), 'melanite-vault-'));
  // una carpeta que ya tenía notas (como un vault de Obsidian)
  mkdirSync(join(vaultDir, 'facu'));
  writeFileSync(join(vaultDir, 'Existente.md'), '# Ya estaba\n');
  writeFileSync(join(vaultDir, 'facu', 'Parcial.md'), 'contenido del parcial');
  mkdirSync(join(vaultDir, '.obsidian'));
  writeFileSync(join(vaultDir, '.obsidian', 'app.json'), '{}');

  const app = await launch(userData, vaultDir);
  const page = await app.firstWindow();
  await expect(page.locator('body')).toContainText('Welcome to Melanite');

  // 1. lo de la carpeta entró al vault (sin .obsidian) y lo del vault se escribió en la carpeta
  await expect.poll(() => vaultText(page, 'facu/Parcial.md')).toBe('contenido del parcial');
  await expect.poll(() => vaultText(page, 'Existente.md')).toBe('# Ya estaba\n');
  expect(await vaultText(page, '.obsidian/app.json')).toBeNull();
  await expect.poll(() => disk(vaultDir, 'Welcome.md')).toContain('Welcome to Melanite');

  // 2. crear en la app → aparece en el disco
  await page.evaluate(() => (window as any).app.vault.create('Nueva/Desde la app.md', 'hola'));
  await expect.poll(() => disk(vaultDir, 'Nueva/Desde la app.md')).toBe('hola');

  // 3. muchas ediciones seguidas: el eco del disco no pisa el texto nuevo
  await page.evaluate(async () => {
    const app = (window as any).app;
    const f = app.vault.getFileByPath('Nueva/Desde la app.md');
    for (let i = 1; i <= 30; i++) { await app.vault.modify(f, `version ${i}`); await new Promise((r) => setTimeout(r, 40)); }
  });
  await page.waitForTimeout(1500);
  expect(await vaultText(page, 'Nueva/Desde la app.md')).toBe('version 30');
  expect(disk(vaultDir, 'Nueva/Desde la app.md')).toBe('version 30');

  // 4. editar en el disco desde afuera → entra a la app
  writeFileSync(join(vaultDir, 'Existente.md'), '# Editado afuera\n');
  await expect.poll(() => vaultText(page, 'Existente.md'), { timeout: 10_000 }).toBe('# Editado afuera\n');

  // 5. archivo nuevo creado afuera → aparece en la app
  writeFileSync(join(vaultDir, 'facu', 'Externo.md'), 'desde el Explorador');
  await expect.poll(() => vaultText(page, 'facu/Externo.md'), { timeout: 10_000 }).toBe('desde el Explorador');

  // 6. renombrar en la app → se renombra en el disco
  await page.evaluate(async () => {
    const app = (window as any).app;
    await app.vault.rename(app.vault.getFileByPath('facu/Parcial.md'), 'facu/Parcial 1.md');
  });
  await expect.poll(() => disk(vaultDir, 'facu/Parcial 1.md')).toBe('contenido del parcial');
  expect(disk(vaultDir, 'facu/Parcial.md')).toBeNull();
  await page.screenshot({ path: 'test-results/desktop-folder.png' });

  // pestaña de ajustes: muestra la carpeta actual
  await page.evaluate(() => (window as any).app.openSettings('vault-folder'));
  await expect(page.locator('.vertical-tab-content')).toContainText(vaultDir);
  await page.screenshot({ path: 'test-results/desktop-folder-settings.png' });
  await app.close();
});
