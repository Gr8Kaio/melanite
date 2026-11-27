import { test, expect } from '@playwright/test';

test('doble click en una línea que ya se ve en la vista previa no la mueve', async ({ page }) => {
  await page.goto('./');
  await page.locator('.markdown-view.is-split .ml-page').first().waitFor();
  type W = { app: { workspace: { activeLeaf: { view: { editor: { setValue(s: string): void } } } } } };
  await page.evaluate(() => {
    const filler = Array.from({ length: 30 }, (_, i) => `Párrafo ${i}`).join('\n\n');
    (window as unknown as W).app.workspace.activeLeaf.view.editor.setValue(`${filler}\n\n![[img.png|300]]\n\nDESPUES\n\n${filler}`);
  });
  const reading = page.locator('.markdown-view.is-split .markdown-reading-view').filter({ visible: true });
  await expect(reading.locator('p', { hasText: 'DESPUES' })).toBeAttached();
  // la línea de la imagen a la vista en la preview, a 200 px del borde de arriba
  await reading.evaluate((el) => {
    const p = Array.from(el.querySelectorAll('p')).find((x) => x.textContent === 'DESPUES')!;
    el.scrollTop += p.getBoundingClientRect().top - el.getBoundingClientRect().top - 200;
  });
  const before = await reading.evaluate((el) => el.scrollTop);
  // CodeMirror solo dibuja lo visible: llevar el cursor a la línea de la imagen
  await page.evaluate(() => ((window as unknown as { app: { workspace: { activeLeaf: { view: { editor: { setCursor(p: { line: number; ch: number }): void } } } } } }).app.workspace.activeLeaf.view.editor.setCursor({ line: 60, ch: 0 })));
  await page.locator('.cm-content').filter({ visible: true }).focus();
  const line = page.locator('.cm-line').filter({ hasText: 'img.png|' }).first();
  await expect(line).toBeVisible();
  const b = (await line.boundingBox())!;
  await page.mouse.dblclick(b.x + b.width - 30, b.y + b.height / 2); // selecciona el "300"
  await page.waitForTimeout(300);
  expect(await reading.evaluate((el) => el.scrollTop)).toBe(before);
});
