import { test, expect } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'page.pdf solo existe en Chromium');

test('exportar a PDF: mismas hojas que la vista previa, papel claro, una hoja por \\newpage', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  // window.print queda registrado en vez de abrir el diálogo; ahí generamos el PDF de verdad
  await page.evaluate(() => {
    const w = window as unknown as { printed: number; app: { vault: { create(p: string, s: string): Promise<unknown> } } };
    w.printed = 0;
    window.print = () => { w.printed++; };
    return w.app.vault.create('Informe.md', '# Informe\n\nPrimera hoja.\n\n\\newpage\n\n## Segunda\n\nOtra hoja.');
  });
  await page.evaluate(() => (window as unknown as { app: { workspace: { openLinkText(l: string, s: string): Promise<void> } } }).app.workspace.openLinkText('Informe', ''));
  await page.evaluate(() => (window as unknown as { app: { commands: { executeCommandById(id: string): boolean } } }).app.commands.executeCommandById('file:export-pdf'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.locator('.ml-print .ml-page')).toHaveCount(2);
  await expect(page.locator('body')).toHaveClass(/is-printing/);
  await expect(page.locator('body')).toHaveClass(/theme-light/);

  const pdf = await page.pdf({ path: 'test-results/export.pdf', preferCSSPageSize: true, printBackground: true });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length).toBe(2);

  // al cerrar el diálogo todo vuelve como estaba
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.ml-print')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-printing/);
});
