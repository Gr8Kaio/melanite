import { test, expect } from '@playwright/test';

test('formato de hoja por nota desde el frontmatter', async ({ page }) => {
  await page.goto('./');
  const view = page.locator('.markdown-view.is-split').filter({ visible: true });
  await expect(view.locator('.ml-page').first()).toBeVisible();
  const setText = (s: string) => page.evaluate((s) => {
    (window as unknown as { app: { workspace: { activeLeaf: { view: { editor: { setValue(s: string): void } } } } } }).app.workspace.activeLeaf.view.editor.setValue(s);
  }, s);
  const sheet = () => view.locator('.ml-page').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { font: cs.fontSize, pad: cs.paddingTop, lh: cs.lineHeight, family: cs.fontFamily, numbers: getComputedStyle(el, '::after').content };
  });

  await setText('# Sin formato');
  await expect(view.locator('.ml-page h1')).toHaveText('Sin formato');
  const base = await sheet();
  expect(parseFloat(base.font)).toBeCloseTo((11 * 96) / 72, 2); // 11pt por defecto

  await setText('---\nfontsize: 9\nmargin: 15\nlineheight: 2\nfont: mono\npagenumbers: true\ntags: [fisica]\n---\n# Con formato');
  await expect(view.locator('.ml-page h1')).toHaveText('Con formato');
  const s = await sheet();
  expect(s.font).toBe('12px'); // 9pt
  expect(Math.round(parseFloat(s.pad))).toBe(57); // 15mm
  expect(s.lh).toBe('24px'); // 2 × 12px
  expect(s.family.toLowerCase()).toMatch(/mono|consol|courier/);
  expect(s.numbers).toContain('counter(ml-page)'); // la nota pide números aunque el ajuste esté apagado
  // las de formato no se muestran como propiedades; las demás sí
  const props = view.locator('.ml-page .ml-reading-props');
  await expect(props).toContainText('tags');
  await expect(props).not.toContainText('fontsize');
  await page.screenshot({ path: `test-results/page-format-${test.info().project.name}.png` });

  // sin nada inválido que rompa: queda el formato por defecto
  await setText('---\nfontsize: enorme\n---\n# Inválido');
  await expect(view.locator('.ml-page h1')).toHaveText('Inválido');
  expect((await sheet()).font).toBe(base.font);
  await expect(view.locator('.ml-page .ml-reading-props')).toHaveCount(0);
});
