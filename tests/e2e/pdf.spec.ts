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

test('exportar carpeta: elegir qué notas van y en qué orden', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(async () => {
    const w = window as unknown as { printed: number; app: { vault: { createFolder(p: string): Promise<unknown>; create(p: string, s: string): Promise<unknown> } } };
    w.printed = 0;
    window.print = () => { w.printed++; };
    await w.app.vault.createFolder('Parcial');
    for (const n of ['A', 'B', 'C']) await w.app.vault.create(`Parcial/${n}.md`, `Nota ${n}`);
  });
  await page.locator('.tree-item-self[data-path="Parcial"]').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Export folder to PDF' }).click();
  const rows = page.locator('.ml-pdf-row');
  await expect(rows).toHaveText(['A', 'B', 'C']);
  // sacar B y llevar C arriba de todo
  await rows.nth(1).locator('input').uncheck();
  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 2 } });
  await expect(rows).toHaveText(['C', 'A', 'B']);
  await expect(page.locator('.ml-pdf-pick .mod-cta')).toHaveText('Export to PDF (2)');
  await page.screenshot({ path: `test-results/pdf-pick-${test.info().project.name}.png` });
  await page.locator('.ml-pdf-pick .mod-cta').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.locator('.ml-print .ml-page')).toHaveText(['Nota C', 'Nota A']);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  // la próxima vez arranca como se dejó; una nota nueva se suma al final (marcada) y una borrada desaparece
  await page.evaluate(async () => {
    const { app } = window as unknown as { app: { vault: { create(p: string, s: string): Promise<unknown>; delete(f: unknown): Promise<void>; getFileByPath(p: string): unknown } } };
    await app.vault.create('Parcial/D.md', 'Nota D');
    await app.vault.delete(app.vault.getFileByPath('Parcial/A.md'));
  });
  await page.locator('.tree-item-self[data-path="Parcial"]').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Export folder to PDF' }).click();
  await expect(rows).toHaveText(['C', 'B', 'D']);
  await expect(rows.nth(1).locator('input')).not.toBeChecked();
  await expect(rows.nth(2).locator('input')).toBeChecked();
});
