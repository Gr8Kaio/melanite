import { test, expect } from '@playwright/test';

test('lado a lado: editor y vista previa en vivo, con scroll alineado', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(() => (window as unknown as { app: { commands: { executeCommandById(id: string): void } } }).app.commands.executeCommandById('markdown:toggle-split'));

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

  // bajar en el editor baja la vista previa
  await view.locator('.cm-scroller').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => view.locator('.markdown-reading-view').evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
});
