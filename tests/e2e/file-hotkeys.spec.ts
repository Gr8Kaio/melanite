import { test, expect } from '@playwright/test';

test('atajos de archivo: Alt+D duplica, Alt+B marca, Alt+Delete borra, y el menú los muestra', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) <= 768, 'atajos de teclado: solo escritorio');
  await page.goto('./');
  await expect(page.locator('.cm-content').first()).toContainText('Welcome');

  const menu = page.locator('.menu');
  await page.locator('.tree-item-self', { hasText: 'Welcome' }).click({ button: 'right' });
  await expect(menu.locator('.menu-item', { hasText: 'Duplicate' }).locator('.menu-item-shortcut')).toHaveText('Alt+D');
  await expect(menu.locator('.menu-item', { hasText: 'Delete' }).locator('.menu-item-shortcut')).toHaveText('Alt+Delete');
  await expect(menu.locator('.menu-item', { hasText: 'Bookmark' }).locator('.menu-item-shortcut')).toHaveText('Alt+B');
  await page.keyboard.press('Escape');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Alt+d');
  await expect(page.locator('.tree-item-self', { hasText: /Welcome \d/ })).toHaveCount(1);

  await page.keyboard.press('Alt+b');
  // el marcador aparece como un segundo "Welcome" (explorador + panel de marcadores)
  await expect(page.locator('.tree-item-self', { hasText: /^Welcome$/ })).toHaveCount(2);

  await page.keyboard.press('Alt+Delete');
  await page.locator('.modal button.mod-warning').click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { app: { vault: { getFileByPath(p: string): unknown } } }).app.vault.getFileByPath('Welcome.md'))).toBe(false);
});

test('los botones muestran su atajo al pasar el mouse', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) <= 768, 'tooltips: solo escritorio');
  await page.goto('./');
  await expect(page.locator('.cm-content').first()).toContainText('Welcome');
  const tip = async (sel: string, label: string) => {
    const b = page.locator(`${sel}[aria-label="${label}"]`).first();
    await b.hover();
    return b.getAttribute('title');
  };
  expect(await tip('.nav-action-button', 'New note')).toBe('New note (Ctrl+N)');
  expect(await tip('.nav-action-button', 'New folder')).toBe('New folder (Alt+Shift+N)');
  expect(await tip('.nav-action-button', 'Collapse all')).toBe('Collapse all (Alt+Shift+C)');
  expect(await tip('.side-dock-ribbon-action', 'Open settings')).toBe('Open settings (Ctrl+,)');
});
