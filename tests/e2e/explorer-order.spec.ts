import { test, expect, type Page } from '@playwright/test';

const row = (page: Page, path: string) => page.locator(`.nav-files-container .tree-item-self[data-path="${path}"]`);
const rootOrder = (page: Page) => page.locator('.nav-files-container > .tree-item > .tree-item-self').evaluateAll((els) => els.map((el) => el.getAttribute('data-path')));

test('explorador: reordenar arrastrando, se guarda, y el centro de una carpeta sigue moviendo adentro', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(async () => {
    const { app } = window as unknown as { app: { vault: { createFolder(p: string): Promise<unknown>; create(p: string, s: string): Promise<unknown> } } };
    await app.vault.createFolder('Materias');
    for (const n of ['A', 'B', 'C']) await app.vault.create(`${n}.md`, n);
  });
  await expect(row(page, 'C.md')).toBeVisible();
  expect(await rootOrder(page)).toEqual(['Materias', 'A.md', 'B.md', 'C.md', 'Welcome.md']);

  // C arriba de A (borde superior), después la carpeta debajo de todo (borde inferior de Welcome)
  await row(page, 'C.md').dragTo(row(page, 'A.md'), { targetPosition: { x: 40, y: 3 } });
  await expect.poll(() => rootOrder(page)).toEqual(['Materias', 'C.md', 'A.md', 'B.md', 'Welcome.md']);
  await row(page, 'Materias').dragTo(row(page, 'Welcome.md'), { targetPosition: { x: 40, y: 25 } });
  await expect.poll(() => rootOrder(page)).toEqual(['C.md', 'A.md', 'B.md', 'Welcome.md', 'Materias']);

  // el centro de una carpeta mete el archivo adentro
  const h = (await row(page, 'Materias').boundingBox())!.height;
  await row(page, 'B.md').dragTo(row(page, 'Materias'), { targetPosition: { x: 40, y: h / 2 } });
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { app: { vault: { getFileByPath(p: string): unknown } } }).app.vault.getFileByPath('Materias/B.md'))).toBe(true);
  await expect.poll(() => rootOrder(page)).toEqual(['C.md', 'A.md', 'Welcome.md', 'Materias']);

  // renombrar conserva el lugar
  await page.evaluate(async () => {
    const { app } = window as unknown as { app: { vault: { rename(f: unknown, p: string): Promise<void>; getFileByPath(p: string): unknown } } };
    await app.vault.rename(app.vault.getFileByPath('A.md'), 'A2.md');
  });
  await expect.poll(() => rootOrder(page)).toEqual(['C.md', 'A2.md', 'Welcome.md', 'Materias']);
  await page.screenshot({ path: `test-results/explorer-order-${test.info().project.name}.png` });

  // queda guardado (en el vault, se sincroniza) y sobrevive a recargar
  await page.waitForTimeout(500);
  await page.reload();
  await expect(row(page, 'C.md')).toBeVisible();
  expect(await rootOrder(page)).toEqual(['C.md', 'A2.md', 'Welcome.md', 'Materias']);

  // restablecer orden (click derecho en el fondo del explorador = carpeta raíz)
  const box = (await page.locator('.nav-files-container').boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + box.height - 20, { button: 'right' });
  await page.locator('.menu-item', { hasText: 'Reset order' }).click();
  await expect.poll(() => rootOrder(page)).toEqual(['Materias', 'A2.md', 'C.md', 'Welcome.md']);
});
