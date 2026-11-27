import { test, expect } from '@playwright/test';

const DOC = '# Vuelo\n\n## #. Hipótesis\n\n## #. Ecuaciones\n\n### #. Equilibrio\n\n## Gráfico\n\n## #. Empuje\n\nfin';

test('títulos numerados: vista previa y editor con live preview', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  type W = { app: { vault: { create(p: string, s: string): Promise<unknown> }; workspace: { getLeaf(n: boolean): { openFile(f: unknown, o: unknown): Promise<void> }; activeLeaf: { view: { editor: { setCursor(p: { line: number; ch: number }): void } } } } } };

  // vista previa (lado a lado)
  await page.evaluate(async (doc) => {
    const { app } = window as unknown as W;
    const f = await app.vault.create('Numerada.md', doc);
    await app.workspace.getLeaf(false).openFile(f, { state: { mode: 'split' } });
  }, DOC);
  const preview = page.locator('.markdown-view.is-split .ml-page').filter({ visible: true }).first();
  await expect(preview.locator('h2, h3')).toHaveText(['1. Hipótesis', '2. Ecuaciones', '2.1 Equilibrio', 'Gráfico', '3. Empuje']);

  // editor con live preview: el número reemplaza a "#." fuera de la línea del cursor
  await page.evaluate(async () => {
    const { app } = window as unknown as W;
    await app.workspace.getLeaf(false).openFile((app.vault as unknown as { getFileByPath(p: string): unknown }).getFileByPath('Numerada.md'), { state: { mode: 'source', source: false } });
    app.workspace.activeLeaf.view.editor.setCursor({ line: 12, ch: 0 });
  });
  const editor = page.locator('.cm-content').filter({ visible: true });
  await expect(editor.locator('.ml-heading-number')).toHaveText(['1.', '2.', '2.1', '3.']);
  await page.screenshot({ path: `test-results/heading-numbers-${test.info().project.name}.png` });
  // en la línea del cursor se ve el marcador para editarlo
  await page.evaluate(() => (window as unknown as W).app.workspace.activeLeaf.view.editor.setCursor({ line: 4, ch: 3 }));
  await expect(editor.locator('.ml-heading-number')).toHaveText(['1.', '2.1', '3.']);
  await expect(editor.locator('.cm-line', { hasText: '#. Ecuaciones' })).toBeVisible();
});
