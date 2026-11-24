import type { App } from '../app/app';
import { Plugin, PLUGINS_DIR, type PluginManifest } from '../api/plugin';
import { Notice } from '../app/ui/modal';
import { Platform } from '../app/platform';
import { t } from '../app/i18n';
import { TFolder } from '../core/vault';
import { PLUGIN_FILES, SHARED_MODULES, compareVersions, manifestError, sharedModuleSource, wrapPluginSource, type PluginFiles } from './loader';

type PluginCtor = new (app: App, manifest: PluginManifest) => Plugin;
interface CoreEntry { manifest: PluginManifest; ctor: PluginCtor; defaultOn: boolean }

const CORE_CONFIG = 'core-plugins.json';
const COMMUNITY_CONFIG = 'community-plugins.json';

/**
 * Gestor de plugins: internos (registerCore) y de la comunidad (carpeta
 * `.melanite/plugins/<id>/` del vault, así se sincronizan).
 */
export class PluginManager {
  app: App;
  core = new Map<string, CoreEntry>();
  /** instancias cargadas (internos y de la comunidad), por id */
  plugins: Record<string, Plugin> = {};
  private coreEnabled: Record<string, boolean> = {};
  /** plugins de la comunidad instalados (leídos del vault) */
  manifests: Record<string, PluginManifest> = {};
  /** ids de la comunidad activos */
  enabledCommunity = new Set<string>();
  /** último error de carga de cada plugin de la comunidad (para la pantalla de ajustes) */
  errors: Record<string, string> = {};
  private specUrls: Record<string, string> | null = null;

  constructor(app: App) { this.app = app; }

  /** Lo llaman los módulos en su install(): el plugin interno queda disponible. */
  registerCore(manifest: PluginManifest, ctor: PluginCtor, defaultOn = true): void {
    this.core.set(manifest.id, { manifest, ctor, defaultOn });
  }

  isCoreEnabled(id: string): boolean {
    const e = this.core.get(id);
    return !!e && (this.coreEnabled[id] ?? e.defaultOn);
  }

  /** Al arrancar, antes del layout: los internos activos y después los de la comunidad activos. */
  async loadCore(): Promise<void> {
    this.coreEnabled = (await this.app.readConfig<Record<string, boolean>>(CORE_CONFIG)) ?? {};
    for (const id of this.core.keys()) if (this.isCoreEnabled(id)) await this.loadPlugin(id);
    await this.loadCommunity();
  }

  async setCoreEnabled(id: string, on: boolean): Promise<void> {
    this.coreEnabled[id] = on;
    await this.app.writeConfig(CORE_CONFIG, this.coreEnabled);
    if (on) await this.loadPlugin(id); else this.unloadPlugin(id);
  }

  getPlugin(id: string): Plugin | null { return this.plugins[id] ?? null; }

  /** @internal */
  async loadPlugin(id: string, ctor?: PluginCtor, manifest?: PluginManifest): Promise<Plugin | null> {
    if (this.plugins[id]) return this.plugins[id];
    const entry = this.core.get(id);
    const C = ctor ?? entry?.ctor;
    const m = manifest ?? entry?.manifest;
    if (!C || !m) return null;
    const plugin = new C(this.app, m);
    this.plugins[id] = plugin;
    try {
      await plugin.load();
    } catch (err) {
      console.error(`[melanite] el plugin ${id} falló al cargar`, err);
      plugin.unload();
      delete this.plugins[id];
      this.errors[id] = String((err as Error)?.message ?? err);
      return null;
    }
    return plugin;
  }

  /** @internal */
  unloadPlugin(id: string): void {
    this.plugins[id]?.unload();
    delete this.plugins[id];
    document.querySelector(`style[data-plugin="${CSS.escape(id)}"]`)?.remove();
  }

  // ---------------------------------------------------------------- comunidad

  /** Lee los manifests de `.melanite/plugins/*` y la lista de activos. */
  async scanCommunity(): Promise<void> {
    this.manifests = {};
    const dir = this.app.vault.getFolderByPath(PLUGINS_DIR);
    for (const f of dir?.children ?? []) {
      if (!(f instanceof TFolder)) continue;
      const m = await this.app.readConfig<PluginManifest>(`plugins/${f.name}/manifest.json`);
      if (!m || manifestError(m) || m.id !== f.name) continue;
      this.manifests[m.id] = { ...m, dir: f.path };
    }
    const enabled = (await this.app.readConfig<string[]>(COMMUNITY_CONFIG)) ?? [];
    this.enabledCommunity = new Set(Array.isArray(enabled) ? enabled : []);
  }

  async loadCommunity(): Promise<void> {
    await this.scanCommunity();
    for (const id of this.enabledCommunity) if (this.manifests[id]) await this.loadCommunityPlugin(id);
  }

  async setCommunityEnabled(id: string, on: boolean): Promise<boolean> {
    if (on) this.enabledCommunity.add(id); else this.enabledCommunity.delete(id);
    await this.app.writeConfig(COMMUNITY_CONFIG, [...this.enabledCommunity]);
    if (!on) { this.unloadPlugin(id); return true; }
    if (await this.loadCommunityPlugin(id)) return true;
    // si no carga, queda desactivado (así no falla en cada arranque); el error se ve en Ajustes
    this.enabledCommunity.delete(id);
    await this.app.writeConfig(COMMUNITY_CONFIG, [...this.enabledCommunity]);
    return false;
  }

  /** Importa main.js desde una blob URL, instancia la clase e inyecta styles.css. Errores: Notice y log. */
  async loadCommunityPlugin(id: string): Promise<Plugin | null> {
    if (this.plugins[id]) return this.plugins[id];
    const manifest = this.manifests[id];
    if (!manifest) return null;
    delete this.errors[id];
    const fail = (error: string, err?: unknown) => {
      console.error(`[melanite] plugin ${id}:`, error, err ?? '');
      this.errors[id] = error;
      new Notice(t('plugins.noticeFailed', { id, error }));
      return null;
    };
    if (manifest.minAppVersion && compareVersions(__APP_VERSION__, manifest.minAppVersion) < 0) {
      return fail(t('plugins.errMinVersion', { min: manifest.minAppVersion, v: __APP_VERSION__ }));
    }
    if (manifest.isDesktopOnly && Platform.isMobile) return fail(t('plugins.errDesktopOnly'));
    const main = this.app.vault.getFileByPath(`${PLUGINS_DIR}/${id}/main.js`);
    if (!main) return fail('falta main.js');

    let ctor: unknown;
    const url = URL.createObjectURL(new Blob([wrapPluginSource(await this.app.vault.read(main), this.sharedSpecUrls(), id)], { type: 'text/javascript' }));
    try {
      ctor = (await import(/* @vite-ignore */ url)).default;
    } catch (err) {
      return fail(String((err as Error)?.message ?? err), err);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (typeof ctor !== 'function' || !(ctor.prototype instanceof Plugin)) return fail(t('plugins.errNotPlugin'));

    const css = this.app.vault.getFileByPath(`${PLUGINS_DIR}/${id}/styles.css`);
    if (css) document.head.createEl('style', { text: await this.app.vault.read(css), attr: { 'data-plugin': id } });
    const plugin = await this.loadPlugin(id, ctor as PluginCtor, manifest);
    if (!plugin) { document.querySelector(`style[data-plugin="${CSS.escape(id)}"]`)?.remove(); return fail(this.errors[id] ?? '?'); }
    return plugin;
  }

  async reloadCommunityPlugin(id: string): Promise<void> {
    this.unloadPlugin(id);
    await this.scanCommunity();
    if (this.enabledCommunity.has(id)) await this.loadCommunityPlugin(id);
  }

  /** Escribe manifest/main/styles en `.melanite/plugins/<id>/`. Si estaba activo, lo recarga. */
  async installPlugin(files: PluginFiles): Promise<PluginManifest> {
    let manifest: PluginManifest;
    try { manifest = JSON.parse(files['manifest.json'] ?? ''); } catch { throw new Error('manifest.json inválido'); }
    const err = manifestError(manifest);
    if (err) throw new Error(err);
    if (!files['main.js']) throw new Error('falta main.js');
    const existed = !!this.manifests[manifest.id];
    for (const name of PLUGIN_FILES) {
      const path = `${PLUGINS_DIR}/${manifest.id}/${name}`;
      const file = this.app.vault.getFileByPath(path);
      const text = files[name];
      if (text === undefined) { if (file) await this.app.vault.delete(file); continue; }
      if (file) await this.app.vault.modify(file, text); else await this.app.vault.create(path, text);
    }
    await this.reloadCommunityPlugin(manifest.id);
    new Notice(t(existed ? 'plugins.noticeUpdated' : 'plugins.noticeInstalled', { name: manifest.name }));
    return manifest;
  }

  async uninstallPlugin(id: string): Promise<void> {
    if (this.enabledCommunity.has(id)) await this.setCommunityEnabled(id, false);
    const dir = this.app.vault.getFolderByPath(`${PLUGINS_DIR}/${id}`);
    if (dir) await this.app.vault.delete(dir);
    delete this.manifests[id];
    delete this.errors[id];
  }

  /** blob URLs que reexportan los módulos compartidos (para los plugins escritos en ESM). */
  private sharedSpecUrls(): Record<string, string> {
    if (this.specUrls) return this.specUrls;
    const req = (globalThis as { __melanite?: { require(n: string): Record<string, unknown> } }).__melanite?.require;
    const urls: Record<string, string> = {};
    if (req) for (const name of SHARED_MODULES) {
      const src = sharedModuleSource(name, Object.keys(req(name)));
      urls[name] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return (this.specUrls = urls);
  }
}
