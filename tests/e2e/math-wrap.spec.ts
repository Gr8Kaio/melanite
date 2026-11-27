import { test, expect } from '@playwright/test';

const LARGA = 'V = \\sqrt{\\frac{2W}{\\rho S C_L}} \\qquad\\Longleftrightarrow\\qquad C_L = \\frac{w}{\\tfrac12 \\rho_0 V_e^2} + \\frac{a+b+c+d}{e+f+g+h} + \\frac{a+b+c+d}{e+f+g+h} + \\frac{a+b+c+d}{e+f+g+h}, \\quad w = W/S,\\ V_e = V\\sqrt{\\sigma}';
const ALIGNED = '\\begin{aligned} T\\cos(\\alpha+\\phi_T) - D - W\\sin\\gamma - D - W\\sin\\gamma - D - W\\sin\\gamma - D - W\\sin\\gamma - D - W\\sin\\gamma &= 0 \\\\ L &= W \\end{aligned}';

test('fórmulas largas: saltan de línea o se achican, nunca barra de scroll', async ({ page }) => {
  await page.goto('./');
  const view = page.locator('.markdown-view.is-split').filter({ visible: true });
  await expect(view.locator('.ml-page').first()).toBeVisible();
  await page.evaluate(({ a, b }) => {
    (window as unknown as { app: { workspace: { activeLeaf: { view: { editor: { setValue(s: string): void } } } } } })
      .app.workspace.activeLeaf.view.editor.setValue(`Texto\n\n$$\n${a}\n$$\n\n$$\n${b}\n$$\n\n$$\nE = mc^2\n$$`);
  }, { a: LARGA, b: ALIGNED });
  const blocks = view.locator('.ml-page .math-block');
  await expect(blocks).toHaveCount(3);
  await expect(blocks.first().locator('.katex')).toBeVisible();
  const info = await blocks.evaluateAll((els) => els.map((el) => {
    const bases = Array.from(el.querySelectorAll('.katex-html > .katex-base'));
    const lines = new Set(bases.map((b) => Math.round(b.getBoundingClientRect().top)));
    const k = el.querySelector<HTMLElement>('.katex')!;
    return { overflow: el.scrollWidth - el.clientWidth, lines: lines.size, zoom: k.style.zoom };
  }));
  for (const i of info) expect(i.overflow).toBeLessThanOrEqual(1);
  expect(info[0].lines).toBeGreaterThan(1); // la larga se partió en dos o más líneas
  expect(info[0].zoom).toBe(''); // y sin achicarse
  expect(Number(info[1].zoom)).toBeLessThan(1); // el aligned no se puede partir: se achica
  expect(info[2]).toEqual({ overflow: 0, lines: 1, zoom: '' });
  await page.screenshot({ path: `test-results/math-wrap-${test.info().project.name}.png` });
});
