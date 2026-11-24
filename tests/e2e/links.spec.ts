import { test, expect, type Page } from '@playwright/test';

/* Selectores por clase / data-attribute: no dependen del idioma de la UI. */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 768;
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/links-${name}-${test.info().project.name}.png` });

async function boot(page: Page, notes: Record<string, string> = {}) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).app?.workspace?.layoutReady);
  await page.evaluate(async (notes) => {
    const app = (window as any).app;
    for (const [p, text] of Object.entries(notes)) await app.vault.create(p, text);
  }, notes);
  await page.waitForTimeout(150); // índice (debounce de resolución)
}

const run = (page: Page, id: string) => page.evaluate((id) => (window as any).app.commands.executeCommandById(id), id);
const openNote = (page: Page, path: string) => page.evaluate((p) => (window as any).app.workspace.getLeaf(false).openFile((window as any).app.vault.getFileByPath(p)), path);
const noteText = (page: Page, path: string) => page.evaluate((p) => (window as any).app.vault.cachedReadSync((window as any).app.vault.getFileByPath(p)), path);
const title = (page: Page) => page.locator('.mod-root .view-header-title').filter({ visible: true });

/** Atajo de teclado en escritorio; en el teléfono no hay teclado físico: se ejecuta el comando. */
async function hotkey(page: Page, keys: string, id: string) {
  if (isPhone(page)) await run(page, id);
  else await page.keyboard.press(keys);
}

test('command palette: busca y ejecuta comandos', async ({ page }) => {
  await boot(page);
  await hotkey(page, 'Control+p', 'command-palette:open');
  const modal = page.locator('.modal.mod-suggest');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.suggestion-item').first()).toBeVisible();
  // el atajo se muestra junto al comando
  await expect(modal.locator('kbd.suggestion-hotkey').first()).toBeVisible();
  const name = await page.evaluate(() => (window as any).app.commands.commands['file:new'].name);
  await modal.locator('.prompt-input').fill(name);
  await shot(page, 'palette');
  await page.keyboard.press('Enter');
  await expect(modal).toHaveCount(0);
  await expect(title(page)).toHaveText(await page.evaluate(() => (window as any).app.workspace.getActiveFile().basename));
  // recientes: el último usado aparece primero
  await hotkey(page, 'Control+p', 'command-palette:open');
  await expect(page.locator('.mod-suggest .suggestion-item .suggestion-title').first()).toHaveText(name);
});

test('quick switcher: abre, busca por alias y crea', async ({ page }) => {
  await boot(page, { 'notas/Zeta proyecto.md': '---\naliases: [Omega]\n---\nhola', 'Alfa.md': 'a' });
  await hotkey(page, 'Control+o', 'switcher:open');
  const modal = page.locator('.modal.mod-suggest');
  await modal.locator('.prompt-input').fill('zpro');
  await expect(modal.locator('.suggestion-item').first()).toContainText('Zeta proyecto');
  await shot(page, 'switcher');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Zeta proyecto');

  await hotkey(page, 'Control+o', 'switcher:open');
  await modal.locator('.prompt-input').fill('omega');
  await expect(modal.locator('.suggestion-item').first()).toContainText('Omega');
  await modal.locator('.suggestion-item').first().click();
  await expect(title(page)).toHaveText('Zeta proyecto');

  await hotkey(page, 'Control+o', 'switcher:open');
  await modal.locator('.prompt-input').fill('Nota nueva');
  await page.keyboard.press('Shift+Enter');
  await expect(title(page)).toHaveText('Nota nueva');
});

test('backlinks y menciones sin linkear', async ({ page }) => {
  await boot(page, {
    'Destino.md': '# Destino\n\n## Parte\ntexto',
    'Origen.md': 'Esto apunta a [[Destino]] desde acá.',
    'Suelta.md': 'Hablo de Destino sin link.',
  });
  await openNote(page, 'Destino.md');
  await run(page, 'backlink:open');
  const pane = page.locator('.ml-backlinks').filter({ visible: true });
  await expect(pane.locator('.ml-result-file-title[data-path="Origen.md"]')).toBeVisible();
  await expect(pane.locator('.ml-result-match').first()).toContainText('apunta a [[Destino]]');
  await expect(pane.locator('.ml-result-file-title[data-path="Suelta.md"]')).toBeVisible();
  await shot(page, 'backlinks');
  await pane.locator('.ml-result-action').first().click();
  await expect.poll(() => noteText(page, 'Suelta.md')).toBe('Hablo de [[Destino]] sin link.');

  // links salientes y esquema
  await run(page, 'outline:open');
  await expect(page.locator('.ml-outline-item').filter({ visible: true })).toHaveText(['Destino', 'Parte']);
  await shot(page, 'outline');
});

test('renombrar una nota actualiza los links entrantes', async ({ page }) => {
  await boot(page, { 'Vieja.md': '# H', 'Otra.md': 'Ver [[Vieja]] y [[Vieja#H|alias]] y [md](Vieja.md)' });
  await openNote(page, 'Vieja.md');
  await title(page).click();
  await page.locator('.modal .prompt-input').fill('Nueva');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Nueva');
  await expect.poll(() => noteText(page, 'Otra.md')).toBe('Ver [[Nueva]] y [[Nueva#H|alias]] y [md](Nueva.md)');
});

test('búsqueda full-text con operadores', async ({ page }) => {
  await boot(page, {
    'docs/Receta.md': 'Harina y azúcar\n#cocina',
    'docs/Otra.md': 'Solo harina',
    'Lejos.md': 'azúcar sola #cocina',
  });
  await hotkey(page, 'Control+Shift+f', 'global-search:open');
  const pane = page.locator('.ml-search').filter({ visible: true });
  const input = pane.locator('.ml-search-input');
  await expect(input).toBeVisible();
  await input.fill('harina -solo');
  await expect(pane.locator('.ml-result-file-title')).toHaveCount(1);
  await expect(pane.locator('.ml-result-file-title')).toHaveAttribute('data-path', 'docs/Receta.md');
  await expect(pane.locator('.suggestion-highlight').first()).toHaveText('Harina');
  await input.fill('tag:#cocina path:docs');
  await expect(pane.locator('.ml-result-file-title')).toHaveCount(1);
  await input.fill('azúcar OR "solo harina"');
  await expect(pane.locator('.ml-result-file-title')).toHaveCount(3);
  await shot(page, 'search');
  await pane.locator('.ml-result-file-title[data-path="Lejos.md"]').click();
  await expect(title(page)).toHaveText('Lejos');
});

test('autocompletado de [[ y propiedades', async ({ page }) => {
  await boot(page, { 'Zanahoria.md': '# Raíz\n', 'Prueba.md': '---\ntags: [huerta]\nestado: activo\nlisto: false\n---\n' });
  await openNote(page, 'Prueba.md');
  const editor = page.locator('.cm-content').filter({ visible: true });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('[[Zana');
  const tip = page.locator('.cm-tooltip-autocomplete');
  await expect(tip).toBeVisible();
  await expect(tip.locator('li').first()).toContainText('Zanahoria');
  await shot(page, 'autocomplete');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).app.getActiveMarkdownView().getViewData())).toContain('[[Zanahoria]]');

  await run(page, 'properties:open');
  const props = page.locator('.ml-properties').filter({ visible: true });
  await expect(props.locator('.ml-prop-row')).toHaveCount(3);
  await props.locator('.ml-prop-row[data-key="listo"] input[type="checkbox"]').check();
  await expect.poll(() => noteText(page, 'Prueba.md')).toContain('listo: true');
  const listInput = props.locator('.ml-prop-row[data-key="tags"] .ml-prop-list-input');
  await listInput.fill('jardin');
  await listInput.press('Enter');
  await expect.poll(() => noteText(page, 'Prueba.md')).toContain('- jardin');
  await expect.poll(() => noteText(page, 'Prueba.md')).toContain('[[Zanahoria]]');
  await shot(page, 'properties');
});

test('pestaña de atajos: asignar y guardar', async ({ page }) => {
  test.skip(isPhone(page), 'sin teclado físico');
  await boot(page);
  await page.evaluate(() => (window as any).app.openSettings('hotkeys'));
  const row = page.locator('.ml-hotkey-row[data-command="workspace:split-vertical"]');
  await row.locator('.ml-hotkey-add').click();
  await page.keyboard.press('Alt+Shift+KeyV');
  await expect(row.locator('.ml-hotkey')).toHaveCount(1);
  await shot(page, 'hotkeys');
  const saved = await page.evaluate(async () => (window as any).app.readConfig('hotkeys.json'));
  expect(saved['workspace:split-vertical'][0]).toEqual({ modifiers: ['Alt', 'Shift'], key: 'v' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Shift+KeyV');
  await expect(page.locator('.mod-root .workspace-tabs')).toHaveCount(2);
});
