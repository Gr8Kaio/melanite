import { test, expect, type Page } from '@playwright/test';

// el drawer del teléfono entra con una transición de 0.2 s
const shot = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `test-results/plugins-${name}-${test.info().project.name}.png` }); };

async function boot(page: Page) {
  await page.goto('./');
  // sin depender del idioma de la UI (inglés por defecto, español en Ajustes)
  await expect(page.locator('.cm-line').first()).toBeVisible();
}

const openSettings = (page: Page, tab: string) => page.evaluate((id) => (window as any).app.openSettings(id), tab);
const closeModal = (page: Page) => page.locator('.modal-container .modal-bg').last().click({ position: { x: 5, y: 5 } });
const run = (page: Page, id: string) => page.evaluate((cmd) => (window as any).app.commands.executeCommandById(cmd), id);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const readFile = (page: Page, path: string) => page.evaluate((p) => {
  const app = (window as any).app;
  const f = app.vault.getFileByPath(p);
  return f ? app.vault.cachedReadSync(f) as string : null;
}, path);

test('activar y desactivar un plugin interno limpia lo que registró', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.plugin-word-count')).toContainText(/\d+ \S+ · \d+/);
  await openSettings(page, 'core-plugins');
  const pane = page.locator('.vertical-tab-content');
  await expect(pane.locator('.plugin-core-item')).toHaveCount(await page.evaluate(() => (window as any).app.plugins.core.size));
  await shot(page, 'internos');

  // word-count: el ítem de la barra de estado desaparece y vuelve
  const wc = pane.locator('.plugin-core-item[data-plugin-id="word-count"] .checkbox-container');
  await wc.click();
  await expect(page.locator('.plugin-word-count')).toHaveCount(0);
  await wc.click();
  await expect(page.locator('.plugin-word-count')).toHaveCount(1);

  // bookmarks: se van su comando y su vista; al volver, vuelven
  const has = () => page.evaluate(() => {
    const app = (window as any).app;
    return { cmd: !!app.commands.commands['bookmarks:bookmark-current'], leaves: app.workspace.getLeavesOfType('bookmarks').length };
  });
  expect(await has()).toEqual({ cmd: true, leaves: 1 });
  await pane.locator('.plugin-core-item[data-plugin-id="bookmarks"] .checkbox-container').click();
  await expect.poll(has).toEqual({ cmd: false, leaves: 0 });
  await pane.locator('.plugin-core-item[data-plugin-id="bookmarks"] .checkbox-container').click();
  await expect.poll(has).toEqual({ cmd: true, leaves: 1 });
  await closeModal(page);

  // queda guardado en el vault
  expect(JSON.parse((await readFile(page, '.melanite/core-plugins.json'))!)).toMatchObject({ 'word-count': true, bookmarks: true });
});

test('nota diaria, plantillas y marcadores', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).app.vault.create('plantillas/Reunión.md', '## {{title}} · {{date:YYYY}}\n- '));
  await run(page, 'daily-notes:open-today');
  await expect(page.locator('.view-header-title').filter({ visible: true })).toHaveText(today());

  await run(page, 'templates:insert');
  await page.locator('.mod-pick .suggestion-item', { hasText: 'Reunión' }).click();
  await expect(page.locator('.cm-content').filter({ visible: true })).toContainText(`${today()} · ${new Date().getFullYear()}`);

  await run(page, 'bookmarks:bookmark-current');
  await expect(page.locator('.bookmark-item')).toContainText(today());
  expect(await readFile(page, '.melanite/bookmarks.json')).toContain(`${today()}.md`);
});

test('instalar el Pomodoro de ejemplo y anotar un bloque en la nota diaria', async ({ page }) => {
  await boot(page);
  await openSettings(page, 'community-plugins');
  const pane = page.locator('.vertical-tab-content');
  await expect(pane.locator('.plugins-warning')).toBeVisible();
  // la sección "Agregar plugin" va arriba, con las tres vías juntas
  const add = pane.locator('.plugins-add-section');
  await expect(add.locator('.plugins-zip-setting, .plugins-url-setting, .plugins-sample-setting')).toHaveCount(3);
  await add.locator('.plugins-sample-setting button').click();
  const row = pane.locator('.plugin-community-item[data-plugin-id="pomodoro"]');
  await expect(row).toBeVisible();
  await row.locator('.checkbox-container').click();
  await expect(row.locator('.checkbox-container')).toHaveClass(/is-enabled/);
  await expect(page.locator('style[data-plugin="pomodoro"]')).toHaveCount(1);
  await expect(row.locator('.extra-setting-button').first()).toBeVisible();
  await shot(page, 'comunidad');
  await closeModal(page);

  await run(page, 'pomodoro:open');
  const view = page.locator('.pomodoro');
  await expect(view).toBeVisible();
  await expect(view.locator('.pomodoro-time')).toHaveText('25:00');
  await expect(view.locator('.pomodoro-count')).toHaveText(/1\D+3/);
  await view.locator('.pomodoro-label').fill('vuelo');
  await view.locator('.pomodoro-label').press('Enter');
  await view.locator('.pomodoro-toggle').click();
  await expect(page.locator('.pomodoro-status')).toContainText(/ 2[45]:\d\d/);
  await expect(view.locator('.pomodoro-toggle')).toHaveAttribute('data-running', 'true');
  await shot(page, 'pomodoro');

  // el tiempo pasa: el bloque venció hace un rato (timestamps, no un contador)
  await page.evaluate(() => {
    const p = (window as any).app.plugins.getPlugin('pomodoro');
    p.state.startedAt = Date.now() - 25 * 60_000;
    p.state.endsAt = Date.now() - 10;
    return p.tick();
  });
  await expect(page.locator('.view-content[data-phase="short"] .pomodoro')).toBeVisible();
  await expect.poll(() => readFile(page, `${today()}.md`)).toMatch(/^- \d\d:\d\d–\d\d:\d\d · 25 min · vuelo$/m);

  // al recargar sigue: el plugin carga al arrancar y el descanso sigue corriendo
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.pomodoro-status')).toContainText(/ 0[0-5]:\d\d$/);
  await run(page, 'pomodoro:open');
  await expect(page.locator('.pomodoro-count')).toHaveText(/1\D+3/);
  await expect(page.locator('.pomodoro-dot.is-done')).toHaveCount(1);
  await shot(page, 'pomodoro-descanso');
});

test('sin notas diarias, el Pomodoro avisa en vez de fallar', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const app = (window as any).app;
    const files: Record<string, string> = {};
    for (const f of ['manifest.json', 'main.js', 'styles.css']) files[f] = await (await fetch(`plugins/pomodoro/${f}`)).text();
    await app.plugins.installPlugin(files);
    await app.plugins.setCoreEnabled('daily-notes', false);
    await app.plugins.setCommunityEnabled('pomodoro', true);
    const p = app.plugins.getPlugin('pomodoro');
    p.toggle();
    p.state.endsAt = Date.now() - 10;
    await p.tick();
  });
  await expect(page.locator('.notice', { hasText: /Daily notes|Notas diarias/ })).toBeVisible();
});
