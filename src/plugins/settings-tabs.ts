import { Setting, SettingTab, Notice, confirmDialog, setIcon, type App } from '../api';
import { t } from '../app/i18n';
import { filesFromZip, parseGithubSource, PLUGIN_FILES, type PluginFiles } from './loader';

class CoreTab extends SettingTab {
  id = 'core-plugins';
  display() {
    const el = this.containerEl;
    el.createEl('p', { cls: 'setting-item-description', text: t('plugins.coreDesc') });
    const pm = this.app.plugins;
    for (const [id, { manifest }] of pm.core) {
      new Setting(el).setName(manifest.name).setDesc(manifest.description ?? '').setClass('plugin-core-item')
        .then((s) => s.settingEl.setAttr('data-plugin-id', id))
        .addToggle((tg) => tg.setValue(pm.isCoreEnabled(id)).onChange((v) => void pm.setCoreEnabled(id, v)));
    }
  }
}

class CommunityTab extends SettingTab {
  id = 'community-plugins';

  display() {
    const el = this.containerEl;
    const pm = this.app.plugins;
    const warn = el.createDiv({ cls: 'plugins-warning', attr: { role: 'note' } });
    setIcon(warn.createDiv('plugins-warning-icon'), 'alert-triangle');
    const body = warn.createDiv();
    body.createDiv({ cls: 'plugins-warning-title', text: t('plugins.warningTitle') });
    body.createDiv({ text: t('plugins.warning') });

    // "Agregar plugin": las tres vías juntas, arriba y después de la advertencia
    const add = el.createDiv('plugins-add-section');
    add.createEl('h3', { cls: 'plugins-add-title', text: t('plugins.addHeading') });
    const zipInput = add.createEl('input', { type: 'file', attr: { accept: '.zip,application/zip', hidden: true } });
    zipInput.addEventListener('change', () => {
      const f = zipInput.files?.[0];
      zipInput.value = '';
      if (f) void this.install(async () => filesFromZip(new Uint8Array(await f.arrayBuffer())));
    });
    new Setting(add).setName(t('plugins.installZip')).setDesc(t('plugins.installZipDesc')).setClass('plugins-zip-setting')
      .addButton((b) => b.setButtonText(t('plugins.chooseZip')).onClick(() => zipInput.click()));

    let url = '';
    new Setting(add).setName(t('plugins.installUrl')).setDesc(t('plugins.installUrlDesc')).setClass('plugins-url-setting')
      .addText((x) => x.setPlaceholder('https://github.com/owner/repo').onChange((v) => { url = v; }))
      .addButton((b) => b.setButtonText(t('plugins.install')).onClick(() => this.install(() => githubFiles(url))));

    new Setting(add).setName(t('plugins.installSample')).setDesc(t('plugins.installSampleDesc')).setClass('plugins-sample-setting')
      .addButton((b) => b.setButtonText(t('plugins.install')).setCta().onClick(() => this.install(() => sampleFiles())));

    new Setting(el).setName(t('plugins.installed')).setHeading()
      .addExtraButton((b) => b.setIcon('refresh-cw').setTooltip(t('plugins.reloadList')).onClick(async () => { await pm.scanCommunity(); this.redraw(); }));

    const ids = Object.keys(pm.manifests).sort();
    if (!ids.length) el.createEl('p', { cls: 'setting-item-description', text: t('plugins.none') });
    for (const id of ids) {
      const m = pm.manifests[id];
      const s = new Setting(el).setName(`${m.name} ${m.version}`).setClass('plugin-community-item');
      s.settingEl.setAttr('data-plugin-id', id);
      s.setDesc([m.author ? t('plugins.by', { author: m.author }) : '', m.description ?? ''].filter(Boolean).join(' · '));
      if (pm.errors[id]) s.descEl.createDiv({ cls: 'plugin-error', text: t('plugins.cantLoad', { error: pm.errors[id] }) });
      const tab = this.app.pluginSettingTabs.find((x) => x.id === id);
      if (tab && pm.plugins[id]) s.addExtraButton((b) => b.setIcon('settings').setTooltip(t('plugins.settings')).onClick(() => this.openTab(tab)));
      s.addExtraButton((b) => b.setIcon('refresh-cw').setTooltip(t('plugins.reload')).onClick(async () => { await pm.reloadCommunityPlugin(id); this.redraw(); }));
      s.addExtraButton((b) => b.setIcon('trash').setTooltip(t('plugins.uninstall')).onClick(async () => {
        const ok = await confirmDialog(this.app, { title: t('plugins.uninstallTitle', { name: m.name }), message: t('plugins.uninstallMsg'), cta: t('plugins.uninstall'), warning: true });
        if (!ok) return;
        await pm.uninstallPlugin(id);
        this.redraw();
      }));
      s.addToggle((tg) => tg.setValue(pm.enabledCommunity.has(id)).onChange(async (v) => { await pm.setCommunityEnabled(id, v); this.redraw(); }));
    }
  }

  private redraw() {
    const title = this.containerEl.querySelector('h2');
    this.containerEl.empty();
    if (title) this.containerEl.appendChild(title);
    this.display();
  }

  private async install(get: () => Promise<PluginFiles>) {
    try {
      await this.app.plugins.installPlugin(await get());
    } catch (err) {
      console.error('[melanite] instalar plugin', err);
      new Notice(t('plugins.noticeInstallFailed', { error: String((err as Error)?.message ?? err) }));
    }
    this.redraw();
  }

  /** Abre la pestaña de ajustes del plugin dentro del mismo modal (o en uno nuevo si el menú no la tiene). */
  private openTab(tab: SettingTab) {
    const nav = [...(this.containerEl.closest('.vertical-tabs-container')?.querySelectorAll<HTMLElement>('.vertical-tab-nav-item') ?? [])]
      .find((n) => n.textContent === tab.name);
    if (nav) { nav.click(); return; }
    this.containerEl.closest('.modal-container')?.querySelector<HTMLElement>('.modal-bg')?.click();
    this.app.openSettings(tab.id);
  }
}

/** El Pomodoro de ejemplo sale de public/plugins/pomodoro/ y entra por el mismo camino que un zip. */
async function sampleFiles(): Promise<PluginFiles> {
  const base = `${import.meta.env.BASE_URL}plugins/pomodoro/`;
  const out: PluginFiles = {};
  for (const name of PLUGIN_FILES) {
    const r = await fetch(base + name, { cache: 'no-store' });
    if (r.ok) out[name] = await r.text();
  }
  return out;
}

/**
 * Assets de un release de GitHub. La API (api.github.com) tiene CORS, pero las descargas de los assets
 * redirigen a release-assets.githubusercontent.com, que no lo tiene (probado en Chromium y WebKit).
 * Se intenta igual (por si GitHub lo habilita) y si falla se busca el archivo en el repo en ese tag
 * (raw.githubusercontent.com sí tiene CORS; sirve para los repos que commitean el build).
 */
async function githubFiles(url: string): Promise<PluginFiles> {
  const src = parseGithubSource(url);
  if (!src) throw new Error(t('plugins.errBadUrl'));
  const api = `https://api.github.com/repos/${src.owner}/${src.repo}`;
  const res = await fetch(src.tag ? `${api}/releases/tags/${encodeURIComponent(src.tag)}` : `${api}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const release = await res.json() as { tag_name: string; assets: { id: number; name: string }[] };
  const out: PluginFiles = {};
  for (const name of PLUGIN_FILES) {
    const asset = release.assets.find((a) => a.name === name);
    const text = (asset && await fetchText(`${api}/releases/assets/${asset.id}`, { Accept: 'application/octet-stream' }))
      ?? await fetchText(`https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(release.tag_name)}/${name}`);
    if (text !== null) out[name] = text;
    else if (name !== 'styles.css') throw new Error(asset ? t('plugins.errCors') : t('plugins.errNoAsset', { name }));
  }
  return out;
}

async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const r = await fetch(url, { headers });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

export function pluginSettingTabs(app: App): SettingTab[] {
  const core = new CoreTab(app);
  core.name = t('plugins.coreTab');
  const community = new CommunityTab(app);
  community.name = t('plugins.communityTab');
  return [core, community];
}
