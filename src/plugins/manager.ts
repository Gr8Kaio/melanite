import type { App } from '../app/app';
import type { Plugin, PluginManifest } from '../api/plugin';

type PluginCtor = new (app: App, manifest: PluginManifest) => Plugin;
interface CoreEntry { manifest: PluginManifest; ctor: PluginCtor; defaultOn: boolean }

const CORE_CONFIG = 'core-plugins.json';

/**
 * Gestor de plugins. CONTRATO mínimo para los plugins internos; el módulo
 * "plugins" lo extiende con los de la comunidad (carga desde el vault, zip, URL)
 * y la pantalla de ajustes.
 */
export class PluginManager {
  app: App;
  core = new Map<string, CoreEntry>();
  /** instancias cargadas (internos y de la comunidad), por id */
  plugins: Record<string, Plugin> = {};
  private coreEnabled: Record<string, boolean> = {};

  constructor(app: App) { this.app = app; }

  /** Lo llaman los módulos en su install(): el plugin interno queda disponible. */
  registerCore(manifest: PluginManifest, ctor: PluginCtor, defaultOn = true): void {
    this.core.set(manifest.id, { manifest, ctor, defaultOn });
  }

  isCoreEnabled(id: string): boolean {
    const e = this.core.get(id);
    return !!e && (this.coreEnabled[id] ?? e.defaultOn);
  }

  /** Carga todos los plugins internos activos (al arrancar, antes del layout). */
  async loadCore(): Promise<void> {
    this.coreEnabled = (await this.app.readConfig<Record<string, boolean>>(CORE_CONFIG)) ?? {};
    for (const id of this.core.keys()) if (this.isCoreEnabled(id)) await this.loadPlugin(id);
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
      return null;
    }
    return plugin;
  }

  /** @internal */
  unloadPlugin(id: string): void {
    this.plugins[id]?.unload();
    delete this.plugins[id];
  }
}
