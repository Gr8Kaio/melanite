import { test, expect } from '@playwright/test';

// Con notas pesadas un render tarda más que el intervalo entre teclas: si uno viejo termina último, no puede pisar al nuevo.
test('un render lento y viejo no pisa la vista previa nueva', async ({ page }) => {
  await page.goto('./');
  const view = page.locator('.markdown-view.is-split').filter({ visible: true });
  await expect(view.locator('.ml-page').first()).toBeVisible();
  type W = { app: { markdown: { addCodeBlockProcessor(lang: string, fn: (code: string, el: HTMLElement) => Promise<void>): void }; workspace: { activeLeaf: { view: { editor: { setValue(s: string): void } } } } } };
  await page.evaluate(() => {
    const { app } = window as unknown as W;
    app.markdown.addCodeBlockProcessor('lento', async (_code, el) => { await new Promise((r) => setTimeout(r, 2500)); el.textContent = 'bloque lento'; });
    app.workspace.activeLeaf.view.editor.setValue('VIEJO\n\n```lento\nx\n```');
  });
  await page.waitForTimeout(400); // arrancó el render lento
  await page.evaluate(() => (window as unknown as W).app.workspace.activeLeaf.view.editor.setValue('NUEVO'));
  await expect(view.locator('.ml-page').first()).toContainText('NUEVO');
  await page.waitForTimeout(3000); // el lento ya terminó
  await expect(view.locator('.ml-page').first()).toContainText('NUEVO');
  await expect(view.locator('.ml-page').first()).not.toContainText('VIEJO');
});
