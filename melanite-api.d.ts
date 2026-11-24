// Generado por `npm run api:types` a partir de src/api/index.ts. No editar a mano.
// Melanite 0.1.0

declare module 'melanite' {
  export * from 'melanite/api';
}

declare module 'melanite/api' {
  /**
   * API pública de Melanite: lo que ven los plugins (`import { … } from 'melanite'`).
   * Se publica como melanite-api.d.ts (`npm run api:types`).
   */
  export { Plugin, PluginSettingTab, type PluginManifest } from 'melanite/api/plugin';
  export { Component } from 'melanite/core/component';
  export { Events, type EventRef, type EventCallback } from 'melanite/core/events';
  export { App, type AppSettings, type ViewCreator } from 'melanite/app/app';
  export { Vault, TFile, TFolder, TAbstractFile, type FileStats } from 'melanite/core/vault';
  export { MetadataCache, type CachedMetadata, type LinkCache, type EmbedCache, type TagCache, type HeadingCache, type BlockCache, type ListItemCache, type SectionCache, type FrontMatterCache, type Loc, type Pos, } from 'melanite/core/metadata';
  export { Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, WorkspaceSidedock, type PaneType, type OpenViewState } from 'melanite/app/workspace';
  export { View, ItemView, FileView, type ViewState } from 'melanite/app/views/view';
  export { MarkdownView } from 'melanite/app/views/markdown-view';
  export { SettingTab } from 'melanite/app/views/settings';
  export { Editor, type EditorPosition, type EditorRange } from 'melanite/app/editor/editor';
  export { MarkdownRenderer, type MarkdownPostProcessor, type MarkdownPostProcessorContext, type CodeBlockProcessor } from 'melanite/app/render/renderer';
  export { Modal, Notice, Menu, MenuItem, promptText, confirmDialog } from 'melanite/app/ui/modal';
  export { Setting, TextComponent, TextAreaComponent, ToggleComponent, DropdownComponent, SliderComponent, ButtonComponent, ExtraButtonComponent, } from 'melanite/app/ui/setting';
  export type { Command, Hotkey, Modifier } from 'melanite/app/commands';
  export { setIcon } from 'melanite/app/ui/icons';
  export { normalizePath } from 'melanite/core/path';
  export { parseYaml, stringifyYaml } from 'melanite/core/yaml';
  export { Platform } from 'melanite/app/platform';
  /** Versión de la app que corre el plugin. */
  export const apiVersion: string;
  export interface Debouncer<T extends unknown[]> {
      (...args: T): void;
      cancel(): void;
  }
  /** Como el de Obsidian: con `resetTimer` cada llamada reinicia la espera. */
  export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout?: number, resetTimer?: boolean): Debouncer<T>;
  export interface RequestUrlParam {
      url: string;
      method?: string;
      contentType?: string;
      body?: string | ArrayBuffer;
      headers?: Record<string, string>;
      throw?: boolean;
  }
  export interface RequestUrlResponse {
      status: number;
      headers: Record<string, string>;
      text: string;
      json: any;
      arrayBuffer: ArrayBuffer;
  }
  /**
   * fetch con la forma de requestUrl de Obsidian. Ojo: en el navegador SÍ aplica CORS
   * (no hay proceso nativo que lo saltee).
   */
  export function requestUrl(req: string | RequestUrlParam): Promise<RequestUrlResponse>;
}

declare module 'melanite/api/plugin' {
  import { Component } from 'melanite/core/component';
  import type { Extension } from '@codemirror/state';
  import type { App, ViewCreator } from 'melanite/app/app';
  import type { Command } from 'melanite/app/commands';
  import type { MarkdownPostProcessor, CodeBlockProcessor } from 'melanite/app/render/renderer';
  import { SettingTab } from 'melanite/app/views/settings';
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
      constructor(app: App, manifest: PluginManifest);
      /** Puede ser async; la app lo espera. */
      onload(): void | Promise<void>;
      onunload(): void;
      addCommand(cmd: Command): Command;
      addRibbonIcon(icon: string, title: string, cb: (evt: MouseEvent) => unknown): HTMLElement;
      addStatusBarItem(): HTMLElement;
      addSettingTab(tab: PluginSettingTab): void;
      registerView(type: string, creator: ViewCreator): void;
      registerExtensions(exts: string[], viewType: string): void;
      registerMarkdownPostProcessor(pp: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor;
      registerMarkdownCodeBlockProcessor(language: string, handler: CodeBlockProcessor): void;
      registerEditorExtension(ext: Extension | Extension[]): void;
      /** Datos del plugin en .melanite/plugins/<id>/data.json (se sincroniza con el vault). */
      loadData(): Promise<any>;
      /** Las escrituras van en fila: dos saveData seguidos sin await no crean el archivo dos veces. */
      saveData(data: unknown): Promise<void>;
      private _saving;
  }
  export abstract class PluginSettingTab extends SettingTab {
      plugin: Plugin;
      constructor(app: App, plugin: Plugin);
  }
  export const PLUGINS_DIR = ".melanite/plugins";
}

declare module 'melanite/core/component' {
  import type { EventRef } from 'melanite/core/events';
  /**
   * Ciclo de vida con limpieza automática: todo lo registrado con register* se
   * deshace en unload(), y los hijos se descargan con el padre.
   */
  export class Component {
      private _loaded;
      private _children;
      private _cleanups;
      /** Devuelve lo que devuelva onload (los plugins pueden cargar en forma async). */
      load(): void | Promise<void>;
      unload(): void;
      onload(): void | Promise<void>;
      onunload(): void;
      addChild<T extends Component>(c: T): T;
      removeChild<T extends Component>(c: T): T;
      register(cb: () => unknown): void;
      registerEvent(ref: EventRef): void;
      registerDomEvent<K extends keyof HTMLElementEventMap>(el: Window | Document | HTMLElement, type: K | string, cb: (ev: any) => unknown, opts?: boolean | AddEventListenerOptions): void;
      registerInterval(id: number): number;
  }
}

declare module 'melanite/core/events' {
  export type EventCallback = (...data: any[]) => unknown;
  export interface EventRef {
      e: Events;
      name: string;
      fn: EventCallback;
      ctx?: unknown;
  }
  /** Emisor de eventos con la forma de la API de Obsidian (on/off/offref/trigger). */
  export class Events {
      private _events;
      on(name: string, fn: EventCallback, ctx?: unknown): EventRef;
      off(name: string, fn: EventCallback): void;
      offref(ref: EventRef): void;
      trigger(name: string, ...data: unknown[]): void;
  }
}

declare module 'melanite/app/app' {
  import 'melanite/app/ui/dom';
  import type { Extension } from '@codemirror/state';
  import { Events } from 'melanite/core/events';
  import type { Vault } from 'melanite/core/vault';
  import { Workspace, type WorkspaceLeaf } from 'melanite/app/workspace';
  import { Commands } from 'melanite/app/commands';
  import { FileManager } from 'melanite/app/file-manager';
  import { MarkdownRegistry } from 'melanite/app/render/renderer';
  import type { View } from 'melanite/app/views/view';
  import { MarkdownView } from 'melanite/app/views/markdown-view';
  import { type SettingTab } from 'melanite/app/views/settings';
  import { MetadataCache } from 'melanite/core/metadata';
  import { PluginManager } from 'melanite/plugins/manager';
  export interface AppSettings {
      theme: 'system' | 'light' | 'dark';
      language: 'es' | 'en';
      defaultViewMode: 'live' | 'source' | 'reading';
      readableLineLength: boolean;
      spellcheck: boolean;
      fontSize: number;
      newFileLocation: 'root' | 'current' | 'folder';
      newFileFolder: string;
      attachmentFolder: string;
      confirmDelete: boolean;
  }
  export const DEFAULT_SETTINGS: AppSettings;
  export const CONFIG_DIR = ".melanite";
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
      markdown: MarkdownRegistry;
      settings: AppSettings;
      viewRegistry: Map<string, ViewCreator>;
      private extensionViews;
      editorExtensions: Extension[];
      settingTabs: SettingTab[];
      pluginSettingTabs: SettingTab[];
      ribbonEl: HTMLDivElement;
      private ribbonTopEl;
      statusBarEl: HTMLDivElement;
      private darkQuery;
      constructor(vault: Vault);
      start(root: HTMLElement): Promise<void>;
      private buildShell;
      registerView(type: string, creator: ViewCreator): () => void;
      registerExtensions(exts: string[], viewType: string): () => void;
      viewTypeForExtension(ext: string): string | null;
      addRibbonIcon(icon: string, title: string, cb: (evt: MouseEvent) => unknown): HTMLElement;
      addStatusBarItem(): HTMLElement;
      registerEditorExtension(ext: Extension | Extension[]): () => void;
      getActiveMarkdownView(): MarkdownView | null;
      openSettings(tabId?: string): void;
      readConfig<T>(name: string): Promise<T | null>;
      writeConfig(name: string, data: unknown): Promise<void>;
      loadSettings(): Promise<void>;
      saveSettings(): Promise<void>;
      private applySettings;
  }
}

declare module 'melanite/core/vault' {
  import { Events } from 'melanite/core/events';
  import type { FileRow, MelaniteDB } from 'melanite/core/db';
  export interface FileStats {
      ctime: number;
      mtime: number;
      size: number;
  }
  export abstract class TAbstractFile {
      vault: Vault;
      path: string;
      name: string;
      parent: TFolder | null;
      constructor(vault: Vault, path: string);
      /** @internal */ _setPath(path: string): void;
  }
  export class TFile extends TAbstractFile {
      id: string;
      stat: FileStats;
      constructor(vault: Vault, row: FileRow);
      get basename(): string;
      get extension(): string;
  }
  export class TFolder extends TAbstractFile {
      id: string;
      children: TAbstractFile[];
      constructor(vault: Vault, path: string, id: string);
      isRoot(): boolean;
  }
  /**
   * El vault: árbol de archivos en memoria respaldado por IndexedDB.
   * El texto de los archivos de texto vive en memoria (lo necesitan la búsqueda y
   * la metadata); los binarios se leen bajo demanda.
   *
   * Eventos: create(file), modify(file), delete(file), rename(file, oldPath).
   */
  export class Vault extends Events {
      readonly db: MelaniteDB;
      private root;
      private byPath;
      private texts;
      private constructor();
      static open(db: MelaniteDB): Promise<Vault>;
      getRoot(): TFolder;
      getName(): string;
      getAbstractFileByPath(path: string): TAbstractFile | null;
      getFileByPath(path: string): TFile | null;
      getFolderByPath(path: string): TFolder | null;
      getAllLoadedFiles(): TAbstractFile[];
      getFiles(): TFile[];
      getMarkdownFiles(): TFile[];
      read(file: TFile): Promise<string>;
      cachedRead(file: TFile): Promise<string>;
      /** Lectura sincrónica del texto en memoria (extensión de Melanite). */
      cachedReadSync(file: TFile): string;
      readBinary(file: TFile): Promise<ArrayBuffer>;
      /** Primera ruta libre: "Sin título.md", "Sin título 1.md", … */
      getAvailablePath(base: string, ext: string): string;
      create(path: string, data: string): Promise<TFile>;
      createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
      createFolder(path: string): Promise<TFolder>;
      modify(file: TFile, data: string): Promise<void>;
      modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
      append(file: TFile, data: string): Promise<void>;
      process(file: TFile, fn: (data: string) => string): Promise<string>;
      /** Renombra o mueve un archivo o carpeta (con todo su contenido). */
      rename(file: TAbstractFile, newPath: string): Promise<void>;
      /** Borrado definitivo. */
      delete(file: TAbstractFile): Promise<void>;
      /** Mueve a la papelera del vault (.trash/), que se sincroniza como cualquier carpeta. */
      trash(file: TAbstractFile): Promise<void>;
      private idOf;
      private descendants;
      private createRow;
      /** Cuelga el archivo de su carpeta padre (creándola en memoria si falta). */
      private attach;
      private detach;
  }
}

declare module 'melanite/core/metadata' {
  import { Events } from 'melanite/core/events';
  import type { TFile, Vault } from 'melanite/core/vault';
  /**
   * CONTRATO (forma de la API de Obsidian). Lo implementa el módulo "links".
   * Posiciones: line/col desde 0, offset en caracteres desde el inicio del archivo.
   */
  export interface Loc {
      line: number;
      col: number;
      offset: number;
  }
  export interface Pos {
      start: Loc;
      end: Loc;
  }
  export interface LinkCache {
      link: string;
      original: string;
      displayText?: string;
      position: Pos;
  }
  export interface EmbedCache extends LinkCache {
  }
  export interface TagCache {
      tag: string;
      position: Pos;
  }
  export interface HeadingCache {
      heading: string;
      level: number;
      position: Pos;
  }
  export interface BlockCache {
      id: string;
      position: Pos;
  }
  export interface ListItemCache {
      position: Pos;
      parent: number;
      task?: string;
  }
  export interface SectionCache {
      type: string;
      position: Pos;
      id?: string;
  }
  export type FrontMatterCache = Record<string, unknown>;
  export interface CachedMetadata {
      links?: LinkCache[];
      embeds?: EmbedCache[];
      tags?: TagCache[];
      headings?: HeadingCache[];
      blocks?: Record<string, BlockCache>;
      listItems?: ListItemCache[];
      sections?: SectionCache[];
      frontmatter?: FrontMatterCache;
      frontmatterPosition?: Pos;
  }
  /**
   * Índice de metadata de las notas. Eventos:
   *  - changed(file, data, cache): se reindexó un archivo
   *  - deleted(file, prevCache)
   *  - resolved(): terminó la indexación inicial / se recalcularon los links
   */
  export class MetadataCache extends Events {
      vault: Vault;
      /** origen → destino → cantidad de links (solo destinos que existen) */
      resolvedLinks: Record<string, Record<string, number>>;
      /** origen → linkpath sin resolver → cantidad */
      unresolvedLinks: Record<string, Record<string, number>>;
      constructor(vault: Vault);
      getFileCache(_file: TFile): CachedMetadata | null;
      getCache(path: string): CachedMetadata | null;
      getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
      fileToLinktext(file: TFile, sourcePath: string): string;
      /** Todas las etiquetas del vault con su cantidad ("#tag" → n). */
      getTags(): Record<string, number>;
  }
}

declare module 'melanite/app/workspace' {
  import 'melanite/app/ui/dom';
  import { Events } from 'melanite/core/events';
  import { TFile } from 'melanite/core/vault';
  import type { App } from 'melanite/app/app';
  import { View, type ViewState } from 'melanite/app/views/view';
  import { Menu } from 'melanite/app/ui/modal';
  /** 'vertical' = paneles lado a lado (como en Obsidian), 'horizontal' = uno arriba del otro. */
  export type SplitDirection = 'vertical' | 'horizontal';
  export type PaneType = boolean | 'tab' | 'split';
  export interface OpenViewState {
      active?: boolean;
      state?: ViewState;
      eState?: Record<string, unknown>;
  }
  type Item = WorkspaceSplit | WorkspaceTabs;
  export class WorkspaceLeaf extends Events {
      id: string;
      app: App;
      parent: WorkspaceTabs;
      view: View;
      containerEl: HTMLDivElement;
      tabHeaderEl: HTMLDivElement;
      private tabIconEl;
      private tabTitleEl;
      private working;
      constructor(app: App);
      get isSidebar(): boolean;
      getViewState(): {
          type: string;
          state: ViewState;
      };
      /** Cambia la vista de la hoja (serializado para que no se pisen dos llamadas). */
      setViewState(vs: {
          type: string;
          state?: ViewState;
          active?: boolean;
      }, eState?: Record<string, unknown>): Promise<void>;
      openFile(file: TFile, opts?: OpenViewState): Promise<void>;
      getDisplayText(): string;
      updateHeader(): void;
      addPaneMenuItems(menu: Menu): void;
      detach(): void;
      private setView;
      private closeView;
  }
  export class WorkspaceTabs {
      app: App;
      parent: WorkspaceSplit | null;
      children: WorkspaceLeaf[];
      currentTab: number;
      size: number;
      isSidedock: boolean;
      containerEl: HTMLDivElement;
      tabHeaderContainerEl: HTMLDivElement;
      private tabHeadersEl;
      tabContainerEl: HTMLDivElement;
      constructor(app: App, isSidedock?: boolean);
      addLeaf(leaf: WorkspaceLeaf, index?: number): void;
      removeLeaf(leaf: WorkspaceLeaf): void;
      selectTab(leaf: WorkspaceLeaf): void;
      get activeLeaf(): WorkspaceLeaf | undefined;
  }
  export class WorkspaceSplit {
      app: App;
      parent: WorkspaceSplit | null;
      direction: SplitDirection;
      children: Item[];
      size: number;
      containerEl: HTMLDivElement;
      constructor(app: App, direction: SplitDirection);
      insertChild(index: number, child: Item): void;
      removeChild(child: Item): void;
      replaceChild(old: Item, next: Item): void;
      render(): void;
      private resizeHandle;
  }
  export class WorkspaceSidedock {
      app: App;
      side: 'left' | 'right';
      tabs: WorkspaceTabs;
      containerEl: HTMLDivElement;
      collapsed: boolean;
      width: number;
      constructor(app: App, side: 'left' | 'right');
      setWidth(w: number): void;
      expand(): void;
      collapse(): void;
      toggle(): void;
      setCollapsed(c: boolean): void;
  }
  interface LeafJSON {
      id?: string;
      view: {
          type: string;
          state: ViewState;
      };
  }
  interface TabsJSON {
      type: 'tabs';
      size: number;
      current: number;
      children: LeafJSON[];
  }
  interface SplitJSON {
      type: 'split';
      direction: SplitDirection;
      size: number;
      children: (SplitJSON | TabsJSON)[];
  }
  interface SideJSON {
      collapsed: boolean;
      width: number;
      current: number;
      children: LeafJSON[];
  }
  interface LayoutJSON {
      main: SplitJSON;
      left: SideJSON;
      right: SideJSON;
      active?: string;
  }
  export class Workspace extends Events {
      app: App;
      rootSplit: WorkspaceSplit;
      leftSplit: WorkspaceSidedock;
      rightSplit: WorkspaceSidedock;
      activeLeaf: WorkspaceLeaf | null;
      layoutReady: boolean;
      private mostRecentLeaf;
      private readyCbs;
      private saveTimer;
      constructor(app: App);
      onLayoutReady(cb: () => unknown): void;
      getMostRecentLeaf(): WorkspaceLeaf | null;
      getActiveFile(): TFile | null;
      getActiveViewOfType<T extends View>(type: abstract new (...args: any[]) => T): T | null;
      setActiveLeaf(leaf: WorkspaceLeaf, opts?: {
          focus?: boolean;
      }): void;
      /**
       * Hoja donde abrir algo: false = la actual (si es de navegación), true/'tab' =
       * pestaña nueva, 'split' = panel nuevo al costado.
       */
      getLeaf(newLeaf?: PaneType, direction?: SplitDirection): WorkspaceLeaf;
      createLeafBySplit(leaf: WorkspaceLeaf, direction?: SplitDirection, before?: boolean): WorkspaceLeaf;
      /** Abre lo mismo que `leaf` en un panel nuevo. */
      duplicateLeaf(leaf: WorkspaceLeaf, direction: SplitDirection): Promise<WorkspaceLeaf>;
      /** @internal lo llama leaf.detach() */
      removeLeaf(leaf: WorkspaceLeaf): void;
      private removeTabs;
      private ensureRootTabs;
      private isAttached;
      iterateRootLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void;
      iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void;
      getLeavesOfType(type: string): WorkspaceLeaf[];
      getLeftLeaf(): WorkspaceLeaf;
      getRightLeaf(): WorkspaceLeaf;
      /** Muestra la hoja: expande el sidebar si hace falta y la pone al frente. */
      revealLeaf(leaf: WorkspaceLeaf): void;
      /** Garantiza que haya una hoja `type` en el sidebar indicado y la devuelve. */
      ensureSideLeaf(type: string, side: 'left' | 'right', opts?: {
          reveal?: boolean;
          state?: ViewState;
      }): Promise<WorkspaceLeaf>;
      /** Abre un linktext ("nota", "nota#encabezado", "carpeta/nota"); si no existe, crea la nota. */
      openLinkText(linktext: string, sourcePath: string, newLeaf?: PaneType, state?: OpenViewState): Promise<void>;
      requestSaveLayout(): void;
      getLayout(): LayoutJSON;
      /** Arma el layout guardado (o el de fábrica). Las vistas tienen que estar registradas antes. */
      loadLayout(defaults: (ws: Workspace) => Promise<void>): Promise<void>;
  }
  /** Dónde crear una nota nueva a partir de un link o del botón "nueva nota". */
  export function newNotePath(app: App, name: string, sourcePath?: string): string;
  export const isImage: (f: TFile) => boolean;
}

declare module 'melanite/app/views/view' {
  import 'melanite/app/ui/dom';
  import { Component } from 'melanite/core/component';
  import type { TFile } from 'melanite/core/vault';
  import type { App } from 'melanite/app/app';
  import type { WorkspaceLeaf } from 'melanite/app/workspace';
  import { Menu } from 'melanite/app/ui/modal';
  export type ViewState = Record<string, unknown>;
  export abstract class View extends Component {
      app: App;
      leaf: WorkspaceLeaf;
      containerEl: HTMLDivElement;
      icon: string;
      /** true = vista de navegación (notas): se reemplaza al abrir otro archivo. */
      navigation: boolean;
      constructor(leaf: WorkspaceLeaf);
      abstract getViewType(): string;
      abstract getDisplayText(): string;
      getIcon(): string;
      getState(): ViewState;
      setState(_state: ViewState): Promise<void>;
      onOpen(): Promise<void>;
      onClose(): Promise<void>;
      /** Ítems extra para el menú "más opciones" de la vista. */
      onPaneMenu(_menu: Menu): void;
  }
  /** Vista con encabezado (título + acciones) y área de contenido. */
  export abstract class ItemView extends View {
      headerEl: HTMLDivElement;
      titleEl: HTMLDivElement;
      actionsEl: HTMLDivElement;
      contentEl: HTMLDivElement;
      constructor(leaf: WorkspaceLeaf);
      addAction(icon: string, title: string, cb: (evt: MouseEvent) => unknown): HTMLElement;
      /** Refresca título del encabezado y de la pestaña. */
      updateHeader(): void;
  }
  /** Vista asociada a un archivo del vault. */
  export abstract class FileView extends ItemView {
      file: TFile | null;
      allowNoFile: boolean;
      navigation: boolean;
      getDisplayText(): string;
      getState(): ViewState;
      setState(state: ViewState): Promise<void>;
      loadFile(file: TFile | null): Promise<void>;
      onLoadFile(_file: TFile): Promise<void>;
      onUnloadFile(_file: TFile): Promise<void>;
      onClose(): Promise<void>;
      /** Si se borra/renombra el archivo desde otro lado. */
      onRename(_file: TFile): void;
  }
  export class EmptyView extends ItemView {
      navigation: boolean;
      getViewType(): string;
      getDisplayText(): string;
      onOpen(): Promise<void>;
  }
}

declare module 'melanite/app/views/markdown-view' {
  import { EditorView } from '@codemirror/view';
  import { FileView, type ViewState } from 'melanite/app/views/view';
  import type { WorkspaceLeaf } from 'melanite/app/workspace';
  import { TFile } from 'melanite/core/vault';
  import { Editor } from 'melanite/app/editor/editor';
  import type { Menu } from 'melanite/app/ui/modal';
  export type MarkdownMode = 'source' | 'preview';
  export class MarkdownView extends FileView {
      icon: string;
      editor: Editor;
      cm: EditorView;
      /** 'source' = editando (live preview o fuente), 'preview' = modo lectura */
      mode: MarkdownMode;
      /** true = modo fuente (sin live preview) */
      sourceMode: boolean;
      sourceEl: HTMLDivElement;
      readingEl: HTMLDivElement;
      private renderedEl;
      private renderChild;
      private saveTimer;
      private dirty;
      private modeButton;
      constructor(leaf: WorkspaceLeaf);
      getViewType(): string;
      getState(): ViewState;
      setState(state: ViewState): Promise<void>;
      setEphemeralState(e: Record<string, unknown>): void;
      getViewData(): string;
      setViewData(data: string, clear: boolean): void;
      focus(): void;
      onOpen(): Promise<void>;
      onLoadFile(file: TFile): Promise<void>;
      onUnloadFile(): Promise<void>;
      onPaneMenu(menu: Menu): void;
      toggleMode(): void;
      toggleSourceMode(): void;
      private applyMode;
      private renderReading;
      private reconfigure;
      requestSave(): void;
      save(): Promise<void>;
      private newState;
      /** Reemplaza el texto conservando el cursor: solo cambia el tramo que difiere. */
      private replaceDoc;
      private handleFiles;
      insertAttachments(files: File[], pos?: number): Promise<void>;
      private scrollToSubpath;
      private toggleTaskFromReading;
  }
}

declare module 'melanite/app/views/settings' {
  import type { App } from 'melanite/app/app';
  import { Modal } from 'melanite/app/ui/modal';
  /** Pestaña de ajustes (la app y los plugins agregan las suyas). */
  export abstract class SettingTab {
      app: App;
      containerEl: HTMLDivElement;
      id: string;
      name: string;
      constructor(app: App);
      abstract display(): void;
      hide(): void;
  }
  export class SettingsModal extends Modal {
      private initial?;
      private navEl;
      private paneEl;
      private current;
      constructor(app: App, initial?: string | undefined);
      onOpen(): void;
      onClose(): void;
      private openTab;
  }
  export function coreSettingTabs(app: App): SettingTab[];
  global {
      const __APP_VERSION__: string;
  }
}

declare module 'melanite/app/editor/editor' {
  import { EditorView } from '@codemirror/view';
  export interface EditorPosition {
      line: number;
      ch: number;
  }
  export interface EditorRange {
      from: EditorPosition;
      to: EditorPosition;
  }
  /**
   * Editor con la API de Obsidian (líneas y columnas desde 0) sobre CodeMirror 6.
   * `cm` expone el EditorView para lo que la API no cubra.
   */
  export class Editor {
      cm: EditorView;
      constructor(cm: EditorView);
      private get doc();
      posToOffset(pos: EditorPosition): number;
      offsetToPos(offset: number): EditorPosition;
      getValue(): string;
      setValue(text: string): void;
      getLine(n: number): string;
      setLine(n: number, text: string): void;
      lineCount(): number;
      lastLine(): number;
      getRange(from: EditorPosition, to: EditorPosition): string;
      replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void;
      getSelection(): string;
      somethingSelected(): boolean;
      replaceSelection(text: string): void;
      listSelections(): {
          anchor: EditorPosition;
          head: EditorPosition;
      }[];
      getCursor(which?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition;
      setCursor(pos: EditorPosition | number, ch?: number): void;
      setSelection(anchor: EditorPosition, head?: EditorPosition): void;
      focus(): void;
      blur(): void;
      hasFocus(): boolean;
      undo(): void;
      redo(): void;
      scrollIntoView(range: EditorRange, center?: boolean): void;
  }
}

declare module 'melanite/app/render/renderer' {
  import 'melanite/app/ui/dom';
  import type { App } from 'melanite/app/app';
  import { Component } from 'melanite/core/component';
  import type { TFile } from 'melanite/core/vault';
  export interface MarkdownPostProcessorContext {
      sourcePath: string;
      docId: string;
      frontmatter: string | null;
      addChild(child: Component): void;
      getSectionInfo(el: HTMLElement): null;
  }
  export type MarkdownPostProcessor = ((el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void) & {
      sortOrder?: number;
  };
  export type CodeBlockProcessor = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void;
  /** URL (blob:) para mostrar un archivo binario del vault. Se cachea por versión. */
  export function getResourceUrl(app: App, file: TFile): Promise<string>;
  export function renderMath(el: HTMLElement, tex: string, display: boolean): Promise<void>;
  export function renderMermaid(el: HTMLElement, code: string): Promise<void>;
  export const calloutIcon: (type: string) => string;
  export const CALLOUT_RE: RegExp;
  export function extractSection(text: string, subpath: string): string;
  export class MarkdownRenderer {
      /** Renderiza `markdown` dentro de `el` (como el modo lectura). */
      static render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component, depth?: number): Promise<void>;
      static renderEmbed(app: App, el: HTMLElement, linktext: string, sourcePath: string, component: Component, depth: number): Promise<void>;
  }
  /** Lo que guarda la app para los plugins: post-processors y procesadores de bloques de código. */
  export class MarkdownRegistry {
      postProcessors: MarkdownPostProcessor[];
      codeBlockProcessors: Map<string, CodeBlockProcessor>;
      addPostProcessor(pp: MarkdownPostProcessor): () => void;
      addCodeBlockProcessor(lang: string, fn: CodeBlockProcessor): () => void;
  }
}

declare module 'melanite/app/ui/modal' {
  import 'melanite/app/ui/dom';
  import type { App } from 'melanite/app/app';
  export class Modal {
      app: App;
      containerEl: HTMLDivElement;
      modalEl: HTMLDivElement;
      titleEl: HTMLDivElement;
      contentEl: HTMLDivElement;
      private isOpen;
      constructor(app: App);
      open(): void;
      close(): void;
      setTitle(title: string): this;
      setContent(content: string | DocumentFragment): this;
      onOpen(): void;
      onClose(): void;
  }
  /** Pide un texto. Resuelve null si se cancela. */
  export function promptText(app: App, opts: {
      title: string;
      value?: string;
      placeholder?: string;
      cta?: string;
      selectUntil?: number;
  }): Promise<string | null>;
  export function confirmDialog(app: App, opts: {
      title: string;
      message: string;
      cta: string;
      warning?: boolean;
  }): Promise<boolean>;
  export class Notice {
      noticeEl: HTMLDivElement;
      constructor(message: string | DocumentFragment, duration?: number);
      setMessage(message: string | DocumentFragment): this;
      hide(): void;
  }
  export class MenuItem {
      dom: HTMLDivElement;
      private iconEl;
      private titleEl;
      /** @internal */ callback: ((evt: MouseEvent | KeyboardEvent) => unknown) | null;
      /** @internal */ disabled: boolean;
      constructor();
      setTitle(title: string | DocumentFragment): this;
      setIcon(icon: string | null): this;
      setChecked(checked: boolean | null): this;
      setDisabled(disabled: boolean): this;
      setWarning(warning: boolean): this;
      setSection(_section: string): this;
      onClick(cb: (evt: MouseEvent | KeyboardEvent) => unknown): this;
  }
  export class Menu {
      dom: HTMLDivElement;
      private items;
      private hideCbs;
      private outside;
      private keys;
      constructor();
      addItem(cb: (item: MenuItem) => unknown): this;
      addSeparator(): this;
      showAtMouseEvent(e: MouseEvent): this;
      showAtPosition(pos: {
          x: number;
          y: number;
      }): this;
      hide(): void;
      onHide(cb: () => unknown): void;
  }
  /**
   * Menú contextual que también funciona en iOS (Safari no dispara `contextmenu`
   * con el toque largo): llama a `cb` con la posición del click derecho o del toque largo.
   */
  export function onContextMenu(el: HTMLElement, cb: (pos: {
      x: number;
      y: number;
  }, target: EventTarget | null) => void): void;
}

declare module 'melanite/app/ui/setting' {
  import 'melanite/app/ui/dom';
  /** Fila de ajustes con la API encadenable de Obsidian: new Setting(el).setName().addToggle(…) */
  export class Setting {
      settingEl: HTMLDivElement;
      infoEl: HTMLDivElement;
      nameEl: HTMLDivElement;
      descEl: HTMLDivElement;
      controlEl: HTMLDivElement;
      constructor(containerEl: HTMLElement);
      setName(name: string | DocumentFragment): this;
      setDesc(desc: string | DocumentFragment): this;
      setClass(cls: string): this;
      setHeading(): this;
      setDisabled(disabled: boolean): this;
      addText(cb: (c: TextComponent) => unknown): this;
      addTextArea(cb: (c: TextAreaComponent) => unknown): this;
      addToggle(cb: (c: ToggleComponent) => unknown): this;
      addDropdown(cb: (c: DropdownComponent) => unknown): this;
      addSlider(cb: (c: SliderComponent) => unknown): this;
      addButton(cb: (c: ButtonComponent) => unknown): this;
      addExtraButton(cb: (c: ExtraButtonComponent) => unknown): this;
      then(cb: (s: this) => unknown): this;
  }
  abstract class ValueComponent<T, E extends HTMLElement> {
      abstract el: E;
      protected changeCb: ((v: T) => unknown) | null;
      abstract getValue(): T;
      abstract setValue(v: T): this;
      onChange(cb: (v: T) => unknown): this;
      setDisabled(d: boolean): this;
  }
  export class TextComponent extends ValueComponent<string, HTMLInputElement> {
      el: HTMLInputElement;
      get inputEl(): HTMLInputElement;
      constructor(parent: HTMLElement);
      getValue(): string;
      setValue(v: string): this;
      setPlaceholder(p: string): this;
  }
  export class TextAreaComponent extends ValueComponent<string, HTMLTextAreaElement> {
      el: HTMLTextAreaElement;
      get inputEl(): HTMLTextAreaElement;
      constructor(parent: HTMLElement);
      getValue(): string;
      setValue(v: string): this;
      setPlaceholder(p: string): this;
  }
  export class ToggleComponent extends ValueComponent<boolean, HTMLDivElement> {
      el: HTMLDivElement;
      get toggleEl(): HTMLDivElement;
      private value;
      constructor(parent: HTMLElement);
      getValue(): boolean;
      setValue(v: boolean): this;
  }
  export class DropdownComponent extends ValueComponent<string, HTMLSelectElement> {
      el: HTMLSelectElement;
      get selectEl(): HTMLSelectElement;
      constructor(parent: HTMLElement);
      addOption(value: string, display: string): this;
      addOptions(opts: Record<string, string>): this;
      getValue(): string;
      setValue(v: string): this;
  }
  export class SliderComponent extends ValueComponent<number, HTMLInputElement> {
      el: HTMLInputElement;
      get sliderEl(): HTMLInputElement;
      private valueEl;
      constructor(parent: HTMLElement);
      setLimits(min: number, max: number, step: number | 'any'): this;
      setDynamicTooltip(): this;
      private showValue;
      getValue(): number;
      setValue(v: number): this;
  }
  export class ButtonComponent {
      buttonEl: HTMLButtonElement;
      constructor(parent: HTMLElement);
      setButtonText(text: string): this;
      setIcon(icon: string): this;
      setCta(): this;
      setWarning(): this;
      setTooltip(tip: string): this;
      setDisabled(d: boolean): this;
      onClick(cb: (evt: MouseEvent) => unknown): this;
  }
  export class ExtraButtonComponent {
      extraSettingsEl: HTMLDivElement;
      constructor(parent: HTMLElement);
      setIcon(icon: string): this;
      setTooltip(tip: string): this;
      setDisabled(d: boolean): this;
      onClick(cb: () => unknown): this;
  }
}

declare module 'melanite/app/commands' {
  import type { App } from 'melanite/app/app';
  import type { Editor } from 'melanite/app/editor/editor';
  import type { MarkdownView } from 'melanite/app/views/markdown-view';
  export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';
  export interface Hotkey {
      modifiers: Modifier[];
      key: string;
  }
  export interface Command {
      id: string;
      name: string;
      icon?: string;
      hotkeys?: Hotkey[];
      /** se oculta del command palette */
      hidden?: boolean;
      callback?: () => unknown;
      checkCallback?: (checking: boolean) => boolean | void;
      editorCallback?: (editor: Editor, view: MarkdownView) => unknown;
      editorCheckCallback?: (checking: boolean, editor: Editor, view: MarkdownView) => boolean | void;
  }
  export const isMac: boolean;
  /** "Mod+Shift+E" para mostrar en la UI. */
  export function hotkeyLabel(h: Hotkey): string;
  export class Commands {
      app: App;
      commands: Record<string, Command>;
      /** atajos personalizados por el usuario (id → atajos); reemplazan a los de fábrica */
      customKeys: Record<string, Hotkey[]>;
      constructor(app: App);
      addCommand(cmd: Command): Command;
      removeCommand(id: string): void;
      listCommands(): Command[];
      hotkeysFor(cmd: Command): Hotkey[];
      /** ¿Se puede ejecutar ahora? (checkCallback / editorCallback necesitan contexto). */
      isAvailable(cmd: Command): boolean;
      executeCommandById(id: string): boolean;
      executeCommand(cmd: Command): boolean;
      /** Listener global de teclado. */
      handleKeydown: (e: KeyboardEvent) => void;
  }
}

declare module 'melanite/app/ui/icons' {
  /** Pone el ícono Lucide `id` (kebab-case, ej. "file-text") dentro de `el`. */
  export function setIcon(el: HTMLElement, id: string): void;
}

declare module 'melanite/core/path' {
  /** Rutas del vault: siempre con "/", sin "/" inicial ni final, sin segmentos vacíos. */
  export function normalizePath(p: string): string;
  export const basename: (p: string) => string;
  export const dirname: (p: string) => string;
  export function extname(p: string): string;
  export function stripExt(name: string): string;
  export const joinPath: (...parts: string[]) => string;
  export const isHidden: (p: string) => boolean;
  export const IMAGE_EXTS: string[];
  export const TEXT_EXTS: string[];
  export const isTextPath: (p: string) => boolean;
}

declare module 'melanite/core/yaml' {
  /** YAML para frontmatter y plugins (misma firma que en Obsidian). */
  export function parseYaml(text: string): any;
  export function stringifyYaml(obj: unknown): string;
}

declare module 'melanite/app/platform' {
  export const Platform: {
      /** pantalla angosta: sidebars como drawers */
      readonly isPhone: boolean;
      readonly isMobile: boolean;
      readonly isDesktop: boolean;
      isIos: boolean;
      isStandalone: boolean;
      onChange(cb: () => void): void;
  };
}

declare module 'melanite/app/ui/dom' {
  /**
   * Helpers de DOM con la misma forma que los de Obsidian (createEl, createDiv,
   * empty, setText, addClass…), agregados a HTMLElement para que la app y los
   * plugins armen UI igual.
   */
  export interface DomElementInfo {
      cls?: string | string[];
      text?: string | DocumentFragment;
      attr?: Record<string, string | number | boolean | null>;
      title?: string;
      parent?: Node;
      value?: string;
      type?: string;
      placeholder?: string;
      href?: string;
      prepend?: boolean;
  }
  type Info = DomElementInfo | string;
  global {
      interface Node {
          empty(): void;
          detach(): void;
      }
      interface Element {
          setText(text: string | DocumentFragment): void;
          addClass(...cls: string[]): void;
          removeClass(...cls: string[]): void;
          toggleClass(cls: string | string[], value: boolean): void;
          hasClass(cls: string): boolean;
          setAttr(name: string, value: string | number | boolean | null): void;
      }
      interface HTMLElement {
          createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, cb?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K];
          createDiv(o?: Info, cb?: (el: HTMLDivElement) => void): HTMLDivElement;
          createSpan(o?: Info, cb?: (el: HTMLSpanElement) => void): HTMLSpanElement;
          show(): void;
          hide(): void;
          toggle(show: boolean): void;
      }
      function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, cb?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K];
      function createDiv(o?: Info, cb?: (el: HTMLDivElement) => void): HTMLDivElement;
      function createSpan(o?: Info, cb?: (el: HTMLSpanElement) => void): HTMLSpanElement;
      function createFragment(cb?: (el: DocumentFragment) => void): DocumentFragment;
  }
}

declare module 'melanite/app/file-manager' {
  import type { App } from 'melanite/app/app';
  import { TAbstractFile, TFile, TFolder } from 'melanite/core/vault';
  /** Operaciones de archivos de alto nivel (las que hace la UI y la API de plugins). */
  export class FileManager {
      app: App;
      constructor(app: App);
      /** Carpeta donde va una nota nueva según los ajustes. */
      getNewFileParent(sourcePath?: string): TFolder;
      createNewMarkdownFile(name: string, sourcePath?: string): Promise<TFile>;
      createAndOpen(folder: TFolder, content?: string): Promise<TFile>;
      promptNewFolder(parent: TFolder): Promise<void>;
      /** Renombra o mueve. (En la fase 2 también actualiza los links que apuntan al archivo.) */
      renameFile(file: TAbstractFile, newPath: string): Promise<void>;
      promptForRename(file: TAbstractFile): Promise<void>;
      moveFile(file: TAbstractFile, folder: TFolder): Promise<void>;
      /** Elegir carpeta destino de una lista filtrable. */
      promptMove(file: TAbstractFile): Promise<void>;
      duplicate(file: TFile): Promise<void>;
      promptForDeletion(file: TAbstractFile): Promise<void>;
      /** Borra a la papelera del vault (.trash). */
      trashFile(file: TAbstractFile): Promise<void>;
      /** Guarda un archivo pegado/soltado/elegido en la carpeta de adjuntos. */
      saveAttachment(f: File, sourcePath: string): Promise<TFile>;
      /** Archivo soltado en el explorador desde el sistema operativo. */
      importFile(f: File, folder: TFolder): Promise<TFile>;
      generateMarkdownLink(file: TFile, sourcePath: string, embed?: boolean, subpath?: string, alias?: string): string;
      private validName;
  }
}

declare module 'melanite/plugins/manager' {
  import type { App } from 'melanite/app/app';
  import { Plugin, type PluginManifest } from 'melanite/api/plugin';
  import { type PluginFiles } from 'melanite/plugins/loader';
  type PluginCtor = new (app: App, manifest: PluginManifest) => Plugin;
  interface CoreEntry {
      manifest: PluginManifest;
      ctor: PluginCtor;
      defaultOn: boolean;
  }
  /**
   * Gestor de plugins: internos (registerCore) y de la comunidad (carpeta
   * `.melanite/plugins/<id>/` del vault, así se sincronizan).
   */
  export class PluginManager {
      app: App;
      core: Map<string, CoreEntry>;
      /** instancias cargadas (internos y de la comunidad), por id */
      plugins: Record<string, Plugin>;
      private coreEnabled;
      /** plugins de la comunidad instalados (leídos del vault) */
      manifests: Record<string, PluginManifest>;
      /** ids de la comunidad activos */
      enabledCommunity: Set<string>;
      /** último error de carga de cada plugin de la comunidad (para la pantalla de ajustes) */
      errors: Record<string, string>;
      private specUrls;
      constructor(app: App);
      /** Lo llaman los módulos en su install(): el plugin interno queda disponible. */
      registerCore(manifest: PluginManifest, ctor: PluginCtor, defaultOn?: boolean): void;
      isCoreEnabled(id: string): boolean;
      /** Al arrancar, antes del layout: los internos activos y después los de la comunidad activos. */
      loadCore(): Promise<void>;
      setCoreEnabled(id: string, on: boolean): Promise<void>;
      getPlugin(id: string): Plugin | null;
      /** @internal */
      loadPlugin(id: string, ctor?: PluginCtor, manifest?: PluginManifest): Promise<Plugin | null>;
      /** @internal */
      unloadPlugin(id: string): void;
      /** Lee los manifests de `.melanite/plugins/*` y la lista de activos. */
      scanCommunity(): Promise<void>;
      loadCommunity(): Promise<void>;
      setCommunityEnabled(id: string, on: boolean): Promise<boolean>;
      /** Importa main.js desde una blob URL, instancia la clase e inyecta styles.css. Errores: Notice y log. */
      loadCommunityPlugin(id: string): Promise<Plugin | null>;
      reloadCommunityPlugin(id: string): Promise<void>;
      /** Escribe manifest/main/styles en `.melanite/plugins/<id>/`. Si estaba activo, lo recarga. */
      installPlugin(files: PluginFiles): Promise<PluginManifest>;
      uninstallPlugin(id: string): Promise<void>;
      /** blob URLs que reexportan los módulos compartidos (para los plugins escritos en ESM). */
      private sharedSpecUrls;
  }
}

declare module 'melanite/core/db' {
  import Dexie, { type Table } from 'dexie';
  export interface FileRow {
      id: string;
      path: string;
      folder: 0 | 1;
      /** contenido de archivos de texto; los binarios van en la tabla blobs */
      text?: string;
      mtime: number;
      ctime: number;
      size: number;
  }
  export interface BlobRow {
      id: string;
      data: ArrayBuffer;
  }
  export interface KVRow {
      key: string;
      value: unknown;
  }
  export class MelaniteDB extends Dexie {
      files: Table<FileRow, string>;
      blobs: Table<BlobRow, string>;
      kv: Table<KVRow, string>;
      constructor(name?: string);
  }
}

declare module 'melanite/plugins/loader' {
  /**
   * Partes puras del loader de plugins de la comunidad (sin DOM: se testean en node).
   */
  export type PluginFiles = Record<string, string>;
  export const PLUGIN_FILES: readonly ['manifest.json', 'main.js', 'styles.css'];
  /** módulos que la app comparte con los plugins (mismas instancias) */
  export const SHARED_MODULES: string[];
  /**
   * Convierte el main.js de un plugin en un módulo ESM importable desde una blob URL.
   * - CJS (lo normal, estilo Obsidian): se envuelve con el shim del Contrato 3.
   * - ESM: se reescriben los imports de módulos compartidos a `specUrls[nombre]`.
   */
  export function wrapPluginSource(code: string, specUrls?: Record<string, string>, id?: string): string;
  /** Módulo ESM que reexporta un módulo compartido (para los plugins ESM que hacen `import { X } from 'melanite'`). */
  export function sharedModuleSource(name: string, keys: string[]): string;
  export interface ManifestLike {
      id: string;
      name: string;
      version: string;
      minAppVersion?: string;
  }
  /** Valida el manifest; devuelve un mensaje de error o null. */
  export function manifestError(m: unknown): string | null;
  /** Compara versiones "1.2.3" numéricamente: <0, 0 o >0. */
  export function compareVersions(a: string, b: string): number;
  /** Saca manifest/main/styles de un zip, con los archivos en la raíz o dentro de una carpeta. */
  export function filesFromZip(data: Uint8Array): PluginFiles;
  /** `https://github.com/o/r`, `…/releases`, `…/releases/tag/x` o `o/r` → partes. */
  export function parseGithubSource(url: string): {
      owner: string;
      repo: string;
      tag: string | null;
  } | null;
}
