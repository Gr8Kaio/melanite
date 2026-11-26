import { test, expect, type Page } from '@playwright/test';

type W = { app: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const ready = async (page: Page) => {
  await page.goto('./');
  await expect(page.locator('.cm-content').first()).toContainText('Welcome');
};

test('la nota del día trae las tareas pendientes de la última nota diaria', async ({ page }) => {
  await ready(page);
  const content = await page.evaluate(async () => {
    const app = (window as unknown as W).app;
    const daily = app.plugins.getPlugin('daily-notes');
    const d = new Date(); d.setDate(d.getDate() - 3); // la última no tiene por qué ser ayer
    await app.vault.create(daily.pathFor(d), '## To do\n\n- [x] hecha\n- [ ] pendiente A\n  - [ ] sub B\n- [ ] \n- [ ] pendiente C\n');
    return app.vault.read(await daily.getDailyNote());
  });
  expect(content).toBe('## To do\n\n- [ ] pendiente A\n  - [ ] sub B\n- [ ] pendiente C\n- [ ] ');
});

test('doble click en un ítem de lista de la vista previa lleva el editor a esa línea', async ({ page, isMobile }) => {
  test.skip(isMobile, 'lado a lado es de escritorio');
  await ready(page);
  const view = page.locator('.markdown-view.is-split').filter({ visible: true });
  await view.locator('.markdown-preview-view li', { hasText: 'Tags:' }).dblclick();
  await expect.poll(() => page.evaluate(() => {
    const ed = (window as unknown as W).app.workspace.activeLeaf.view.editor;
    return ed.getLine(ed.getCursor().line);
  })).toBe('- Tags: #ideas #study');
});

test('los colores del editor se cambian desde Ajustes', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as unknown as W).app.openSettings());
  await page.locator('.vertical-tab-nav-item', { hasText: 'Appearance' }).click();
  const row = page.locator('.setting-item', { hasText: 'Heading 1' });
  await row.locator('input[type=color]').fill('#ff0000');
  await page.locator('button', { hasText: 'Apply' }).click();
  const h1 = () => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--syn-h1').trim());
  await expect.poll(h1).toBe('#ff0000');
  // volver al de fábrica
  await row.locator('.clickable-icon, .extra-setting-button').first().click();
  await page.locator('button', { hasText: 'Apply' }).click();
  await expect.poll(h1).not.toBe('#ff0000');
});
