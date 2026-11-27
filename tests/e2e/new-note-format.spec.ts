import { test, expect } from '@playwright/test';

type W = { app: { settings: { newNoteFrontmatter: string }; saveSettings(): Promise<void>; getActiveMarkdownView(): { getViewData(): string } | null } };
const text = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as W).app.getActiveMarkdownView()?.getViewData() ?? '');
const setTemplate = (page: import('@playwright/test').Page, v: string) => page.evaluate(async (v) => {
  const { app } = window as unknown as W;
  app.settings.newNoteFrontmatter = v;
  await app.saveSettings();
}, v);

test('nota nueva: arranca con el frontmatter de Ajustes y el cursor debajo, listo para escribir', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  const newNote = () => page.locator('.side-dock-ribbon-action[aria-label="New note"]').click();

  await newNote();
  await expect.poll(() => text(page)).toBe('---\nfontsize: 11\nmargin: 20\nlineheight: 1.3\nfont: sans\npagenumbers: true\n---\n\n');
  await page.keyboard.type('# Prueba');
  await expect.poll(() => text(page)).toMatch(/---\n\n# Prueba$/);
  // la vista previa no muestra las propiedades de formato
  const sheet = page.locator('.markdown-view.is-split .ml-page').filter({ visible: true }).first();
  await expect(sheet.locator('h1')).toHaveText('Prueba');
  await expect(sheet.locator('.ml-reading-props')).toHaveCount(0);

  // se edita en Ajustes; sin --- se le agregan
  await setTemplate(page, 'fontsize: 12');
  await newNote();
  await expect.poll(() => text(page)).toBe('---\nfontsize: 12\n---\n\n');
  // vacío = sin frontmatter
  await setTemplate(page, '');
  await newNote();
  await expect(page.locator('.view-header-title').filter({ visible: true })).toHaveText('Untitled 2');
  expect(await text(page)).toBe('');
});
