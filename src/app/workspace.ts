import './ui/dom';
import { Events } from '../core/events';
import { TFile } from '../core/vault';
import { IMAGE_EXTS, dirname, joinPath, normalizePath } from '../core/path';
import { parseWikilink, resolveLinkpath } from '../core/links';
import type { App } from './app';
import { EmptyView, FileView, View, type ViewState } from './views/view';
import { setIcon } from './ui/icons';
import { Menu, Notice, onContextMenu } from './ui/modal';
import { t } from './i18n';
import { Platform } from './platform';

/** 'vertical' = paneles lado a lado (como en Obsidian), 'horizontal' = uno arriba del otro. */
export type SplitDirection = 'vertical' | 'horizontal';
export type PaneType = boolean | 'tab' | 'split';
export interface OpenViewState { active?: boolean; state?: ViewState; eState?: Record<string, unknown> }
type Item = WorkspaceSplit | WorkspaceTabs;

const LAYOUT_KEY = 'melanite:layout';
const leafId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- hoja

export class WorkspaceLeaf extends Events {
  id = leafId();
  app: App;
  parent!: WorkspaceTabs;
  view!: View;
  containerEl: HTMLDivElement;
  tabHeaderEl: HTMLDivElement;
  private tabIconEl: HTMLDivElement;
  private tabTitleEl: HTMLDivElement;
  private working = Promise.resolve();

  constructor(app: App) {
    super();
    this.app = app;
    this.containerEl = createDiv('workspace-leaf');
    this.containerEl.addEventListener('pointerdown', () => this.app.workspace.setActiveLeaf(this), true);
    this.tabHeaderEl = createDiv({ cls: 'workspace-tab-header', attr: { draggable: 'false' } });
    this.tabIconEl = this.tabHeaderEl.createDiv('workspace-tab-header-icon');
    this.tabTitleEl = this.tabHeaderEl.createDiv('workspace-tab-header-title');
    const close = this.tabHeaderEl.createDiv({ cls: 'workspace-tab-header-close clickable-icon', attr: { 'aria-label': t('cmd.closeTab') } });
    setIcon(close, 'x');
    close.addEventListener('click', (e) => { e.stopPropagation(); this.detach(); });
    this.tabHeaderEl.addEventListener('click', () => this.app.workspace.setActiveLeaf(this, { focus: true }));
    this.tabHeaderEl.addEventListener('auxclick', (e) => { if (e.button === 1) this.detach(); });
    onContextMenu(this.tabHeaderEl, (pos) => {
      const menu = new Menu();
      this.view.onPaneMenu(menu);
      this.addPaneMenuItems(menu);
      menu.showAtPosition(pos);
    });
    this.setView(new EmptyView(this));
    void this.view.onOpen();
  }

  get isSidebar(): boolean { return this.parent?.isSidedock ?? false; }

  getViewState(): { type: string; state: ViewState } {
    return { type: this.view.getViewType(), state: this.view.getState() };
  }

  /** Cambia la vista de la hoja (serializado para que no se pisen dos llamadas). */
  setViewState(vs: { type: string; state?: ViewState; active?: boolean }, eState?: Record<string, unknown>): Promise<void> {
    this.working = this.working.then(async () => {
      if (this.view.getViewType() !== vs.type) {
        const make = this.app.viewRegistry.get(vs.type);
        await this.closeView();
        this.setView(make ? make(this) : new EmptyView(this));
        await this.view.onOpen();
      }
      if (vs.state) await this.view.setState(vs.state);
      if (eState) (this.view as { setEphemeralState?: (s: Record<string, unknown>) => void }).setEphemeralState?.(eState);
      this.updateHeader();
      // en el teléfono enfocar el editor abre el teclado: solo se enfoca en escritorio
      if (vs.active) this.app.workspace.setActiveLeaf(this, { focus: !Platform.isPhone });
      if (this.view instanceof FileView && this.app.workspace.getMostRecentLeaf() === this) this.app.workspace.trigger('file-open', this.view.file);
      this.app.workspace.requestSaveLayout();
    }).catch((err) => console.error('[melanite] setViewState', err));
    return this.working;
  }

  async openFile(file: TFile, opts: OpenViewState = {}): Promise<void> {
    const type = this.app.viewTypeForExtension(file.extension);
    if (!type) { new Notice(t('notice.cannotOpen', { name: file.name })); return; }
    await this.setViewState({ type, state: { ...(opts.state ?? {}), file: file.path }, active: opts.active ?? true }, opts.eState);
  }

  getDisplayText(): string { return this.view.getDisplayText(); }

  updateHeader(): void {
    setIcon(this.tabIconEl, this.view.getIcon());
    this.tabTitleEl.setText(this.view.getDisplayText());
    this.tabHeaderEl.title = this.view.getDisplayText();
    this.tabHeaderEl.setAttr('aria-label', this.view.getDisplayText());
  }

  addPaneMenuItems(menu: Menu): void {
    const ws = this.app.workspace;
    if (!this.isSidebar) {
      menu.addItem((i) => i.setTitle(t('cmd.splitRight')).setIcon('columns-2').onClick(() => ws.duplicateLeaf(this, 'vertical')));
      menu.addItem((i) => i.setTitle(t('cmd.splitDown')).setIcon('rows-2').onClick(() => ws.duplicateLeaf(this, 'horizontal')));
      menu.addSeparator();
    }
    menu.addItem((i) => i.setTitle(t('cmd.closeTab')).setIcon('x').onClick(() => this.detach()));
    if (this.parent.children.length > 1) {
      menu.addItem((i) => i.setTitle(t('cmd.closeOthers')).onClick(() => { for (const l of this.parent.children.slice()) if (l !== this) l.detach(); }));
    }
  }

  detach(): void {
    void this.closeView().then(() => this.app.workspace.removeLeaf(this));
  }

  private setView(view: View): void {
    this.view = view;
    this.containerEl.empty();
    this.containerEl.appendChild(view.containerEl);
    view.load();
    this.updateHeader();
  }

  private async closeView(): Promise<void> {
    if (!this.view) return;
    try { await this.view.onClose(); } catch (err) { console.error('[melanite] onClose', err); }
    this.view.unload();
    this.view.containerEl.detach();
  }
}

// ---------------------------------------------------------------- grupo de pestañas

export class WorkspaceTabs {
  app: App;
  parent: WorkspaceSplit | null = null;
  children: WorkspaceLeaf[] = [];
  currentTab = 0;
  size = 1;
  isSidedock: boolean;
  containerEl: HTMLDivElement;
  tabHeaderContainerEl: HTMLDivElement;
  private tabHeadersEl: HTMLDivElement;
  tabContainerEl: HTMLDivElement;

  constructor(app: App, isSidedock = false) {
    this.app = app;
    this.isSidedock = isSidedock;
    this.containerEl = createDiv('workspace-tabs');
    this.containerEl.toggleClass('mod-sidedock', isSidedock);
    this.tabHeaderContainerEl = this.containerEl.createDiv('workspace-tab-header-container');
    this.tabHeadersEl = this.tabHeaderContainerEl.createDiv('workspace-tab-header-container-inner');
    if (!isSidedock) {
      const add = this.tabHeaderContainerEl.createDiv({ cls: 'workspace-tab-header-new-tab clickable-icon', attr: { 'aria-label': t('view.newTab') } });
      setIcon(add, 'plus');
      add.addEventListener('click', () => {
        const leaf = new WorkspaceLeaf(this.app);
        this.addLeaf(leaf);
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
      });
    }
    this.tabContainerEl = this.containerEl.createDiv('workspace-tab-container');
  }

  addLeaf(leaf: WorkspaceLeaf, index = this.children.length): void {
    leaf.parent = this;
    this.children.splice(index, 0, leaf);
    this.tabHeadersEl.insertBefore(leaf.tabHeaderEl, this.tabHeadersEl.children[index] ?? null);
    this.tabContainerEl.appendChild(leaf.containerEl);
    this.selectTab(leaf);
    this.app.workspace.requestSaveLayout();
  }

  removeLeaf(leaf: WorkspaceLeaf): void {
    const i = this.children.indexOf(leaf);
    if (i < 0) return;
    this.children.splice(i, 1);
    leaf.tabHeaderEl.detach();
    leaf.containerEl.detach();
    if (this.children.length) this.selectTab(this.children[Math.min(i, this.children.length - 1)]);
  }

  selectTab(leaf: WorkspaceLeaf): void {
    this.currentTab = Math.max(0, this.children.indexOf(leaf));
    this.children.forEach((l, i) => {
      l.tabHeaderEl.toggleClass('is-active', i === this.currentTab);
      l.containerEl.toggle(i === this.currentTab);
    });
  }

  get activeLeaf(): WorkspaceLeaf | undefined { return this.children[this.currentTab]; }
}

// ---------------------------------------------------------------- split

export class WorkspaceSplit {
  app: App;
  parent: WorkspaceSplit | null = null;
  direction: SplitDirection;
  children: Item[] = [];
  size = 1;
  containerEl: HTMLDivElement;

  constructor(app: App, direction: SplitDirection) {
    this.app = app;
    this.direction = direction;
    this.containerEl = createDiv(`workspace-split mod-${direction}`);
  }

  insertChild(index: number, child: Item): void {
    child.parent = this;
    this.children.splice(index, 0, child);
    this.render();
  }

  removeChild(child: Item): void {
    this.children = this.children.filter((c) => c !== child);
    child.containerEl.detach();
    child.parent = null;
    this.render();
  }

  replaceChild(old: Item, next: Item): void {
    const i = this.children.indexOf(old);
    next.parent = this;
    next.size = old.size;
    old.parent = null;
    old.containerEl.detach();
    this.children[i] = next;
    this.render();
  }

  render(): void {
    this.containerEl.empty();
    this.children.forEach((c, i) => {
      if (i > 0) this.containerEl.appendChild(this.resizeHandle(i - 1));
      c.containerEl.style.flexGrow = String(c.size);
      this.containerEl.appendChild(c.containerEl);
    });
  }

  private resizeHandle(i: number): HTMLElement {
    const handle = createDiv('workspace-leaf-resize-handle');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const a = this.children[i], b = this.children[i + 1];
      const horiz = this.direction === 'vertical';
      const ra = a.containerEl.getBoundingClientRect(), rb = b.containerEl.getBoundingClientRect();
      const pxA = horiz ? ra.width : ra.height, pxTotal = pxA + (horiz ? rb.width : rb.height);
      const sizeTotal = a.size + b.size;
      const start = horiz ? e.clientX : e.clientY;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const px = Math.min(pxTotal - 80, Math.max(80, pxA + (horiz ? ev.clientX : ev.clientY) - start));
        a.size = (sizeTotal * px) / pxTotal;
        b.size = sizeTotal - a.size;
        a.containerEl.style.flexGrow = String(a.size);
        b.containerEl.style.flexGrow = String(b.size);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.app.workspace.requestSaveLayout();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    return handle;
  }
}

// ---------------------------------------------------------------- sidebar

export class WorkspaceSidedock {
  app: App;
  side: 'left' | 'right';
  tabs: WorkspaceTabs;
  containerEl: HTMLDivElement;
  collapsed = false;
  width = 280;

  constructor(app: App, side: 'left' | 'right') {
    this.app = app;
    this.side = side;
    this.containerEl = createDiv(`workspace-sidedock mod-${side}`);
    this.tabs = new WorkspaceTabs(app, true);
    this.containerEl.appendChild(this.tabs.containerEl);
    const handle = this.containerEl.createDiv('sidedock-resize-handle');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX, startW = this.width;
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) * (side === 'left' ? 1 : -1);
        this.setWidth(Math.min(600, Math.max(180, startW + dx)));
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.app.workspace.requestSaveLayout();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    this.setWidth(this.width);
  }

  setWidth(w: number) { this.width = w; this.containerEl.style.setProperty('--sidedock-width', `${w}px`); }
  expand() { this.setCollapsed(false); }
  collapse() { this.setCollapsed(true); }
  toggle() { this.setCollapsed(!this.collapsed); }
  setCollapsed(c: boolean) {
    this.collapsed = c;
    this.containerEl.toggleClass('is-collapsed', c);
    document.body.toggleClass(`${this.side}-sidedock-open`, !c);
    this.app.workspace.trigger('layout-change');
    this.app.workspace.requestSaveLayout();
  }
}

// ---------------------------------------------------------------- workspace

interface LeafJSON { id?: string; view: { type: string; state: ViewState } }
interface TabsJSON { type: 'tabs'; size: number; current: number; children: LeafJSON[] }
interface SplitJSON { type: 'split'; direction: SplitDirection; size: number; children: (SplitJSON | TabsJSON)[] }
interface SideJSON { collapsed: boolean; width: number; current: number; children: LeafJSON[] }
interface LayoutJSON { main: SplitJSON; left: SideJSON; right: SideJSON; active?: string }

export class Workspace extends Events {
  app: App;
  rootSplit: WorkspaceSplit;
  leftSplit: WorkspaceSidedock;
  rightSplit: WorkspaceSidedock;
  activeLeaf: WorkspaceLeaf | null = null;
  layoutReady = false;
  private mostRecentLeaf: WorkspaceLeaf | null = null;
  private readyCbs: (() => unknown)[] = [];
  private saveTimer = 0;

  constructor(app: App) {
    super();
    this.app = app;
    this.rootSplit = new WorkspaceSplit(app, 'vertical');
    this.rootSplit.containerEl.addClass('mod-root');
    this.leftSplit = new WorkspaceSidedock(app, 'left');
    this.rightSplit = new WorkspaceSidedock(app, 'right');
  }

  onLayoutReady(cb: () => unknown): void {
    if (this.layoutReady) cb(); else this.readyCbs.push(cb);
  }

  // ---- hojas

  getMostRecentLeaf(): WorkspaceLeaf | null {
    if (this.mostRecentLeaf && this.isAttached(this.mostRecentLeaf)) return this.mostRecentLeaf;
    let first: WorkspaceLeaf | null = null;
    this.iterateRootLeaves((l) => { first ??= l; });
    return first;
  }

  getActiveFile(): TFile | null {
    const v = this.getMostRecentLeaf()?.view;
    return v instanceof FileView ? v.file : null;
  }

  getActiveViewOfType<T extends View>(type: abstract new (...args: any[]) => T): T | null {
    const v = this.getMostRecentLeaf()?.view;
    return v instanceof type ? v : null;
  }

  setActiveLeaf(leaf: WorkspaceLeaf, opts: { focus?: boolean } = {}): void {
    leaf.parent.selectTab(leaf);
    if (this.activeLeaf !== leaf) {
      this.activeLeaf?.containerEl.removeClass('mod-active');
      this.activeLeaf = leaf;
      leaf.containerEl.addClass('mod-active');
      const changedRoot = !leaf.isSidebar && this.mostRecentLeaf !== leaf;
      if (!leaf.isSidebar) this.mostRecentLeaf = leaf;
      this.trigger('active-leaf-change', leaf);
      if (changedRoot) this.trigger('file-open', this.getActiveFile());
      this.requestSaveLayout();
    }
    if (opts.focus) (leaf.view as { focus?: () => void }).focus?.();
  }

  /**
   * Hoja donde abrir algo: false = la actual (si es de navegación), true/'tab' =
   * pestaña nueva, 'split' = panel nuevo al costado.
   */
  getLeaf(newLeaf: PaneType = false, direction: SplitDirection = 'vertical'): WorkspaceLeaf {
    const current = this.getMostRecentLeaf();
    if (newLeaf === 'split' && current) return this.createLeafBySplit(current, direction);
    if (!newLeaf && current && current.view.navigation) return current;
    const leaf = new WorkspaceLeaf(this.app);
    const tabs = current?.parent ?? this.ensureRootTabs();
    tabs.addLeaf(leaf, current ? tabs.children.indexOf(current) + 1 : tabs.children.length);
    return leaf;
  }

  createLeafBySplit(leaf: WorkspaceLeaf, direction: SplitDirection = 'vertical', before = false): WorkspaceLeaf {
    const tabs = leaf.parent;
    const split = tabs.parent ?? this.rootSplit;
    const newTabs = new WorkspaceTabs(this.app);
    const newLeaf = new WorkspaceLeaf(this.app);
    newTabs.addLeaf(newLeaf);
    if (split.direction === direction) {
      const i = split.children.indexOf(tabs);
      split.insertChild(before ? i : i + 1, newTabs);
    } else {
      const sub = new WorkspaceSplit(this.app, direction);
      split.replaceChild(tabs, sub);
      tabs.size = 1;
      sub.insertChild(0, tabs);
      sub.insertChild(before ? 0 : 1, newTabs);
    }
    return newLeaf;
  }

  /** Abre lo mismo que `leaf` en un panel nuevo. */
  async duplicateLeaf(leaf: WorkspaceLeaf, direction: SplitDirection): Promise<WorkspaceLeaf> {
    const next = this.createLeafBySplit(leaf, direction);
    await next.setViewState({ ...leaf.getViewState(), active: true });
    return next;
  }

  /** @internal lo llama leaf.detach() */
  removeLeaf(leaf: WorkspaceLeaf): void {
    const tabs = leaf.parent;
    tabs.removeLeaf(leaf);
    if (leaf === this.activeLeaf) this.activeLeaf = null;
    if (leaf === this.mostRecentLeaf) this.mostRecentLeaf = null;
    if (!tabs.isSidedock && !tabs.children.length) this.removeTabs(tabs);
    const next = tabs.activeLeaf && tabs.children.length ? tabs.activeLeaf : this.getMostRecentLeaf();
    if (next) this.setActiveLeaf(next);
    else this.trigger('file-open', null);
    this.trigger('layout-change');
    this.requestSaveLayout();
  }

  private removeTabs(tabs: WorkspaceTabs) {
    let split = tabs.parent;
    if (!split) return;
    split.removeChild(tabs);
    // colapsar splits que quedaron con un solo hijo
    while (split && split !== this.rootSplit && split.children.length <= 1) {
      const parent: WorkspaceSplit | null = split.parent;
      if (!parent) break;
      if (split.children.length === 1) parent.replaceChild(split, split.children[0]);
      else parent.removeChild(split);
      split = parent;
    }
    if (!this.rootSplit.children.length) {
      const fresh = new WorkspaceTabs(this.app);
      this.rootSplit.insertChild(0, fresh);
      fresh.addLeaf(new WorkspaceLeaf(this.app));
    }
  }

  private ensureRootTabs(): WorkspaceTabs {
    let found: WorkspaceTabs | null = null;
    const walk = (it: Item) => { if (found) return; if (it instanceof WorkspaceTabs) found = it; else it.children.forEach(walk); };
    walk(this.rootSplit);
    if (found) return found;
    const tabs = new WorkspaceTabs(this.app);
    this.rootSplit.insertChild(0, tabs);
    return tabs;
  }

  private isAttached(leaf: WorkspaceLeaf): boolean {
    let ok = false;
    this.iterateAllLeaves((l) => { if (l === leaf) ok = true; });
    return ok;
  }

  iterateRootLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void {
    const walk = (it: Item) => { if (it instanceof WorkspaceTabs) it.children.forEach((l) => cb(l)); else it.children.forEach(walk); };
    walk(this.rootSplit);
  }

  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void {
    this.iterateRootLeaves(cb);
    this.leftSplit.tabs.children.forEach((l) => cb(l));
    this.rightSplit.tabs.children.forEach((l) => cb(l));
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    const out: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((l) => { if (l.view.getViewType() === type) out.push(l); });
    return out;
  }

  getLeftLeaf(): WorkspaceLeaf { const l = new WorkspaceLeaf(this.app); this.leftSplit.tabs.addLeaf(l); return l; }
  getRightLeaf(): WorkspaceLeaf { const l = new WorkspaceLeaf(this.app); this.rightSplit.tabs.addLeaf(l); return l; }

  /** Muestra la hoja: expande el sidebar si hace falta y la pone al frente. */
  revealLeaf(leaf: WorkspaceLeaf): void {
    if (this.leftSplit.tabs.children.includes(leaf)) this.leftSplit.expand();
    if (this.rightSplit.tabs.children.includes(leaf)) this.rightSplit.expand();
    leaf.parent.selectTab(leaf);
  }

  /** Garantiza que haya una hoja `type` en el sidebar indicado y la devuelve. */
  async ensureSideLeaf(type: string, side: 'left' | 'right', opts: { reveal?: boolean; state?: ViewState } = {}): Promise<WorkspaceLeaf> {
    let leaf = this.getLeavesOfType(type)[0];
    if (!leaf) {
      leaf = side === 'left' ? this.getLeftLeaf() : this.getRightLeaf();
      await leaf.setViewState({ type, state: opts.state });
    }
    if (opts.reveal) this.revealLeaf(leaf);
    return leaf;
  }

  // ---- abrir

  /** Abre un linktext ("nota", "nota#encabezado", "carpeta/nota"); si no existe, crea la nota. */
  async openLinkText(linktext: string, sourcePath: string, newLeaf: PaneType = false, state?: OpenViewState): Promise<void> {
    const { path, subpath } = parseWikilink(linktext);
    let file = path ? resolveLinkpath(this.app.vault, path, sourcePath) : this.app.vault.getFileByPath(sourcePath);
    if (!file) {
      if (!path) return;
      file = await this.app.fileManager.createNewMarkdownFile(path, sourcePath);
    }
    await this.getLeaf(newLeaf).openFile(file, { ...state, eState: { ...(state?.eState ?? {}), subpath } });
  }

  // ---- layout

  requestSaveLayout(): void {
    if (!this.layoutReady) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.getLayout())); } catch { /* sin storage */ }
    }, 300);
  }

  getLayout(): LayoutJSON {
    const leafJSON = (l: WorkspaceLeaf): LeafJSON => ({ id: l.id, view: l.getViewState() });
    const node = (it: Item): SplitJSON | TabsJSON => it instanceof WorkspaceTabs
      ? { type: 'tabs', size: it.size, current: it.currentTab, children: it.children.map(leafJSON) }
      : { type: 'split', direction: it.direction, size: it.size, children: it.children.map(node) };
    const side = (s: WorkspaceSidedock): SideJSON => ({ collapsed: s.collapsed, width: s.width, current: s.tabs.currentTab, children: s.tabs.children.map(leafJSON) });
    return { main: node(this.rootSplit) as SplitJSON, left: side(this.leftSplit), right: side(this.rightSplit), active: this.getMostRecentLeaf()?.id };
  }

  /** Arma el layout guardado (o el de fábrica). Las vistas tienen que estar registradas antes. */
  async loadLayout(defaults: (ws: Workspace) => Promise<void>): Promise<void> {
    let saved: LayoutJSON | null = null;
    try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'); } catch { saved = null; }
    const pending: Promise<void>[] = [];
    const byId = new Map<string, WorkspaceLeaf>();
    const makeLeaf = (tabs: WorkspaceTabs, j: LeafJSON) => {
      const leaf = new WorkspaceLeaf(this.app);
      if (j.id) leaf.id = j.id;
      byId.set(leaf.id, leaf);
      tabs.addLeaf(leaf);
      if (j.view.type !== 'empty') pending.push(leaf.setViewState(j.view));
    };
    const build = (j: SplitJSON | TabsJSON, into: WorkspaceSplit) => {
      if (j.type === 'tabs') {
        if (!j.children.length) return;
        const tabs = new WorkspaceTabs(this.app);
        tabs.size = j.size;
        into.insertChild(into.children.length, tabs);
        j.children.forEach((c) => makeLeaf(tabs, c));
        tabs.selectTab(tabs.children[Math.min(j.current, tabs.children.length - 1)]);
      } else {
        const split = new WorkspaceSplit(this.app, j.direction);
        split.size = j.size;
        into.insertChild(into.children.length, split);
        j.children.forEach((c) => build(c, split));
        if (!split.children.length) into.removeChild(split);
      }
    };

    if (saved?.main) {
      this.rootSplit.direction = saved.main.direction;
      saved.main.children.forEach((c) => build(c, this.rootSplit));
      for (const [side, js] of [[this.leftSplit, saved.left], [this.rightSplit, saved.right]] as const) {
        if (!js) continue;
        side.setWidth(js.width);
        js.children.forEach((c) => makeLeaf(side.tabs, c));
        if (side.tabs.children.length) side.tabs.selectTab(side.tabs.children[Math.min(js.current, side.tabs.children.length - 1)]);
        side.setCollapsed(js.collapsed);
      }
    }
    await Promise.all(pending);
    if (!this.rootSplit.children.length) this.ensureRootTabs().addLeaf(new WorkspaceLeaf(this.app));
    if (!saved) await defaults(this);

    const active = (saved?.active && byId.get(saved.active)) || this.getMostRecentLeaf();
    if (active) this.setActiveLeaf(active);
    this.layoutReady = true;
    for (const cb of this.readyCbs.splice(0)) cb();
    this.trigger('layout-ready');
  }
}

/** Dónde crear una nota nueva a partir de un link o del botón "nueva nota". */
export function newNotePath(app: App, name: string, sourcePath = ''): string {
  name = normalizePath(name);
  if (name.includes('/')) return name.endsWith('.md') ? name : `${name}.md`;
  const s = app.settings;
  const folder = s.newFileLocation === 'current' ? dirname(sourcePath) : s.newFileLocation === 'folder' ? s.newFileFolder : '';
  const base = joinPath(folder, name.replace(/\.md$/, ''));
  return app.vault.getAvailablePath(base, 'md');
}

export const isImage = (f: TFile) => IMAGE_EXTS.includes(f.extension);
