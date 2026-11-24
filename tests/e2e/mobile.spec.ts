import { test, expect, type Page } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto iphone');

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/mobile-${name}.png` });
const doc = (page: Page) => page.evaluate(() => (window as any).app.getActiveMarkdownView()?.getViewData() as string);

async function ready(page: Page) {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
}

/** Desliza con TouchEvents reales (Playwright no tiene swipe). `ms` entre pasos controla la velocidad. */
async function swipe(page: Page, from: [number, number], to: [number, number], steps = 10, ms = 16) {
  await page.evaluate(async ({ from, to, steps, ms }) => {
    const target = document.elementFromPoint(from[0], from[1]) ?? document.body;
    const fire = (type: string, x: number, y: number) => {
      // WebKit de Playwright no deja construir Touch: evento con la misma forma
      const touch = { identifier: 1, target, clientX: x, clientY: y };
      const list = type === 'touchend' ? [] : [touch];
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(ev, { touches: { value: list }, targetTouches: { value: list }, changedTouches: { value: [touch] } });
      target.dispatchEvent(ev);
    };
    fire('touchstart', from[0], from[1]);
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, ms));
      fire('touchmove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    }
    await new Promise((r) => setTimeout(r, ms));
    fire('touchend', to[0], to[1]);
  }, { from, to, steps, ms });
}

const left = (page: Page) => page.locator('.workspace-sidedock.mod-left');
const right = (page: Page) => page.locator('.workspace-sidedock.mod-right');

test('una sola barra con título y acciones de la vista', async ({ page }) => {
  await ready(page);
  const bar = page.locator('.mobile-navbar');
  await expect(bar.locator('.mobile-navbar-title')).toHaveText('Welcome');
  await expect(page.locator('.mod-root .view-header').filter({ visible: true })).toHaveCount(0);
  await expect(bar.locator('.view-action[aria-label="More options"]')).toBeVisible();
  await shot(page, 'barra');
  // alternar lectura desde la barra
  await bar.locator('.view-action[aria-label="Reading view"]').click();
  await expect(page.locator('.markdown-preview-view h1')).toHaveText('Welcome to Melanite');
  await expect(bar.locator('.view-action[aria-label="Edit"]')).toBeVisible();
  // cambiar de nota: la barra sigue a la vista activa
  await bar.locator('.mobile-navbar-action[aria-label="New note"]').click();
  await expect(bar.locator('.mobile-navbar-title')).toHaveText('Untitled');
  await expect(bar.locator('.view-actions')).toHaveCount(1);
  // tocar el título = renombrar
  await bar.locator('.mobile-navbar-title').click();
  await page.locator('.prompt-input').fill('Renombrada');
  await page.keyboard.press('Enter');
  await expect(bar.locator('.mobile-navbar-title')).toHaveText('Renombrada');
});

test('drawers con gesto desde los bordes', async ({ page }) => {
  await ready(page);
  const w = page.viewportSize()!.width;
  await expect(left(page)).toHaveClass(/is-collapsed/);
  // arrastre lento y corto: no alcanza, vuelve a cerrarse
  await swipe(page, [8, 400], [90, 402], 10, 40);
  await expect(left(page)).toHaveClass(/is-collapsed/);
  // abrir desde el borde izquierdo
  await swipe(page, [8, 400], [260, 405]);
  await expect(left(page)).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.sidedock-backdrop')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'drawer');
  // cerrar arrastrando el drawer
  await swipe(page, [200, 400], [20, 400]);
  await expect(left(page)).toHaveClass(/is-collapsed/);
  // un deslizamiento vertical desde el borde no abre nada (es scroll)
  await swipe(page, [8, 300], [14, 600]);
  await expect(left(page)).toHaveClass(/is-collapsed/);
  // derecho: abre desde el borde derecho, se cierra tocando el fondo
  await swipe(page, [w - 6, 400], [w - 260, 400]);
  await expect(right(page)).not.toHaveClass(/is-collapsed/);
  await page.locator('.sidedock-backdrop').click({ position: { x: 20, y: 300 } });
  await expect(right(page)).toHaveClass(/is-collapsed/);
});

test('toolbar sobre el teclado modifica el texto', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.mobile-toolbar')).toBeHidden();
  await page.locator('.mobile-navbar-action[aria-label="New note"]').click();
  await page.locator('.cm-content').filter({ visible: true }).click();
  const bar = page.locator('.mobile-toolbar');
  await expect(bar).toBeVisible();
  const btn = (label: string) => bar.locator(`.mobile-toolbar-button[aria-label="${label}"]`);
  await expect(btn('Bold')).toHaveCSS('height', '44px');
  await btn('Bold').click();
  await page.keyboard.type('x');
  expect(await doc(page)).toBe('**x**');
  await btn('Toggle task').click();
  expect(await doc(page)).toBe('- [ ] **x**');
  await page.keyboard.press('End');
  await btn('Insert internal link').click();
  await page.keyboard.type('Otra');
  expect(await doc(page)).toBe('- [ ] **x**[[Otra]]');
  await page.waitForTimeout(600); // que el historial no agrupe el encabezado con lo tipeado
  await btn('Heading').click();
  expect(await doc(page)).toBe('# - [ ] **x**[[Otra]]');
  await btn('Undo').click();
  expect(await doc(page)).toBe('- [ ] **x**[[Otra]]');
  await btn('Redo').click();
  expect(await doc(page)).toBe('# - [ ] **x**[[Otra]]');
  // el editor sigue con foco después de tocar los botones
  expect(await page.evaluate(() => (window as any).app.getActiveMarkdownView().cm.hasFocus)).toBe(true);

  // teclado simulado: visualViewport más chico y corrido (como iOS)
  await page.evaluate(() => {
    const vv = window.visualViewport!;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => 420 });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 120 });
    vv.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('body')).toHaveClass(/mobile-keyboard-open/);
  const nav = await page.locator('.mobile-navbar').boundingBox();
  const tb = await bar.boundingBox();
  expect(nav!.y).toBeGreaterThanOrEqual(120); // la barra superior no se fue de pantalla
  expect(Math.round(tb!.y + tb!.height)).toBe(540); // pegada al borde de arriba del "teclado"
  await shot(page, 'toolbar');

  // adjuntar: hoja con Fotos, Cámara, Archivos
  await btn('Attach file').click();
  const sheet = page.locator('.modal.mobile-sheet');
  await expect(sheet.locator('.mobile-sheet-option')).toHaveText(['Photos', 'Camera', 'Files']);
  const modalBox = await sheet.boundingBox();
  expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(541); // por encima del teclado
  const chooser = page.waitForEvent('filechooser');
  await sheet.locator('.mobile-sheet-option', { hasText: 'Photos' }).click();
  await (await chooser).setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await expect.poll(() => doc(page)).toContain('![[foto.png]]');

  // ocultar teclado
  await page.locator('.cm-content').filter({ visible: true }).click();
  await btn('Hide keyboard').click();
  await expect(bar).toBeHidden();
});

test('selector de pestañas', async ({ page }) => {
  await ready(page);
  const tabsBtn = page.locator('.mobile-tabs-button');
  await expect(tabsBtn).toHaveText('1');
  await tabsBtn.click();
  const sheet = page.locator('.mobile-tab-switcher');
  await expect(sheet.locator('.mobile-tab-item')).toHaveCount(1);
  await sheet.locator('.mobile-tab-new').click();
  await expect(tabsBtn).toHaveText('2');
  await expect(page.locator('.mobile-navbar-title')).toHaveText('New tab');
  await tabsBtn.click();
  await expect(sheet.locator('.mobile-tab-item')).toHaveText(['Welcome', 'New tab']);
  await shot(page, 'pestanas');
  await sheet.locator('.mobile-tab-item', { hasText: 'Welcome' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.mobile-navbar-title')).toHaveText('Welcome');
  await tabsBtn.click();
  await sheet.locator('.mobile-tab-item', { hasText: 'New tab' }).locator('.mobile-tab-item-close').click();
  await expect(sheet.locator('.mobile-tab-item')).toHaveCount(1);
  await expect(tabsBtn).toHaveText('1');
});

test('ajustes desde el drawer y targets de 44 px', async ({ page }) => {
  await ready(page);
  await page.locator('.mobile-navbar-action').first().click();
  const item = await page.locator('.tree-item-self').first().boundingBox();
  expect(item!.height).toBeGreaterThanOrEqual(44);
  await page.locator('.mobile-drawer-footer .mobile-sheet-option').click();
  await expect(page.locator('.modal.mod-settings')).toBeVisible();
  const nav = await page.locator('.vertical-tab-nav-item').first().boundingBox();
  expect(nav!.height).toBeGreaterThanOrEqual(44);
  await shot(page, 'ajustes');
});

test('botón de la paleta de comandos en la barra', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 768, 'solo en el teléfono');
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.locator('.mobile-palette-button').click();
  await expect(page.locator('.modal input').first()).toBeVisible();
});
