import './ui/dom';
import type { Extension } from '@codemirror/state';
import { Events } from '../core/events';
import type { Vault } from '../core/vault';
import { IMAGE_EXTS } from '../core/path';
import { Workspace, type WorkspaceLeaf } from './workspace';
import { Commands } from './commands';
import { FileManager } from './file-manager';
import { MarkdownRegistry } from './render/renderer';
import type { View } from './views/view';
import { MarkdownView } from './views/markdown-view';
import { EXPLORER_VIEW, FileExplorerView, ImageView } from './views/explorer';
import { SettingsModal, coreSettingTabs, type SettingTab } from './views/settings';
import { setIcon } from './ui/icons';
import { Platform } from './platform';
import { setLanguage, t } from './i18n';
import { registerCoreCommands } from './core-commands';
import { MetadataCache } from '../core/metadata';
import { PluginManager } from '../plugins/manager';
import { LatexSuggestPlugin, latexManifest } from './editor/latex-suggest';
import { install as installLinks } from './links';
import { install as installMobile } from './mobile';
import { install as installAccount } from './account';
import { install as installDesktop } from './desktop';
import { install as installPlugins } from '../plugins';
import { createSync, resumeSync, type SyncEngine } from '../core/sync';

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  language: 'es' | 'en';
  defaultViewMode: 'live' | 'source' | 'reading' | 'split';
  readableLineLength: boolean;
  spellcheck: boolean;
  fontSize: number;
  newFileLocation: 'root' | 'current' | 'folder';
  newFileFolder: string;
  attachmentFolder: string;
  confirmDelete: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'en',
  defaultViewMode: 'live',
  readableLineLength: true,
  spellcheck: true,
  fontSize: 16,
  newFileLocation: 'root',
  newFileFolder: '',
  attachmentFolder: 'attachments',
  confirmDelete: true,
};

export const CONFIG_DIR = '.melanite';
export type ViewCreator = (leaf: WorkspaceLeaf) => View;

/**
 * Objeto raíz que reciben los plugins: vault, workspace, comandos, ajustes.
 * Eventos: settings-changed, editor-extensions-changed.
 */
export class App extends Events {
  vault: Vault;
  metadataCache: MetadataCache;
  plugins: PluginManager;
  workspace: Workspace;
  commands: Commands;
  fileManager: FileManager;
  /** sincronización con Supabase (ver CLAUDE.md, contrato 4) */
  sync: SyncEngine;
  markdown = new MarkdownRegistry();
  settings: AppSettings = { ...DEFAULT_SETTINGS };
  viewRegistry = new Map<string, ViewCreator>();
  private extensionViews = new Map<string, string>();
  editorExtensions: Extension[] = [];
  settingTabs: SettingTab[] = [];
  pluginSettingTabs: SettingTab[] = [];

  ribbonEl!: HTMLDivElement;
  private ribbonTopEl!: HTMLDivElement;
  statusBarEl!: HTMLDivElement;
  private darkQuery = matchMedia('(prefers-color-scheme: dark)');

  constructor(vault: Vault) {
    super();
    this.vault = vault;
    this.metadataCache = new MetadataCache(vault);
    this.plugins = new PluginManager(this);
    this.workspace = new Workspace(this);
    this.commands = new Commands(this);
    this.fileManager = new FileManager(this);
    this.sync = createSync(this);
  }

  // ---------------------------------------------------------------- arranque

  async start(root: HTMLElement): Promise<void> {
    await this.loadSettings();
    this.buildShell(root);
    this.registerView('markdown', (leaf) => new MarkdownView(leaf));
    this.registerView('image', (leaf) => new ImageView(leaf));
    this.registerView(EXPLORER_VIEW, (leaf) => new FileExplorerView(leaf));
    this.registerExtensions(['md', 'txt'], 'markdown');
    this.registerExtensions(IMAGE_EXTS, 'image');
    this.settingTabs = coreSettingTabs(this);
    registerCoreCommands(this);
    // módulos (cada uno en su carpeta; ver CLAUDE.md). Antes del layout: registran vistas.
    await installLinks(this);
    await installMobile(this);
    installAccount(this);
    installDesktop(this);
    await installPlugins(this);
    this.plugins.registerCore(latexManifest(), LatexSuggestPlugin);
    await this.plugins.loadCore();
    document.addEventListener('keydown', this.commands.handleKeydown);
    this.darkQuery.addEventListener('change', () => this.applySettings());

    await this.workspace.loadLayout(async (ws) => {
      await ws.ensureSideLeaf(EXPLORER_VIEW, 'left');
      ws.rightSplit.setCollapsed(true);
      const welcome = this.vault.getMarkdownFiles()[0];
      if (welcome) await ws.getLeaf(false).openFile(welcome);
    });
    if (!this.workspace.getLeavesOfType(EXPLORER_VIEW).length) await this.workspace.ensureSideLeaf(EXPLORER_VIEW, 'left');
    if (Platform.isPhone) { this.workspace.leftSplit.collapse(); this.workspace.rightSplit.collapse(); }
    resumeSync(this).catch((err) => console.warn('[melanite] sync:', err));
  }

  private buildShell(root: HTMLElement) {
    root.empty();
    const app = root.createDiv('app-container');
    const mobileBar = app.createDiv('mobile-navbar');
    const mbtn = (icon: string, label: string, cb: () => unknown) => {
      const b = mobileBar.createDiv({ cls: 'clickable-icon mobile-navbar-action', attr: { 'aria-label': label } });
      setIcon(b, icon);
      b.addEventListener('click', () => void cb());
      return b;
    };
    mbtn('menu', t('cmd.toggleLeft'), () => this.workspace.leftSplit.toggle());
    mobileBar.createDiv('mobile-navbar-title');
    mbtn('file-plus', t('cmd.newNote'), () => this.commands.executeCommandById('file:new'));
    mbtn('panel-right', t('cmd.toggleRight'), () => this.workspace.rightSplit.toggle());
    this.workspace.on('file-open', () => mobileBar.querySelector('.mobile-navbar-title')!.setText(this.workspace.getActiveFile()?.basename ?? ''));

    const main = app.createDiv('horizontal-main-container');
    this.ribbonEl = main.createDiv('workspace-ribbon side-dock-ribbon mod-left');
    this.ribbonTopEl = this.ribbonEl.createDiv('side-dock-actions');
    const ribbonBottom = this.ribbonEl.createDiv('side-dock-settings');
    const settingsBtn = ribbonBottom.createDiv({ cls: 'clickable-icon side-dock-ribbon-action', attr: { 'aria-label': t('cmd.openSettings') } });
    setIcon(settingsBtn, 'settings');
    settingsBtn.addEventListener('click', () => this.openSettings());

    const ws = main.createDiv('workspace');
    ws.appendChild(this.workspace.leftSplit.containerEl);
    ws.appendChild(this.workspace.rootSplit.containerEl);
    ws.appendChild(this.workspace.rightSplit.containerEl);
    const backdrop = ws.createDiv('sidedock-backdrop');
    backdrop.addEventListener('click', () => { this.workspace.leftSplit.collapse(); this.workspace.rightSplit.collapse(); });

    this.statusBarEl = app.createDiv('status-bar');

    this.addRibbonIcon('panel-left', t('cmd.toggleLeft'), () => this.workspace.leftSplit.toggle());
    this.addRibbonIcon('file-plus', t('cmd.newNote'), () => this.commands.executeCommandById('file:new'));
    document.body.toggleClass('is-mobile', Platform.isPhone);
    document.body.toggleClass('is-ios', Platform.isIos);
    Platform.onChange(() => document.body.toggleClass('is-mobile', Platform.isPhone));
  }

  // ---------------------------------------------------------------- registro (lo usan los plugins)

  registerView(type: string, creator: ViewCreator): () => void {
    this.viewRegistry.set(type, creator);
    return () => this.viewRegistry.delete(type);
  }

  registerExtensions(exts: string[], viewType: string): () => void {
    for (const e of exts) this.extensionViews.set(e.toLowerCase(), viewType);
    return () => { for (const e of exts) if (this.extensionViews.get(e) === viewType) this.extensionViews.delete(e); };
  }

  viewTypeForExtension(ext: string): string | null {
    const type = this.extensionViews.get(ext.toLowerCase());
    return type && this.viewRegistry.has(type) ? type : null;
  }

  addRibbonIcon(icon: string, title: string, cb: (evt: MouseEvent) => unknown): HTMLElement {
    const el = this.ribbonTopEl.createDiv({ cls: 'clickable-icon side-dock-ribbon-action', attr: { 'aria-label': title }, title });
    setIcon(el, icon);
    el.addEventListener('click', cb);
    return el;
  }

  addStatusBarItem(): HTMLElement { return this.statusBarEl.createDiv('status-bar-item'); }

  registerEditorExtension(ext: Extension | Extension[]): () => void {
    this.editorExtensions.push(ext);
    this.trigger('editor-extensions-changed');
    return () => {
      this.editorExtensions = this.editorExtensions.filter((e) => e !== ext);
      this.trigger('editor-extensions-changed');
    };
  }

  getActiveMarkdownView(): MarkdownView | null { return this.workspace.getActiveViewOfType(MarkdownView); }

  openSettings(tabId?: string): void { new SettingsModal(this, tabId).open(); }

  // ---------------------------------------------------------------- configuración (en el vault, así se sincroniza)

  async readConfig<T>(name: string): Promise<T | null> {
    const file = this.vault.getFileByPath(`${CONFIG_DIR}/${name}`);
    if (!file) return null;
    try { return JSON.parse(await this.vault.cachedRead(file)) as T; } catch { return null; }
  }

  /** Escrituras en fila por archivo: dos writeConfig seguidos no crean el archivo dos veces. */
  writeConfig(name: string, data: unknown): Promise<void> {
    const path = `${CONFIG_DIR}/${name}`;
    const text = JSON.stringify(data, null, 2);
    const run = async () => {
      const file = this.vault.getFileByPath(path);
      if (file) await this.vault.modify(file, text); else await this.vault.create(path, text);
    };
    const next = (this.configWrites.get(path) ?? Promise.resolve()).catch(() => {}).then(run);
    this.configWrites.set(path, next);
    return next;
  }
  private configWrites = new Map<string, Promise<void>>();

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.readConfig<Partial<AppSettings>>('app.json')) ?? {}) };
    this.applySettings();
  }

  async saveSettings(): Promise<void> {
    await this.writeConfig('app.json', this.settings);
    this.applySettings();
    this.trigger('settings-changed');
  }

  private applySettings(): void {
    const s = this.settings;
    setLanguage(s.language);
    const dark = s.theme === 'dark' || (s.theme === 'system' && this.darkQuery.matches);
    document.body.toggleClass('theme-dark', dark);
    document.body.toggleClass('theme-light', !dark);
    document.body.style.setProperty('--font-text-size', `${s.fontSize}px`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141114' : '#faf8f8');
  }
}
