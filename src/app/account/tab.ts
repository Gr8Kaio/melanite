import type { SupabaseClient } from '@supabase/supabase-js';
import type { App } from '../app';
import { SettingTab } from '../views/settings';
import { Setting } from '../ui/setting';
import { confirmDialog } from '../ui/modal';
import { getLanguage, t } from '../i18n';
import { getSupabaseClient, type SyncState } from '../../core/sync';
import { setIcon } from '../ui/icons';

/** Traduce un error de Supabase Auth (o de red) a un texto claro. */
export function authError(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string; status?: number; name?: string };
  const msg = err.message ?? String(e);
  const code = err.code ?? '';
  if (!navigator.onLine || err.name === 'AuthRetryableFetchError' || err.status === 0 || /failed to fetch|network|load failed/i.test(msg)) return t('account.errOffline');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return t('account.errInvalid');
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return t('account.errUnconfirmed');
  if (/over_.*rate_limit/.test(code) || /rate limit|too many requests|security purposes/i.test(msg)) return t('account.errRate');
  if (code === 'otp_expired' || /expired|invalid.*(token|otp)|token.*invalid/i.test(msg)) return t('account.errCode');
  if (code === 'user_already_exists') return t('account.errExists');
  if (code === 'weak_password' || /password should be/i.test(msg)) return t('account.errWeak');
  return t('account.errUnknown', { msg });
}

/** "hace 5 min" en el idioma de la app. */
export function ago(ms: number | null): string {
  if (!ms) return t('account.never');
  const s = Math.round((Date.now() - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLanguage(), { numeric: 'auto' });
  if (s < 60) return rtf.format(-Math.max(s, 0), 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

type CodeType = 'email' | 'signup' | 'recovery';
type View =
  | { k: 'form'; mode: 'password' | 'code' }
  | { k: 'code'; email: string; type: CodeType }
  | { k: 'newpass' }
  | { k: 'session'; email: string };

export class AccountTab extends SettingTab {
  id = 'sync';
  name = t('account.tab');
  private client: SupabaseClient | null = null;
  private view: View = { k: 'form', mode: 'password' };
  private body!: HTMLElement;
  private refs: ReturnType<App['sync']['on']>[] = [];
  private gen = 0;

  display(): void {
    this.body = this.containerEl.createDiv('account-body');
    this.body.createDiv({ cls: 'account-hint', text: t('account.loading') });
    const gen = ++this.gen;
    void (async () => {
      this.client = await getSupabaseClient();
      if (gen !== this.gen) return;
      if (!this.client) { this.body.empty(); this.body.createEl('p', { cls: 'account-hint', text: t('account.noConfig') }); return; }
      const { data } = await this.client.auth.getSession();
      if (gen !== this.gen) return;
      const email = data.session?.user.email ?? '';
      // en mitad de una recuperación de contraseña la sesión ya existe pero falta elegir la nueva
      if (data.session && this.view.k !== 'newpass') this.view = { k: 'session', email };
      else if (!data.session && this.view.k === 'session') this.view = { k: 'form', mode: 'password' };
      this.render();
      const refresh = () => { if (this.view.k === 'session') this.render(); };
      this.refs = [this.app.sync.on('status', refresh), this.app.sync.on('conflict', refresh)];
    })();
  }

  hide(): void {
    this.gen++;
    for (const r of this.refs) this.app.sync.offref(r);
    this.refs = [];
    super.hide();
  }

  private go(v: View) { this.view = v; this.render(); }

  private render(): void {
    this.body.empty();
    const v = this.view;
    if (v.k === 'session') this.renderSession(v.email);
    else if (v.k === 'form') this.renderForm(v.mode);
    else if (v.k === 'code') this.renderCode(v);
    else this.renderNewPassword();
  }

  // ------------------------------------------------------------ helpers de formulario

  private form(onSubmit: () => Promise<void>): { form: HTMLFormElement; error: HTMLElement } {
    const form = this.body.createEl('form', { cls: 'account-form', attr: { novalidate: '' } });
    const error = createDiv({ cls: 'account-error', attr: { role: 'alert' } });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      error.setText('');
      const btns = [...form.querySelectorAll('button')];
      btns.forEach((b) => (b.disabled = true));
      onSubmit().catch((err) => error.setText(authError(err))).finally(() => btns.forEach((b) => (b.disabled = false)));
    });
    return { form, error };
  }

  private field(form: HTMLElement, label: string, attr: Record<string, string>, value = ''): HTMLInputElement {
    const row = form.createDiv('account-field');
    const id = `account-${attr.name}`;
    row.createEl('label', { text: label, attr: { for: id } });
    const input = row.createEl('input', { type: attr.type ?? 'text', attr: { id, ...attr } });
    input.value = value;
    return input;
  }

  private btn(parent: HTMLElement, text: string, opts: { cta?: boolean; submit?: boolean; onClick?: () => unknown } = {}): HTMLButtonElement {
    const b = parent.createEl('button', { text, cls: opts.cta ? 'mod-cta' : '', attr: { type: opts.submit ? 'submit' : 'button' } });
    if (opts.onClick) b.addEventListener('click', () => void opts.onClick!());
    return b;
  }

  private async enter(session: { user: { email?: string } }): Promise<void> {
    await this.app.sync.start(this.client!);
    this.go({ k: 'session', email: session.user.email ?? '' });
  }

  // ------------------------------------------------------------ sin sesión

  private renderForm(mode: 'password' | 'code'): void {
    const client = this.client!;
    this.body.createEl('p', { cls: 'account-hint', text: t('account.intro') });
    const modes = this.body.createDiv({ cls: 'account-modes', attr: { role: 'tablist' } });
    for (const [m, label] of [['password', t('account.modePassword')], ['code', t('account.modeCode')]] as const) {
      const b = modes.createEl('button', { text: label, cls: m === mode ? 'is-active' : '', attr: { role: 'tab', type: 'button', 'aria-selected': String(m === mode) } });
      b.addEventListener('click', () => { this.go({ k: 'form', mode: m }); });
    }
    let email: HTMLInputElement;
    let password: HTMLInputElement | null = null;
    const emailAttr = { type: 'email', name: 'email', autocomplete: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', inputmode: 'email' };
    const { form, error } = this.form(async () => {
      const addr = email.value.trim();
      if (!addr) { error.setText(t('account.fillEmail')); return; }
      if (mode === 'code') {
        const { error: e } = await client.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
        if (e) throw e;
        this.go({ k: 'code', email: addr, type: 'email' });
        return;
      }
      if (!password!.value) { error.setText(t('account.fillPassword')); return; }
      const { data, error: e } = await client.auth.signInWithPassword({ email: addr, password: password!.value });
      if (e) throw e;
      await this.enter(data.session);
    });
    email = this.field(form, t('account.email'), emailAttr);
    if (mode === 'password') password = this.field(form, t('account.password'), { type: 'password', name: 'password', autocomplete: 'current-password' });
    form.appendChild(error);
    const actions = form.createDiv('account-actions');
    if (mode === 'password') {
      this.btn(actions, t('account.signIn'), { cta: true, submit: true });
      this.btn(actions, t('account.signUp'), {
        onClick: async () => {
          const addr = email.value.trim();
          if (!addr || !password!.value) { error.setText(t('account.fillPassword')); return; }
          if (password!.value.length < 6) { error.setText(t('account.weakShort')); return; }
          form.querySelectorAll('button').forEach((b) => (b.disabled = true));
          try {
            const { data, error: e } = await client.auth.signUp({ email: addr, password: password!.value });
            if (e) throw e;
            if (data.session) await this.enter(data.session);
            else this.go({ k: 'code', email: addr, type: 'signup' }); // pide confirmar el email: el código llega en el mail
          } catch (err) { error.setText(authError(err)); } finally { form.querySelectorAll('button').forEach((b) => (b.disabled = false)); }
        },
      });
      const forgot = this.btn(form, t('account.forgot'), {
        onClick: async () => {
          const addr = email.value.trim();
          if (!addr) { error.setText(t('account.fillEmail')); return; }
          forgot.disabled = true;
          try {
            const { error: e } = await client.auth.resetPasswordForEmail(addr);
            if (e) throw e;
            this.go({ k: 'code', email: addr, type: 'recovery' });
          } catch (err) { error.setText(authError(err)); } finally { forgot.disabled = false; }
        },
      });
      forgot.addClass('account-link');
    } else {
      this.btn(actions, t('account.sendCode'), { cta: true, submit: true });
    }
  }

  private renderCode(v: Extract<View, { k: 'code' }>): void {
    const client = this.client!;
    const msg = v.type === 'signup' ? 'account.signupSent' : v.type === 'recovery' ? 'account.recoverySent' : 'account.codeSent';
    this.body.createEl('p', { cls: 'account-hint', text: t(msg, { email: v.email }) });
    let code: HTMLInputElement;
    const { form, error } = this.form(async () => {
      const token = code.value.replace(/\s/g, '');
      if (!token) { error.setText(t('account.fillCode')); return; }
      const { data, error: e } = await client.auth.verifyOtp({ email: v.email, token, type: v.type });
      if (e) throw e;
      if (v.type === 'recovery') this.go({ k: 'newpass' });
      else await this.enter(data.session!);
    });
    code = this.field(form, t('account.code'), {
      name: 'code', autocomplete: 'one-time-code', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '8', placeholder: t('account.codePlaceholder'),
    });
    form.appendChild(error);
    const actions = form.createDiv('account-actions');
    this.btn(actions, t('account.verify'), { cta: true, submit: true });
    this.btn(actions, t('account.back'), { onClick: () => this.go({ k: 'form', mode: v.type === 'email' ? 'code' : 'password' }) });
    const resend = this.btn(form, t('account.resend'), {
      onClick: async () => {
        resend.disabled = true;
        error.setText('');
        try {
          const { error: e } = v.type === 'recovery' ? await client.auth.resetPasswordForEmail(v.email)
            : v.type === 'signup' ? await client.auth.resend({ type: 'signup', email: v.email })
            : await client.auth.signInWithOtp({ email: v.email, options: { shouldCreateUser: true } });
          if (e) throw e;
        } catch (err) { error.setText(authError(err)); } finally { resend.disabled = false; }
      },
    });
    resend.addClass('account-link');
    this.body.createEl('p', { cls: 'account-hint account-help', text: `${t('account.codeHelp')} ${t('account.rateHelp')}` });
    code.focus();
  }

  private renderNewPassword(): void {
    const client = this.client!;
    this.body.createEl('p', { cls: 'account-hint', text: t('account.recoveryNew') });
    let pw: HTMLInputElement;
    const { form, error } = this.form(async () => {
      if (pw.value.length < 6) { error.setText(t('account.weakShort')); return; }
      const { data, error: e } = await client.auth.updateUser({ password: pw.value });
      if (e) throw e;
      await this.enter({ user: data.user });
    });
    pw = this.field(form, t('account.newPassword'), { type: 'password', name: 'new-password', autocomplete: 'new-password' });
    form.appendChild(error);
    this.btn(form.createDiv('account-actions'), t('account.setPassword'), { cta: true, submit: true });
  }

  // ------------------------------------------------------------ con sesión

  private renderSession(email: string): void {
    const el = this.body;
    const sync = this.app.sync;
    const s: SyncState = sync.state;
    new Setting(el).setName(t('account.signedInAs')).setDesc(email);
    new Setting(el).setName(t('account.status')).then((st) => {
      const badge = st.controlEl.createSpan({ cls: `account-badge is-${s.status}` });
      setIcon(badge.createSpan('account-badge-icon'), statusIcon(s.status));
      badge.createSpan({ text: t(`account.status.${s.status}`) });
    });
    new Setting(el).setName(t('account.pending')).then((st) => st.controlEl.createSpan({ cls: 'account-value', text: String(s.pending) }));
    new Setting(el).setName(t('account.lastSync')).then((st) => st.controlEl.createSpan({ cls: 'account-value', text: ago(s.lastSync) }));
    if (s.lastError) new Setting(el).setName(t('account.lastError')).setDesc(s.lastError).setClass('account-error-row');
    new Setting(el)
      .addButton((b) => b.setButtonText(t('account.syncNow')).setCta().setDisabled(s.status === 'syncing').onClick(() => void sync.syncNow()))
      .addButton((b) => b.setButtonText(t('account.signOut')).onClick(() => void this.signOut()));

    new Setting(el).setName(t('account.conflicts')).setDesc(sync.conflicts.length ? t('account.conflictsDesc') : t('account.noConflicts')).setHeading();
    for (const c of [...sync.conflicts].reverse()) {
      const target = c.copyPath ?? c.path;
      new Setting(el).setName(c.path).setDesc(target !== c.path ? target : '').setClass('account-conflict')
        .addButton((b) => b.setButtonText(t('account.conflictOpen')).onClick(() => this.openCopy(target)));
    }
  }

  private openCopy(path: string): void {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    // ponytail: cierra el modal de ajustes tocando su botón; si hay un borrador sin aplicar, el modal pregunta como siempre
    document.querySelector<HTMLElement>('.modal.mod-settings .modal-close-button')?.click();
    void this.app.workspace.getLeaf(false).openFile(file);
  }

  private async signOut(): Promise<void> {
    const ok = await confirmDialog(this.app, { title: t('account.signOutTitle'), message: t('account.signOutMsg'), cta: t('account.signOut'), warning: true });
    if (!ok || !this.client) return;
    await this.app.sync.stop();
    await this.client.auth.signOut();
    this.go({ k: 'form', mode: 'password' });
  }
}

export function statusIcon(status: SyncState['status']): string {
  return status === 'syncing' ? 'refresh-cw' : status === 'offline' ? 'cloud-off' : status === 'error' ? 'circle-alert' : 'cloud';
}
