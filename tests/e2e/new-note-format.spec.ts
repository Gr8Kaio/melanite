import { test, expect } from '@playwright/test';

type W = { app: { settings: { newNoteFormat: boolean; pageNumbers: boolean }; saveSettings(): Promise<void>; getActiveMarkdownView(): { getViewData(): string } | null } };
const text = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as W).app.getActiveMarkdownView()?.getViewData() ?? '');

test('nota nueva: arranca con el formato de hoja y el cursor debajo, listo para escribir', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.locator('.side-dock-ribbon-action[aria-label="New note"]').click();
  await expect.poll(() => text(page)).toBe('---\nfontsize: 11\nmargin: 25\nlineheight: 1.45\nfont: sans\npagenumbers: false\n---\n\n');
  await page.keyboard.type('# Prueba');
  await expect.poll(() => text(page)).toMatch(/---\n\n# Prueba$/);
  // la vista previa no muestra las propiedades de formato
  const sheet = page.locator('.markdown-view.is-split .ml-page').filter({ visible: true }).first();
  await expect(sheet.locator('h1')).toHaveText('Prueba');
  await expect(sheet.locator('.ml-reading-props')).toHaveCount(0);

  // pagenumbers sigue al ajuste general; y se puede apagar
  await page.evaluate(async () => { const { app } = window as unknown as W; app.settings.pageNumbers = true; await app.saveSettings(); });
  await page.locator('.side-dock-ribbon-action[aria-label="New note"]').click();
  await expect.poll(() => text(page)).toContain('pagenumbers: true');
  await page.evaluate(async () => { const { app } = window as unknown as W; app.settings.newNoteFormat = false; await app.saveSettings(); });
  await page.locator('.side-dock-ribbon-action[aria-label="New note"]').click();
  await expect(page.locator('.view-header-title').filter({ visible: true })).toHaveText('Untitled 2');
  expect(await text(page)).toBe('');
});
