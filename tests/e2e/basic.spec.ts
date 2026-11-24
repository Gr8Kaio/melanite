import { test, expect, type Page } from '@playwright/test';

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 768;

// en el teléfono el título de la nota va en la barra única de arriba
const noteTitle = (page: Page) => isPhone(page) ? page.locator('.mobile-navbar-title') : page.locator('.view-header-title').filter({ visible: true });

async function openLeft(page: Page) {
  if (isPhone(page)) await page.locator('.mobile-navbar-action').first().click();
}

test('arranca con la nota de bienvenida renderizada', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome to Melanite');
  // live preview: sintaxis oculta fuera de la línea del cursor
  await expect(page.locator('.cm-line.ml-h1')).toHaveText('Welcome to Melanite');
  await expect(page.locator('.ml-tag').first()).toBeVisible();
  await page.screenshot({ path: `test-results/inicio-${test.info().project.name}.png` });
  // CodeMirror solo dibuja lo visible: bajamos hasta math, callouts y tabla
  const scroller = page.locator('.cm-scroller').filter({ visible: true });
  for (const sel of ['.cm-content .katex', '.ml-callout-icon', '.ml-rendered-block table']) {
    await expect(async () => {
      await scroller.evaluate((el) => { el.scrollTop += 300; });
      await expect(page.locator(sel).first()).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
  }
  await page.screenshot({ path: `test-results/inicio-abajo-${test.info().project.name}.png` });
});

test('modo lectura renderiza math, mermaid y callouts', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.locator('.view-action[aria-label="Reading view"]').click();
  const reading = page.locator('.markdown-preview-view');
  await expect(reading.locator('h1')).toHaveText('Welcome to Melanite');
  await expect(reading.locator('.math-block .katex-display')).toBeVisible();
  await expect(reading.locator('.callout[data-callout="tip"]')).toBeVisible();
  await expect(reading.locator('.callout[data-callout="warning"]')).toHaveClass(/is-collapsed/);
  await expect(reading.locator('.block-language-mermaid svg')).toBeVisible({ timeout: 15_000 });
  await expect(reading.locator('pre .tok-keyword').first()).toBeVisible();
  await page.screenshot({ path: `test-results/lectura-${test.info().project.name}.png`, fullPage: false });
});

test('crear nota, escribir, y persiste al recargar', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  if (isPhone(page)) await page.locator('.mobile-navbar-action[aria-label="New note"]').click();
  else await page.locator('.side-dock-ribbon-action[aria-label="New note"]').click();
  await expect(noteTitle(page)).toHaveText('Untitled');
  await page.locator('.cm-content').filter({ visible: true }).click();
  await page.keyboard.type('# Prueba\n\nTexto con [[Otra nota]]');
  await page.waitForTimeout(700);
  await page.reload();
  await openLeft(page);
  await page.locator('.tree-item-self', { hasText: 'Untitled' }).click();
  await expect(page.locator('.cm-content').filter({ visible: true })).toContainText('Texto con');
  // tocar el link crea la nota destino
  await page.locator('.cm-content').filter({ visible: true }).locator('.ml-wikilink').click();
  await expect(noteTitle(page)).toHaveText('Otra nota');
});

test('renombrar y borrar desde el explorador', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await openLeft(page);
  const item = page.locator('.tree-item-self', { hasText: 'Welcome' });
  if (isPhone(page)) {
    await item.dispatchEvent('contextmenu', { clientX: 120, clientY: 300 });
  } else await item.click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Rename' }).click();
  await page.locator('.prompt-input').fill('Inicio');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tree-item-self', { hasText: 'Inicio' })).toBeVisible();
  const renamed = page.locator('.tree-item-self', { hasText: 'Inicio' });
  if (isPhone(page)) await renamed.dispatchEvent('contextmenu', { clientX: 120, clientY: 300 });
  else await renamed.click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Delete' }).click();
  await page.locator('.modal button.mod-warning').click();
  await expect(page.locator('.tree-item-self', { hasText: 'Inicio' })).toHaveCount(0);
});

test('dividir panel a la derecha', async ({ page }) => {
  test.skip(isPhone(page), 'en el teléfono no hay paneles divididos');
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.locator('.mod-root .workspace-tab-header.is-active').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Split right' }).click();
  await expect(page.locator('.mod-root .workspace-tabs')).toHaveCount(2);
  await page.screenshot({ path: `test-results/split-${test.info().project.name}.png` });
});

test('los ajustes se aplican con Apply', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(() => (window as unknown as { app: { openSettings(id: string): void } }).app.openSettings('appearance'));
  const bar = page.locator('.settings-apply-bar');
  await expect(bar).toBeHidden();
  const dark = await page.evaluate(() => document.body.classList.contains('theme-dark'));
  await page.locator('.setting-item', { hasText: 'Theme' }).locator('select').selectOption(dark ? 'light' : 'dark');
  await expect(bar).toBeVisible();
  // todavía no cambió nada
  expect(await page.evaluate(() => document.body.classList.contains('theme-dark'))).toBe(dark);
  await page.screenshot({ path: `test-results/apply-${test.info().project.name}.png` });
  await bar.locator('button.mod-cta').click();
  await expect(bar).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('theme-dark'))).toBe(!dark);
});
