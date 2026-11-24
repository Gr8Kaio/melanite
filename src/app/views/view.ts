import '../ui/dom';
import { Component } from '../../core/component';
import type { TFile } from '../../core/vault';
import type { App } from '../app';
import type { WorkspaceLeaf } from '../workspace';
import { setIcon } from '../ui/icons';
import { Menu } from '../ui/modal';
import { t } from '../i18n';

export type ViewState = Record<string, unknown>;

export abstract class View extends Component {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: HTMLDivElement;
  icon = 'file';
  /** true = vista de navegación (notas): se reemplaza al abrir otro archivo. */
  navigation = false;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = createDiv('view-container');
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;
  getIcon(): string { return this.icon; }
  getState(): ViewState { return {}; }
  async setState(_state: ViewState): Promise<void> {}
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
  /** Ítems extra para el menú "más opciones" de la vista. */
  onPaneMenu(_menu: Menu): void {}
}

/** Vista con encabezado (título + acciones) y área de contenido. */
export abstract class ItemView extends View {
  headerEl: HTMLDivElement;
  titleEl: HTMLDivElement;
  actionsEl: HTMLDivElement;
  contentEl: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.headerEl = this.containerEl.createDiv('view-header');
    this.titleEl = this.headerEl.createDiv('view-header-title');
    this.actionsEl = this.headerEl.createDiv('view-actions');
    this.contentEl = this.containerEl.createDiv('view-content');
    const more = this.actionsEl.createDiv({ cls: 'clickable-icon view-action', attr: { 'aria-label': t('view.more') } });
    setIcon(more, 'more-vertical');
    more.addEventListener('click', (e) => {
      const menu = new Menu();
      this.onPaneMenu(menu);
      this.leaf.addPaneMenuItems(menu);
      menu.showAtMouseEvent(e);
    });
  }

  addAction(icon: string, title: string, cb: (evt: MouseEvent) => unknown): HTMLElement {
    const el = createDiv({ cls: 'clickable-icon view-action', attr: { 'aria-label': title }, title });
    setIcon(el, icon);
    el.addEventListener('click', cb);
    this.actionsEl.insertBefore(el, this.actionsEl.firstChild);
    return el;
  }

  /** Refresca título del encabezado y de la pestaña. */
  updateHeader(): void {
    this.titleEl.setText(this.getDisplayText());
    this.leaf.updateHeader();
  }
}

/** Vista asociada a un archivo del vault. */
export abstract class FileView extends ItemView {
  file: TFile | null = null;
  allowNoFile = false;
  navigation = true;

  getDisplayText(): string { return this.file?.basename ?? t('view.noFile'); }
  getState(): ViewState { return { file: this.file?.path ?? null }; }

  async setState(state: ViewState): Promise<void> {
    const path = state.file as string | undefined;
    const file = path ? this.app.vault.getFileByPath(path) : null;
    if (file !== this.file && (file || this.allowNoFile)) await this.loadFile(file);
  }

  async loadFile(file: TFile | null): Promise<void> {
    if (this.file) await this.onUnloadFile(this.file);
    this.file = file;
    if (file) await this.onLoadFile(file);
    this.updateHeader();
    this.app.workspace.requestSaveLayout();
  }

  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}
  async onClose(): Promise<void> { if (this.file) await this.onUnloadFile(this.file); }

  /** Si se borra/renombra el archivo desde otro lado. */
  onRename(_file: TFile): void { this.updateHeader(); }
}

export class EmptyView extends ItemView {
  navigation = true;
  getViewType() { return 'empty'; }
  getDisplayText() { return t('view.newTab'); }
  async onOpen() {
    const wrap = this.contentEl.createDiv('empty-state');
    wrap.createDiv({ cls: 'empty-state-title', text: t('view.emptyTitle') });
    const actions = wrap.createDiv('empty-state-actions');
    const add = (label: string, cmd: string) => actions.createEl('button', { text: label }).addEventListener('click', () => this.app.commands.executeCommandById(cmd));
    add(t('cmd.newNote'), 'file:new');
    add(t('cmd.closeTab'), 'workspace:close');
  }
}
