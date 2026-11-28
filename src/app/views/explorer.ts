import { ItemView, FileView } from './view';
import { TAbstractFile, TFile, TFolder } from '../../core/vault';
import { setIcon } from '../ui/icons';
import { Menu, onContextMenu } from '../ui/modal';
import { exportFolderPdf, exportPdf } from '../pdf';
import { t } from '../i18n';
import { Platform } from '../platform';
import { placeName, renameInOrder, sortEntries, type ExplorerOrder } from './explorer-order';

export const EXPLORER_VIEW = 'file-explorer';
const EXPANDED_KEY = 'melanite:explorer-expanded';
export const DRAG_TYPE = 'application/x-melanite-path';
const ORDER_FILE = 'explorer-order.json';

export class FileExplorerView extends ItemView {
  icon = 'folder';
  private treeEl!: HTMLDivElement;
  private expanded = new Set<string>();
  private renderTimer = 0;
  private order: ExplorerOrder = {};

  getViewType() { return EXPLORER_VIEW; }
  getDisplayText() { return t('explorer.title'); }

  async onOpen(): Promise<void> {
    try { this.expanded = new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]')); } catch { /* vacío */ }
    this.headerEl.empty();
    this.headerEl.addClass('nav-header');
    const buttons = this.headerEl.createDiv('nav-buttons-container');
    const btn = (icon: string, label: string, cb: () => unknown) => {
      const b = buttons.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': label }, title: label });
      setIcon(b, icon);
      b.addEventListener('click', () => void cb());
    };
    btn('file-plus', t('cmd.newNote'), () => this.app.fileManager.createAndOpen(this.app.fileManager.getNewFileParent()));
    btn('folder-plus', t('cmd.newFolder'), () => this.app.fileManager.promptNewFolder(this.app.fileManager.getNewFileParent()));
    btn('chevrons-down-up', t('explorer.collapseAll'), () => this.collapseAll());

    this.treeEl = this.contentEl.createDiv('nav-files-container');
    this.contentEl.addClass('file-explorer');
    this.setupDrop(this.treeEl, () => this.app.vault.getRoot());
    onContextMenu(this.treeEl, (pos, target) => {
      if ((target as HTMLElement).closest('.tree-item-self')) return;
      this.folderMenu(this.app.vault.getRoot()).showAtPosition(pos);
    });

    this.order = (await this.app.readConfig<ExplorerOrder>(ORDER_FILE)) ?? {};
    for (const ev of ['create', 'delete'] as const) this.registerEvent(this.app.vault.on(ev, () => this.requestRender()));
    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      const next = renameInOrder(this.order, oldPath, file.path);
      if (next) void this.saveOrder(next);
      this.requestRender();
    }));
    // el orden llega de otro dispositivo (sync) o lo escribimos nosotros
    this.registerEvent(this.app.vault.on('modify', async (f: TFile) => {
      if (f.path !== `.melanite/${ORDER_FILE}`) return;
      this.order = (await this.app.readConfig<ExplorerOrder>(ORDER_FILE)) ?? {};
      this.requestRender();
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => this.highlightActive()));
    this.render();
  }

  /** Expande las carpetas hasta el archivo y lo marca. */
  revealFile(file: TAbstractFile): void {
    for (let p = file.parent; p && !p.isRoot(); p = p.parent) this.expanded.add(p.path);
    this.persist();
    this.render();
    this.treeEl.querySelector(`[data-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private requestRender() {
    clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 30);
  }

  private persist() {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded])); } catch { /* sin storage */ }
  }

  // ponytail: re-render completo del árbol en cada cambio; diff por nodo si vaults enormes se ponen lentos
  private render(): void {
    const scroll = this.treeEl.scrollTop;
    this.treeEl.empty();
    this.renderChildren(this.app.vault.getRoot(), this.treeEl, 0);
    this.treeEl.scrollTop = scroll;
    this.highlightActive();
  }

  private sorted(folder: TFolder): TAbstractFile[] {
    const entries = folder.children.filter((c) => !c.name.startsWith('.')).map((file) => ({ file, name: file.name, isFolder: file instanceof TFolder }));
    return sortEntries(entries, this.order[folder.path]).map((e) => e.file);
  }

  private async saveOrder(next: ExplorerOrder): Promise<void> {
    this.order = next;
    this.requestRender();
    await this.app.writeConfig(ORDER_FILE, next);
  }

  /** Deja `file` antes o después de `target` (mismo nivel); si estaba en otra carpeta, primero lo mueve ahí. */
  private async placeNear(file: TAbstractFile, target: TAbstractFile, after: boolean): Promise<void> {
    const folder = target.parent ?? this.app.vault.getRoot();
    if (file === target || (file instanceof TFolder && (folder === file || folder.path.startsWith(`${file.path}/`)))) return;
    if (file.parent !== folder) await this.app.fileManager.moveFile(file, folder);
    const names = this.sorted(folder).map((f) => f.name);
    await this.saveOrder({ ...this.order, [folder.path]: placeName(names, file.name, target.name, after) });
  }

  private renderChildren(folder: TFolder, el: HTMLElement, depth: number) {
    for (const child of this.sorted(folder)) this.renderItem(child, el, depth);
  }

  private renderItem(file: TAbstractFile, parentEl: HTMLElement, depth: number) {
    const isFolder = file instanceof TFolder;
    const item = parentEl.createDiv(isFolder ? 'tree-item nav-folder' : 'tree-item nav-file');
    const self = item.createDiv({ cls: 'tree-item-self is-clickable', attr: { 'data-path': file.path, draggable: 'true' } });
    self.style.setProperty('--depth', String(depth));
    const open = isFolder && this.expanded.has(file.path);
    if (isFolder) {
      const icon = self.createDiv('tree-item-icon collapse-icon');
      setIcon(icon, open ? 'chevron-down' : 'chevron-right');
    }
    const name = file instanceof TFile && file.extension === 'md' ? file.basename : file.name;
    self.createDiv({ cls: 'tree-item-inner', text: name });
    if (file instanceof TFile && file.extension !== 'md') self.createDiv({ cls: 'nav-file-tag', text: file.extension });

    self.addEventListener('click', (e) => {
      if (isFolder) {
        if (open) this.expanded.delete(file.path); else this.expanded.add(file.path);
        this.persist();
        this.render();
      } else {
        void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(file as TFile);
        if (Platform.isPhone) this.app.workspace.leftSplit.collapse();
      }
    });
    onContextMenu(self, (pos) => {
      const menu = isFolder ? this.folderMenu(file as TFolder) : this.fileMenu(file as TFile);
      menu.showAtPosition(pos);
    });
    self.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, file.path);
      e.dataTransfer?.setData('text/plain', file.path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
    });
    this.setupDrop(self, () => (isFolder ? file as TFolder : file.parent ?? this.app.vault.getRoot()), file);
    if (open) this.renderChildren(file as TFolder, item.createDiv('tree-item-children'), depth + 1);
  }

  /**
   * Soltar: mover archivos del árbol, o importar archivos del sistema. Sobre un ítem, el borde de arriba o de abajo
   * lo deja antes o después (orden manual); el centro de una carpeta lo mete adentro.
   */
  private setupDrop(el: HTMLElement, target: () => TFolder, item?: TAbstractFile) {
    const MARKS = ['is-drop-target', 'is-drop-before', 'is-drop-after'];
    const clear = () => this.treeEl.querySelectorAll(MARKS.map((m) => `.${m}`).join(',')).forEach((x) => x.removeClass(...MARKS));
    const zone = (e: DragEvent): 'before' | 'after' | 'into' => {
      if (!item || !e.dataTransfer?.types.includes(DRAG_TYPE)) return 'into';
      const r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      if (item instanceof TFolder) return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
      return y < 0.5 ? 'before' : 'after';
    };
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_TYPE) ? 'move' : 'copy';
      clear();
      const z = zone(e);
      (el === this.treeEl ? el : el.closest('.tree-item-self'))?.addClass(z === 'into' ? 'is-drop-target' : `is-drop-${z}`);
    });
    el.addEventListener('dragleave', () => el.removeClass(...MARKS));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clear();
      const z = zone(e);
      const folder = target();
      const path = e.dataTransfer?.getData(DRAG_TYPE);
      if (path) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) return;
        if (item && z !== 'into') await this.placeNear(file, item, z === 'after');
        else if (file.parent !== folder) await this.app.fileManager.moveFile(file, folder);
        return;
      }
      for (const f of Array.from(e.dataTransfer?.files ?? [])) await this.app.fileManager.importFile(f, folder);
    });
  }

  collapseAll(): void { this.expanded.clear(); this.persist(); this.render(); }

  private highlightActive() {
    const active = this.app.workspace.getActiveFile();
    this.treeEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
    if (active) this.treeEl.querySelector(`[data-path="${CSS.escape(active.path)}"]`)?.addClass('is-active');
  }

  private fileMenu(file: TFile): Menu {
    const fm = this.app.fileManager;
    const ws = this.app.workspace;
    const key = (id: string) => this.app.commands.shortcut(id);
    const menu = new Menu()
      .addItem((i) => i.setTitle(t('file.openNewTab')).setIcon('file-plus').onClick(() => ws.getLeaf('tab').openFile(file)))
      .addItem((i) => i.setTitle(t('file.openRight')).setIcon('columns-2').onClick(() => ws.getLeaf('split').openFile(file)))
      .addSeparator()
      .addItem((i) => i.setTitle(t('file.rename')).setIcon('pencil').setShortcut(key('file:rename')).onClick(() => fm.promptForRename(file)))
      .addItem((i) => i.setTitle(t('file.moveTo')).setIcon('folder-input').setShortcut(key('file:move')).onClick(() => fm.promptMove(file)))
      .addItem((i) => i.setTitle(t('file.duplicate')).setIcon('copy').setShortcut(key('file:duplicate')).onClick(() => fm.duplicate(file)))
      .addItem((i) => i.setTitle(t('file.copyPath')).setIcon('clipboard').onClick(() => navigator.clipboard?.writeText(file.path)));
    if (file.extension === 'md') menu.addItem((i) => i.setTitle(t('pdf.export')).setIcon('file-down').setShortcut(key('file:export-pdf')).onClick(() => exportPdf(this.app, [file], file.basename)));
    menu.addSeparator()
      .addItem((i) => i.setTitle(t('file.delete')).setIcon('trash').setWarning(true).setShortcut(key('file:delete')).onClick(() => fm.promptForDeletion(file)));
    ws.trigger('file-menu', menu, file, 'file-explorer'); // los plugins agregan ítems (como en Obsidian)
    return menu;
  }

  private folderMenu(folder: TFolder): Menu {
    const fm = this.app.fileManager;
    const key = (id: string) => this.app.commands.shortcut(id);
    const menu = new Menu()
      .addItem((i) => i.setTitle(t('cmd.newNote')).setIcon('file-plus').setShortcut(key('file:new')).onClick(() => fm.createAndOpen(folder)))
      .addItem((i) => i.setTitle(t('cmd.newFolder')).setIcon('folder-plus').setShortcut(key('file:new-folder')).onClick(() => fm.promptNewFolder(folder)))
      .addItem((i) => i.setTitle(t('pdf.exportFolder')).setIcon('file-down').onClick(() => exportFolderPdf(this.app, folder.path, folder.isRoot() ? 'Melanite' : folder.name)));
    if (this.order[folder.path]) {
      menu.addItem((i) => i.setTitle(t('explorer.resetOrder')).setIcon('arrow-down-a-z').onClick(() => {
        const { [folder.path]: _drop, ...rest } = this.order;
        void this.saveOrder(rest);
      }));
    }
    if (!folder.isRoot()) {
      menu.addSeparator()
        .addItem((i) => i.setTitle(t('file.rename')).setIcon('pencil').onClick(() => fm.promptForRename(folder)))
        .addItem((i) => i.setTitle(t('file.moveTo')).setIcon('folder-input').onClick(() => fm.promptMove(folder)))
        .addSeparator()
        .addItem((i) => i.setTitle(t('file.delete')).setIcon('trash').setWarning(true).onClick(() => fm.promptForDeletion(folder)));
    }
    return menu;
  }
}

/** Vista para abrir imágenes en una pestaña. */
export class ImageView extends FileView {
  icon = 'image';
  getViewType() { return 'image'; }
  async onLoadFile(file: TFile) {
    this.contentEl.empty();
    this.contentEl.addClass('image-view');
    const img = this.contentEl.createEl('img');
    const { getResourceUrl } = await import('../render/renderer');
    img.src = await getResourceUrl(this.app, file);
  }
}
