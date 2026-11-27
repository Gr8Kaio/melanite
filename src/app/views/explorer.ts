import { ItemView, FileView } from './view';
import { TAbstractFile, TFile, TFolder } from '../../core/vault';
import { setIcon } from '../ui/icons';
import { Menu, onContextMenu } from '../ui/modal';
import { t } from '../i18n';
import { Platform } from '../platform';

export const EXPLORER_VIEW = 'file-explorer';
const EXPANDED_KEY = 'melanite:explorer-expanded';
export const DRAG_TYPE = 'application/x-melanite-path';

export class FileExplorerView extends ItemView {
  icon = 'folder';
  private treeEl!: HTMLDivElement;
  private expanded = new Set<string>();
  private renderTimer = 0;

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
    btn('chevrons-down-up', t('explorer.collapseAll'), () => { this.expanded.clear(); this.persist(); this.render(); });

    this.treeEl = this.contentEl.createDiv('nav-files-container');
    this.contentEl.addClass('file-explorer');
    this.setupDrop(this.treeEl, () => this.app.vault.getRoot());
    onContextMenu(this.treeEl, (pos, target) => {
      if ((target as HTMLElement).closest('.tree-item-self')) return;
      this.folderMenu(this.app.vault.getRoot()).showAtPosition(pos);
    });

    for (const ev of ['create', 'delete', 'rename'] as const) this.registerEvent(this.app.vault.on(ev, () => this.requestRender()));
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
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return folder.children
      .filter((c) => !c.name.startsWith('.'))
      .sort((a, b) => (a instanceof TFolder ? 0 : 1) - (b instanceof TFolder ? 0 : 1) || coll.compare(a.name, b.name));
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
    if (isFolder) {
      this.setupDrop(self, () => file as TFolder);
      if (open) this.renderChildren(file as TFolder, item.createDiv('tree-item-children'), depth + 1);
    } else {
      this.setupDrop(self, () => file.parent ?? this.app.vault.getRoot());
    }
  }

  /** Soltar: mover archivos del árbol, o importar archivos del sistema. */
  private setupDrop(el: HTMLElement, target: () => TFolder) {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_TYPE) ? 'move' : 'copy';
      this.treeEl.querySelectorAll('.is-drop-target').forEach((x) => x.removeClass('is-drop-target'));
      (el === this.treeEl ? el : el.closest('.tree-item-self'))?.addClass('is-drop-target');
    });
    el.addEventListener('dragleave', () => el.removeClass('is-drop-target'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.treeEl.querySelectorAll('.is-drop-target').forEach((x) => x.removeClass('is-drop-target'));
      const folder = target();
      const path = e.dataTransfer?.getData(DRAG_TYPE);
      if (path) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file && file.parent !== folder) await this.app.fileManager.moveFile(file, folder);
        return;
      }
      for (const f of Array.from(e.dataTransfer?.files ?? [])) await this.app.fileManager.importFile(f, folder);
    });
  }

  private highlightActive() {
    const active = this.app.workspace.getActiveFile();
    this.treeEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
    if (active) this.treeEl.querySelector(`[data-path="${CSS.escape(active.path)}"]`)?.addClass('is-active');
  }

  private fileMenu(file: TFile): Menu {
    const fm = this.app.fileManager;
    const ws = this.app.workspace;
    const menu = new Menu()
      .addItem((i) => i.setTitle(t('file.openNewTab')).setIcon('file-plus').onClick(() => ws.getLeaf('tab').openFile(file)))
      .addItem((i) => i.setTitle(t('file.openRight')).setIcon('columns-2').onClick(() => ws.getLeaf('split').openFile(file)))
      .addSeparator()
      .addItem((i) => i.setTitle(t('file.rename')).setIcon('pencil').onClick(() => fm.promptForRename(file)))
      .addItem((i) => i.setTitle(t('file.moveTo')).setIcon('folder-input').onClick(() => fm.promptMove(file)))
      .addItem((i) => i.setTitle(t('file.duplicate')).setIcon('copy').onClick(() => fm.duplicate(file)))
      .addItem((i) => i.setTitle(t('file.copyPath')).setIcon('clipboard').onClick(() => navigator.clipboard?.writeText(file.path)))
      .addSeparator()
      .addItem((i) => i.setTitle(t('file.delete')).setIcon('trash').setWarning(true).onClick(() => fm.promptForDeletion(file)));
    ws.trigger('file-menu', menu, file, 'file-explorer'); // los plugins agregan ítems (como en Obsidian)
    return menu;
  }

  private folderMenu(folder: TFolder): Menu {
    const fm = this.app.fileManager;
    const menu = new Menu()
      .addItem((i) => i.setTitle(t('cmd.newNote')).setIcon('file-plus').onClick(() => fm.createAndOpen(folder)))
      .addItem((i) => i.setTitle(t('cmd.newFolder')).setIcon('folder-plus').onClick(() => fm.promptNewFolder(folder)));
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
