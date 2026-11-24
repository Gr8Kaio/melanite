import type { App } from '../app';
import { setIcon } from '../ui/icons';
import { t } from '../i18n';
import { getSupabaseClient } from '../../core/sync';
import './strings';
import './account.css';
import { AccountTab, ago, statusIcon } from './tab';

/** UI de cuenta y sync: pestaña "Sync" de ajustes + indicador en la barra de estado (escritorio) y en la barra superior (teléfono). */
export function install(app: App): void {
  const tab = new AccountTab(app);
  const at = app.settingTabs.findIndex((x) => x.id === 'about');
  app.settingTabs.splice(at < 0 ? app.settingTabs.length : at, 0, tab);

  const open = () => app.openSettings('sync');
  const desk = app.addStatusBarItem();
  const phone = createDiv({ cls: 'clickable-icon mobile-navbar-action account-indicator', attr: { role: 'button', 'aria-label': t('account.ind.label') } });
  desk.addClass('account-indicator', 'mod-clickable');
  desk.setAttr('role', 'button');
  desk.setAttr('aria-label', t('account.ind.label'));
  const navbar = document.querySelector<HTMLElement>('.mobile-navbar');
  navbar?.insertBefore(phone, navbar.querySelector('.mobile-palette-button'));
  const items = [desk, phone];
  for (const el of items) { el.addEventListener('click', open); el.style.display = 'none'; }

  let signedIn = false;
  const render = () => {
    const s = app.sync.state;
    const on = s.enabled || signedIn;
    const status = s.enabled ? s.status : 'idle';
    const tip = on
      ? t('account.ind.on', { status: t(`account.status.${status}`), pending: s.pending, last: ago(s.lastSync) })
      : t('account.ind.off');
    for (const el of items) {
      el.style.display = '';
      el.toggleClass('is-off', !on);
      el.dataset.status = on ? status : 'off';
      el.title = tip;
      el.setAttr('aria-label', tip);
      const icon = on ? statusIcon(status) : 'cloud-off';
      if (el.dataset.icon !== icon) { el.dataset.icon = icon; setIcon(el, icon); }
    }
  };

  // sin Supabase en el build no hay nada que activar: los indicadores quedan ocultos
  // (en segundo plano: no frena el arranque)
  void getSupabaseClient().then(async (client) => {
    if (!client) return;
    app.sync.on('status', render);
    const { data } = await client.auth.getSession();
    signedIn = !!data.session;
    client.auth.onAuthStateChange((_ev, session) => { signedIn = !!session; render(); });
    render();
  });
}
