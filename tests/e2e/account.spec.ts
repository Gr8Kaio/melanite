import { test, expect, type Page, type Route } from '@playwright/test';

// Todo el Supabase está simulado con page.route: nunca se toca el servidor real ni se mandan emails.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 768;
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/account-${name}-${test.info().project.name}.png` });

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'ana@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: USER.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user: USER };
};
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Calls { otp: unknown[]; verify: unknown[]; recover: unknown[]; signup: unknown[]; updateUser: unknown[] }

async function mockSupabase(page: Page): Promise<Calls> {
  const calls: Calls = { otp: [], verify: [], recover: [], signup: [], updateUser: [] };
  await page.routeWebSocket(/realtime/, (ws) => void ws.close());
  await page.route(/\/(rest|storage)\/v1\//, (route) => (route.request().method() === 'GET' ? json(route, 200, []) : json(route, 200, {})));
  await page.route(/\/auth\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()!) : {};
    const path = url.pathname.replace(/^.*\/auth\/v1/, '');
    if (path === '/token') {
      return body.password === 'wrong'
        ? json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
        : json(route, 200, session());
    }
    if (path === '/otp') {
      calls.otp.push(body);
      return body.email === 'limit@example.com'
        ? json(route, 429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' })
        : json(route, 200, {});
    }
    if (path === '/verify') {
      calls.verify.push(body);
      return body.token === '12345678' ? json(route, 200, session()) : json(route, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    }
    if (path === '/recover') { calls.recover.push(body); return json(route, 200, {}); }
    if (path === '/signup') { calls.signup.push(body); return json(route, 200, { ...USER, email: body.email, identities: [{}] }); }
    if (path === '/user') { if (req.method() === 'PUT') calls.updateUser.push(body); return json(route, 200, USER); }
    if (path === '/logout') return route.fulfill({ status: 204 });
    return json(route, 200, {});
  });
  return calls;
}

async function ready(page: Page) {
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  await page.evaluate(() => (window as any).app.openSettings('sync'));
  await expect(page.locator('.vertical-tab-content h2')).toHaveText('Sync');
}

const pane = (page: Page) => page.locator('.vertical-tab-content');

test('formulario de entrada, error de contraseña y login correcto + cerrar sesión', async ({ page }) => {
  await mockSupabase(page);
  await ready(page);
  await expect(pane(page).locator('input[name=email]')).toHaveAttribute('autocomplete', 'email');
  await shot(page, 'sin-sesion');

  await pane(page).locator('input[name=email]').fill('ana@example.com');
  await pane(page).locator('input[name=password]').fill('wrong');
  await pane(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(pane(page).locator('.account-error')).toHaveText('Wrong email or password.');
  await shot(page, 'error');

  await pane(page).locator('input[name=password]').fill('right-pass');
  await pane(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(pane(page)).toContainText('ana@example.com');
  await expect(pane(page).getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(pane(page)).toContainText('Pending files');
  expect(await page.evaluate(() => (window as any).app.sync.state.enabled)).toBe(true);
  await shot(page, 'con-sesion');

  await pane(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('.modal-title', { hasText: 'Sign out?' })).toBeVisible();
  await expect(page.locator('.modal-content').last()).toContainText('stay here on this device');
  await page.locator('.modal-button-container button.mod-warning').click();
  await expect(pane(page).locator('input[name=password]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).app.sync.state.enabled)).toBe(false);
});

test('código por email (OTP): enviar, código mal, código bien; límite de emails', async ({ page }) => {
  const calls = await mockSupabase(page);
  await ready(page);
  await pane(page).getByRole('tab', { name: 'Email code' }).click();

  await pane(page).locator('input[name=email]').fill('limit@example.com');
  await pane(page).getByRole('button', { name: 'Send code' }).click();
  await expect(pane(page).locator('.account-error')).toContainText('Too many emails');

  await pane(page).locator('input[name=email]').fill('ana@example.com');
  await pane(page).getByRole('button', { name: 'Send code' }).click();
  const code = pane(page).locator('input[name=code]');
  await expect(code).toBeVisible();
  // sin magic link: no hay emailRedirectTo y se crea el usuario si no existe
  expect(calls.otp.at(-1)).toMatchObject({ email: 'ana@example.com', create_user: true });
  expect(JSON.stringify(calls.otp.at(-1))).not.toContain('redirect');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(pane(page)).toContainText('email-templates.md');
  if (isPhone(page)) expect((await code.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, 'codigo');

  await code.fill('000000');
  await pane(page).getByRole('button', { name: 'Verify' }).click();
  await expect(pane(page).locator('.account-error')).toContainText('Wrong or expired code');

  await code.fill('12345678');
  await pane(page).getByRole('button', { name: 'Verify' }).click();
  await expect(pane(page)).toContainText('ana@example.com');
  expect(calls.verify.at(-1)).toMatchObject({ email: 'ana@example.com', token: '12345678', type: 'email' });
});

test('olvidé mi contraseña: código de recuperación y contraseña nueva', async ({ page }) => {
  const calls = await mockSupabase(page);
  await ready(page);
  await pane(page).locator('input[name=email]').fill('ana@example.com');
  await pane(page).getByRole('button', { name: 'Forgot my password' }).click();
  await pane(page).locator('input[name=code]').fill('12345678');
  await pane(page).getByRole('button', { name: 'Verify' }).click();
  expect(calls.recover).toHaveLength(1);
  await pane(page).locator('input[name=new-password]').fill('brand-new-pass');
  await pane(page).getByRole('button', { name: 'Set password' }).click();
  await expect(pane(page)).toContainText('ana@example.com');
  expect(calls.updateUser.at(-1)).toMatchObject({ password: 'brand-new-pass' });
});

test('indicador de estado: invita a entrar y abre la pestaña Sync; con sesión cambia', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('./');
  await expect(page.locator('.cm-content')).toContainText('Welcome');
  const ind = page.locator(isPhone(page) ? '.mobile-navbar .account-indicator' : '.status-bar .account-indicator');
  await expect(ind).toBeVisible();
  await expect(ind).toHaveAttribute('data-status', 'off');
  await expect(ind).toHaveAttribute('title', /Click to sign in/);
  await shot(page, 'indicador-off');
  await ind.click();
  await expect(page.locator('.vertical-tab-content h2')).toHaveText('Sync');
  await pane(page).locator('input[name=email]').fill('ana@example.com');
  await pane(page).locator('input[name=password]').fill('right-pass');
  await pane(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(pane(page)).toContainText('Pending files');
  await expect(ind).not.toHaveAttribute('data-status', 'off');
  await expect(ind).toHaveAttribute('title', /pending/);
  await page.locator('.modal-close-button').click();
  await shot(page, 'indicador-on');
});

test('lista los conflictos de la sesión', async ({ page }) => {
  await mockSupabase(page);
  await ready(page);
  await pane(page).locator('input[name=email]').fill('ana@example.com');
  await pane(page).locator('input[name=password]').fill('right-pass');
  await pane(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(pane(page)).toContainText('No conflicts.');
  await page.evaluate(async () => {
    const app = (window as any).app;
    await app.vault.create('nota.md', 'hola');
    await app.vault.create('nota (conflict 2026-01-01).md', 'copia');
    app.sync.conflicts.push({ kind: 'edit', path: 'nota.md', copyPath: 'nota (conflict 2026-01-01).md', time: Date.now() });
    app.sync.trigger('conflict', app.sync.conflicts[0]);
  });
  await expect(pane(page).locator('.account-conflict')).toContainText('nota (conflict 2026-01-01).md');
  await shot(page, 'conflictos');
  await pane(page).getByRole('button', { name: 'Open copy' }).click();
  await expect(page.locator('.modal.mod-settings')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('copia');
});
