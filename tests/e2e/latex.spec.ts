import { test, expect } from '@playwright/test';

test('sugerencias de LaTeX: comandos y entornos', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const f = await app.vault.create('Formulas.md', '');
    await app.workspace.getLeaf(false).openFile(f, { state: { mode: 'source', source: true } });
  });
  const editor = page.locator('.cm-content').filter({ visible: true });
  await editor.click();

  // comando con argumentos: \frac{…}{…} con campos
  await page.keyboard.type('$\\fra');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu).toContainText('\\frac');
  await page.waitForTimeout(150); // CodeMirror ignora Enter en los primeros 75 ms del menú
  await page.keyboard.press('Enter');
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await expect(editor).toContainText('$\\frac{a}{b}');

  // entorno: \begin{al… → align* con su \end
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$');
  await page.keyboard.press('Enter');
  await page.keyboard.type('\\begin{al');
  await expect(menu).toContainText('align*');
  await page.screenshot({ path: `test-results/latex-${test.info().project.name}.png` });
  await page.locator('.cm-tooltip-autocomplete li', { hasText: /^align\*/ }).first().click();
  await expect.poll(async () => page.evaluate(() => {
    const app = (window as unknown as { app: any }).app;
    return app.getActiveMarkdownView()?.getViewData() ?? '';
  })).toMatch(/\$\$\n\\begin\{align\*\}\n[^\n]*&=[^\n]*\\\\\n[^\n]*&=[^\n]*\n\\end\{align\*\}$/); // ya estaba dentro de $$: no se vuelve a envolver ni sobra una }
});
