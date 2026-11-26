import { test, expect } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'en el teléfono el default es live preview');

test('lado a lado por defecto: vista previa en vivo, scroll independiente, doble click salta', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');

  const view = page.locator('.markdown-view.is-split').filter({ visible: true });
  await expect(view).toBeVisible();
  const editor = view.locator('.cm-content');
  const preview = view.locator('.markdown-preview-view');
  await expect(editor).toBeVisible();
  // el editor muestra el código (sin live preview) y la vista previa el resultado
  await expect(editor).toContainText('# Welcome to Melanite');
  await expect(preview.locator('h1')).toHaveText('Welcome to Melanite');
  await expect(preview.locator('.katex').first()).toBeVisible();

  // escribir actualiza la vista previa
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type(' (editado en vivo)');
  await expect(preview.locator('h1')).toHaveText('Welcome to Melanite (editado en vivo)');
  await page.screenshot({ path: `test-results/split-mode-${test.info().project.name}.png` });

  // bajar en el editor no mueve la vista previa
  const reading = view.locator('.markdown-reading-view');
  const scroller = view.locator('.cm-scroller');
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  expect(await reading.evaluate((el) => el.scrollTop)).toBe(0);

  // doble click en la última línea lleva la vista previa ahí
  await view.locator('.cm-line').last().dblclick();
  await expect.poll(() => reading.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  // y al revés: doble click en un título de la vista previa lleva el editor ahí
  await reading.evaluate((el) => { el.scrollTop = 0; });
  await preview.locator('h2').first().dblclick();
  await expect.poll(() => page.evaluate(() => {
    const ws = (window as unknown as { app: { workspace: { activeLeaf: { view: { editor: { getLine(n: number): string; getCursor(): { line: number } } } } } } }).app.workspace;
    const ed = ws.activeLeaf.view.editor; return ed.getLine(ed.getCursor().line);
  })).toBe('## The basics');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(400);
});
