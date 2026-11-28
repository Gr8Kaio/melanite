import { Plugin, ItemView, Notice, TFile, setIcon, promptText, type Menu, type WorkspaceLeaf, type TAbstractFile } from '../../api';
import { t } from '../../app/i18n';

export type Bookmark =
  | { type: 'file'; path: string }
  | { type: 'heading'; path: string; subpath: string }
  | { type: 'search'; query: string };

const VIEW = 'bookmarks';
const CONFIG = 'bookmarks.json';

export const manifest = () => ({ id: 'bookmarks', name: t('plugins.bookmarks.name'), description: t('plugins.bookmarks.desc'), version: '1.0.0' });

/** Marcadores en `.melanite/bookmarks.json` (se sincroniza con el vault). */
export default class BookmarksPlugin extends Plugin {
  items: Bookmark[] = [];

  async onload() {
    const saved = await this.app.readConfig<{ items?: Bookmark[] }>(CONFIG);
    this.items = Array.isArray(saved?.items) ? saved.items : [];
    this.registerView(VIEW, (leaf) => new BookmarksView(leaf, this));

    this.addCommand({
      id: 'bookmark-current', name: t('plugins.bookmarks.addFile'), icon: 'bookmark', hotkeys: [{ modifiers: ['Alt'], key: 'b' }],
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void this.add({ type: 'file', path: file.path });
        return true;
      },
    });
    this.addCommand({
      id: 'bookmark-heading', name: t('plugins.bookmarks.addHeading'),
      editorCallback: (editor, view) => {
        for (let l = editor.getCursor().line; l >= 0; l--) {
          const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(editor.getLine(l));
          if (m && view.file) { void this.add({ type: 'heading', path: view.file.path, subpath: m[1] }); return; }
        }
        new Notice(t('plugins.bookmarks.noHeading'));
      },
    });
    this.addCommand({
      id: 'bookmark-search', name: t('plugins.bookmarks.addSearch'),
      callback: async () => {
        const query = await promptText(this.app, { title: t('plugins.bookmarks.searchPrompt') });
        if (query) await this.add({ type: 'search', query });
      },
    });

    // entrada en el menú contextual de archivos del explorador
    this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      menu.addItem((i) => i.setTitle(t('plugins.bookmarks.menu')).setIcon('bookmark').setShortcut(this.app.commands.shortcut(`${this.manifest.id}:bookmark-current`)).onClick(() => this.add({ type: 'file', path: file.path })));
    }));
    // seguir a las notas renombradas
    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      let changed = false;
      for (const b of this.items) {
        if (b.type === 'search') continue;
        if (b.path === oldPath) { b.path = file.path; changed = true; }
        else if (b.path.startsWith(`${oldPath}/`)) { b.path = file.path + b.path.slice(oldPath.length); changed = true; }
      }
      if (changed) void this.save();
    }));

    this.app.workspace.onLayoutReady(() => void this.ensureLeaf());
  }

  /** Agrega la vista al sidebar izquierdo sin sacar del frente a la pestaña que estaba. */
  private async ensureLeaf() {
    const ws = this.app.workspace;
    if (ws.getLeavesOfType(VIEW).length) return;
    const tabs = ws.leftSplit.tabs;
    const prev = tabs.activeLeaf;
    await ws.ensureSideLeaf(VIEW, 'left');
    if (prev) tabs.selectTab(prev);
  }

  async add(b: Bookmark) {
    if (this.items.some((x) => key(x) === key(b))) { new Notice(t('plugins.bookmarks.already')); return; }
    this.items.push(b);
    await this.save();
  }

  async remove(b: Bookmark) {
    this.items = this.items.filter((x) => x !== b);
    await this.save();
  }

  async save() {
    await this.app.writeConfig(CONFIG, { items: this.items });
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as BookmarksView).render();
  }

  async openBookmark(b: Bookmark, newTab: boolean) {
    if (b.type === 'search') {
      // la búsqueda es de otro módulo: si algún plugin expone openGlobalSearch (como en Obsidian), se usa
      const search = Object.values(this.app.plugins.plugins).find((p) => typeof (p as { openGlobalSearch?: unknown }).openGlobalSearch === 'function');
      if (search) (search as unknown as { openGlobalSearch(q: string): void }).openGlobalSearch(b.query);
      else new Notice(t('plugins.bookmarks.noSearch'));
      return;
    }
    const linktext = b.type === 'heading' ? `${b.path}#${b.subpath}` : b.path;
    await this.app.workspace.openLinkText(linktext, '', newTab ? 'tab' : false);
  }
}

const key = (b: Bookmark) => (b.type === 'search' ? `s:${b.query}` : b.type === 'heading' ? `h:${b.path}#${b.subpath}` : `f:${b.path}`);

class BookmarksView extends ItemView {
  icon = 'bookmark';
  private listEl!: HTMLDivElement;
  constructor(leaf: WorkspaceLeaf, private plugin: BookmarksPlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return t('plugins.bookmarks.title'); }

  async onOpen() {
    this.titleEl.setText(this.getDisplayText());
    this.listEl = this.contentEl.createDiv('bookmarks-list');
    this.render();
  }

  render() {
    if (!this.listEl) return;
    this.listEl.empty();
    if (!this.plugin.items.length) { this.listEl.createDiv({ cls: 'bookmarks-empty', text: t('plugins.bookmarks.empty') }); return; }
    for (const b of this.plugin.items) {
      const row = this.listEl.createDiv({ cls: 'tree-item-self is-clickable bookmark-item', attr: { 'data-bookmark': key(b) } });
      setIcon(row.createDiv('tree-item-icon'), b.type === 'search' ? 'search' : b.type === 'heading' ? 'hash' : 'file-text');
      const name = b.type === 'search' ? b.query : b.type === 'heading' ? `${basename(b.path)} › ${b.subpath}` : basename(b.path);
      row.createDiv({ cls: 'tree-item-inner', text: name, title: b.type === 'search' ? b.query : b.path });
      const rm = row.createDiv({ cls: 'clickable-icon bookmark-remove', attr: { 'aria-label': t('plugins.bookmarks.remove') } });
      setIcon(rm, 'x');
      rm.addEventListener('click', (e) => { e.stopPropagation(); void this.plugin.remove(b); });
      row.addEventListener('click', (e) => void this.plugin.openBookmark(b, e.ctrlKey || e.metaKey));
    }
  }
}

const basename = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');
