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

test('vista previa en hojas: corte automático y salto manual', async ({ page }) => {
  await page.goto('./');
  const view = page.locator('.markdown-view.is-split').filter({ visible: true });
  await expect(view.locator('.ml-page').first()).toBeVisible();
  const setText = (s: string) => page.evaluate((s) => {
    (window as unknown as { app: { workspace: { activeLeaf: { view: { editor: { setValue(s: string): void } } } } } }).app.workspace.activeLeaf.view.editor.setValue(s);
  }, s);
  await setText('uno\n\n\\newpage\n\ndos');
  await expect(view.locator('.ml-page')).toHaveCount(2);
  await expect(view.locator('.ml-page').nth(1)).toContainText('dos');
  await expect(view.locator('.ml-pagebreak')).toBeHidden();
  await setText(Array.from({ length: 60 }, (_, i) => `Párrafo ${i}`).join('\n\n'));
  await expect(view.locator('.ml-page').last()).toContainText('Párrafo 59');
  await expect(view.locator('.ml-page').first()).toContainText('Párrafo 0');
  await expect(view.locator('.ml-page').first()).not.toContainText('Párrafo 59');
  await page.screenshot({ path: `test-results/split-pages-${test.info().project.name}.png` });
});

test('pegar una imagen la guarda en la carpeta de la nota', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  const files = await page.evaluate(async () => {
    type W = { app: { vault: { createFolder(p: string): Promise<unknown>; create(p: string, s: string): Promise<unknown>; getFiles(): { path: string }[] }; workspace: { openLinkText(l: string, s: string): Promise<void> } } };
    const { app } = window as unknown as W;
    await app.vault.createFolder('proyecto');
    await app.vault.create('proyecto/nota.md', '');
    await app.workspace.openLinkText('proyecto/nota', '');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    const cm = Array.from(document.querySelectorAll<HTMLElement>('.cm-content')).find((el) => el.offsetParent)!;
    cm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    return app.vault.getFiles().map((f) => f.path);
  });
  expect(files.some((p) => /^proyecto\/[^/]+\.png$/.test(p))).toBe(true);
  await expect(page.locator('.cm-content').filter({ visible: true })).toContainText('.png]]');

  // arrastrar la imagen desde el explorador al editor escribe el embed donde se suelta
  const text = await page.evaluate(async (img) => {
    type W = { app: { workspace: { activeLeaf: { view: { editor: { setValue(s: string): void; getValue(): string } } } } } };
    const ed = (window as unknown as W).app.workspace.activeLeaf.view.editor;
    ed.setValue('arriba\nabajo');
    const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).filter((el) => el.offsetParent).find((el) => el.textContent === 'abajo')!;
    const r = line.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-melanite-path', img);
    line.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 1, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    return ed.getValue();
  }, files.find((p) => p.endsWith('.png'))!);
  expect(text).toMatch(/^arriba\n!\[\[[^\]]+\.png\]\]abajo$/);
});
