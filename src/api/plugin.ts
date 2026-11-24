import { Component } from '../core/component';
import type { Extension } from '@codemirror/state';
import type { App, ViewCreator } from '../app/app';
import type { Command } from '../app/commands';
import type { MarkdownPostProcessor, CodeBlockProcessor } from '../app/render/renderer';
import { SettingTab } from '../app/views/settings';
import { CONFIG_DIR } from '../app/app';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
  /** solo plugins de la comunidad: carpeta dentro del vault */
  dir?: string;
}

/**
 * Base de todos los plugins (internos y de la comunidad). Todo lo registrado
 * con addX / registerX se deshace solo al desactivar (Component.unload).
 */
export abstract class Plugin extends Component {
  app: App;
  manifest: PluginManifest;

  constructor(app: App, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  /** Puede ser async; la app lo espera. */
  onload(): void | Promise<void> {}
  onunload(): void {}

  addCommand(cmd: Command): Command {
    const full = { ...cmd, id: `${this.manifest.id}:${cmd.id}` };
    this.app.commands.addCommand(full);
    this.register(() => this.app.commands.removeCommand(full.id));
    return full;
  }

  addRibbonIcon(icon: string, title: string, cb: (evt: MouseEvent) => unknown): HTMLElement {
    const el = this.app.addRibbonIcon(icon, title, cb);
    this.register(() => el.detach());
    return el;
  }

  addStatusBarItem(): HTMLElement {
    const el = this.app.addStatusBarItem();
    this.register(() => el.detach());
    return el;
  }

  addSettingTab(tab: PluginSettingTab): void {
    tab.id ||= this.manifest.id;
    tab.name ||= this.manifest.name;
    this.app.pluginSettingTabs.push(tab);
    this.register(() => { this.app.pluginSettingTabs = this.app.pluginSettingTabs.filter((t) => t !== tab); });
  }

  registerView(type: string, creator: ViewCreator): void {
    this.register(this.app.registerView(type, creator));
    // al desactivar, cerrar las hojas que usaban esa vista
    this.register(() => { for (const leaf of this.app.workspace.getLeavesOfType(type)) leaf.detach(); });
  }

  registerExtensions(exts: string[], viewType: string): void { this.register(this.app.registerExtensions(exts, viewType)); }

  registerMarkdownPostProcessor(pp: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor {
    if (sortOrder !== undefined) pp.sortOrder = sortOrder;
    this.register(this.app.markdown.addPostProcessor(pp));
    return pp;
  }

  registerMarkdownCodeBlockProcessor(language: string, handler: CodeBlockProcessor): void {
    this.register(this.app.markdown.addCodeBlockProcessor(language, handler));
  }

  registerEditorExtension(ext: Extension | Extension[]): void { this.register(this.app.registerEditorExtension(ext)); }

  /** Datos del plugin en .melanite/plugins/<id>/data.json (se sincroniza con el vault). */
  async loadData(): Promise<any> { return this.app.readConfig(`plugins/${this.manifest.id}/data.json`); }
  async saveData(data: unknown): Promise<void> { await this.app.writeConfig(`plugins/${this.manifest.id}/data.json`, data); }
}

export abstract class PluginSettingTab extends SettingTab {
  plugin: Plugin;
  constructor(app: App, plugin: Plugin) {
    super(app);
    this.plugin = plugin;
  }
}

export const PLUGINS_DIR = `${CONFIG_DIR}/plugins`;
