import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { FileView, type ViewState } from './view';
import type { WorkspaceLeaf } from '../workspace';
import { TFile } from '../../core/vault';
import { Component } from '../../core/component';
import { Editor } from '../editor/editor';
import { createEditorState, editorOptions, livePreview, modeCompartment, optionsCompartment, pluginCompartment } from '../editor/setup';
import { lpContext, refreshLivePreview } from '../editor/live-preview';
import { MarkdownRenderer } from '../render/renderer';
import type { Menu } from '../ui/modal';
import { setIcon } from '../ui/icons';
import { t } from '../i18n';

export type MarkdownMode = 'source' | 'preview';
const SAVE_DELAY = 400;

export class MarkdownView extends FileView {
  icon = 'file-text';
  editor: Editor;
  cm: EditorView;
  /** 'source' = editando (live preview o fuente), 'preview' = modo lectura */
  mode: MarkdownMode = 'source';
  /** true = modo fuente (sin live preview) */
  sourceMode = false;
  sourceEl: HTMLDivElement;
  readingEl: HTMLDivElement;
  private renderedEl: HTMLDivElement;
  private renderChild: Component | null = null;
  private saveTimer = 0;
  private dirty = false;
  private lastSaved: string | null = null;
  private modeButton: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass('markdown-view');
    this.sourceEl = this.contentEl.createDiv('markdown-source-view');
    this.readingEl = this.contentEl.createDiv('markdown-reading-view');
    this.renderedEl = this.readingEl.createDiv('markdown-preview-view');
    this.cm = new EditorView({ parent: this.sourceEl, state: this.newState('') });
    this.editor = new Editor(this.cm);
    const s = this.app.settings;
    this.mode = s.defaultViewMode === 'reading' ? 'preview' : 'source';
    this.sourceMode = s.defaultViewMode === 'source';

    this.modeButton = this.addAction('book-open', t('view.toggleMode'), () => this.toggleMode());
    this.titleEl.addEventListener('click', () => { if (this.file) void this.app.fileManager.promptForRename(this.file); });

    // links internos dentro del modo lectura y de bloques renderizados del editor
    this.contentEl.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link');
      if (!a || !this.contentEl.contains(a)) return;
      e.preventDefault();
      const root = a.closest<HTMLElement>('[data-source-path]');
      void this.app.workspace.openLinkText(a.dataset.href ?? '', root?.dataset.sourcePath ?? this.file?.path ?? '', e.ctrlKey || e.metaKey ? 'tab' : false);
    });
    this.readingEl.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      if (box.matches('input.task-list-item-checkbox')) void this.toggleTaskFromReading(box);
    });
  }

  getViewType() { return 'markdown'; }

  getState(): ViewState {
    return { ...super.getState(), mode: this.mode, source: this.sourceMode };
  }

  async setState(state: ViewState): Promise<void> {
    if (state.mode === 'source' || state.mode === 'preview') this.mode = state.mode;
    if (typeof state.source === 'boolean') this.sourceMode = state.source;
    await super.setState(state);
    this.applyMode();
  }

  setEphemeralState(e: Record<string, unknown>): void {
    const subpath = typeof e.subpath === 'string' ? e.subpath : '';
    if (subpath) this.scrollToSubpath(subpath);
    if (typeof e.line === 'number') this.editor.setCursor({ line: e.line, ch: 0 });
  }

  getViewData(): string { return this.cm.state.doc.toString(); }
  setViewData(data: string, clear: boolean): void {
    if (clear) this.cm.setState(this.newState(data));
    else this.replaceDoc(data);
    if (this.mode === 'preview') void this.renderReading();
  }

  focus(): void { if (this.mode === 'source') this.cm.focus(); }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on('modify', (f: TFile) => {
      if (f !== this.file) return;
      const text = this.app.vault.cachedReadSync(f);
      // el eco de nuestro propio guardado llega tarde (IndexedDB es async): si mientras tanto se siguió escribiendo, no pisarlo
      if (text !== this.getViewData() && text !== this.lastSaved) this.replaceDoc(text);
      if (this.mode === 'preview') void this.renderReading();
    }));
    const refresh = () => this.cm.dispatch({ effects: refreshLivePreview.of(null) });
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', (f) => {
      if (f === this.file) this.leaf.detach(); else refresh();
    }));
    this.registerEvent(this.app.vault.on('rename', (f) => {
      if (f === this.file) this.onRename(f as TFile);
      refresh();
    }));
    this.registerEvent(this.app.on('settings-changed', () => this.reconfigure()));
    this.registerEvent(this.app.on('editor-extensions-changed', () => this.cm.dispatch({ effects: pluginCompartment.reconfigure(this.app.editorExtensions.slice()) })));
    this.registerDomEvent(document, 'visibilitychange', () => { if (document.hidden) void this.save(); });
    this.registerDomEvent(window, 'pagehide', () => void this.save());
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.cm.setState(this.newState(this.app.vault.cachedReadSync(file)));
    this.applyMode();
  }

  async onUnloadFile(): Promise<void> {
    await this.save();
    this.renderChild?.unload();
    this.renderChild = null;
  }

  onPaneMenu(menu: Menu): void {
    const file = this.file;
    menu.addItem((i) => i.setTitle(this.mode === 'preview' ? t('view.editMode') : t('view.readingMode')).setIcon(this.mode === 'preview' ? 'pencil' : 'book-open').onClick(() => this.toggleMode()));
    if (this.mode === 'source') {
      menu.addItem((i) => i.setTitle(this.sourceMode ? t('view.livePreview') : t('view.sourceMode')).setIcon('code').onClick(() => this.toggleSourceMode()));
    }
    if (!file) return;
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('file.rename')).setIcon('pencil').onClick(() => this.app.fileManager.promptForRename(file)));
    menu.addItem((i) => i.setTitle(t('file.copyPath')).setIcon('copy').onClick(() => navigator.clipboard?.writeText(file.path)));
    menu.addItem((i) => i.setTitle(t('file.delete')).setIcon('trash').setWarning(true).onClick(() => this.app.fileManager.promptForDeletion(file)));
    menu.addSeparator();
  }

  // ---- modos

  toggleMode(): void {
    this.mode = this.mode === 'preview' ? 'source' : 'preview';
    this.applyMode();
    this.app.workspace.requestSaveLayout();
    if (this.mode === 'source') this.cm.focus();
  }

  toggleSourceMode(): void {
    this.sourceMode = !this.sourceMode;
    this.cm.dispatch({ effects: modeCompartment.reconfigure(this.sourceMode ? [] : livePreview()) });
    this.app.workspace.requestSaveLayout();
  }

  private applyMode(): void {
    const reading = this.mode === 'preview';
    this.sourceEl.toggle(!reading);
    this.readingEl.toggle(reading);
    this.contentEl.toggleClass('is-readable-line-width', this.app.settings.readableLineLength);
    this.cm.dispatch({ effects: modeCompartment.reconfigure(this.sourceMode ? [] : livePreview()) });
    setIcon(this.modeButton, reading ? 'pencil' : 'book-open');
    this.modeButton.setAttr('aria-label', reading ? t('view.editMode') : t('view.readingMode'));
    if (reading) void this.renderReading();
  }

  private async renderReading(): Promise<void> {
    if (!this.file) return;
    const scroll = this.readingEl.scrollTop;
    this.renderChild?.unload();
    this.renderChild = this.addChild(new Component());
    const el = createDiv();
    await MarkdownRenderer.render(this.app, this.getViewData(), el, this.file.path, this.renderChild);
    this.renderedEl.empty();
    this.renderedEl.appendChild(el);
    this.readingEl.scrollTop = scroll;
  }

  private reconfigure(): void {
    const s = this.app.settings;
    this.cm.dispatch({ effects: optionsCompartment.reconfigure(editorOptions({ spellcheck: s.spellcheck, placeholder: t('editor.placeholder') })) });
    this.contentEl.toggleClass('is-readable-line-width', s.readableLineLength);
  }

  // ---- guardado

  requestSave(): void {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY);
  }

  async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (!this.dirty || !this.file) return;
    this.dirty = false;
    const file = this.file;
    if (!this.app.vault.getFileByPath(file.path)) return;
    this.lastSaved = this.getViewData();
    await this.app.vault.modify(file, this.lastSaved);
  }

  // ---- interno

  private newState(doc: string) {
    const s = this.app.settings;
    return createEditorState(doc, {
      live: !this.sourceMode,
      context: lpContext.of({
        app: this.app,
        component: this,
        getSourcePath: () => this.file?.path ?? '',
        openLink: (link, newLeaf) => void this.app.workspace.openLinkText(link, this.file?.path ?? '', newLeaf ? 'tab' : false),
      }),
      options: editorOptions({ spellcheck: s.spellcheck, placeholder: t('editor.placeholder') }),
      plugins: this.app.editorExtensions.slice(),
      extra: [
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            this.requestSave();
            this.app.workspace.trigger('editor-change', this.editor, this);
          } else if (u.selectionSet) this.app.workspace.trigger('editor-selection-change', this.editor, this);
        }),
        EditorView.domEventHandlers({
          paste: (e) => this.handleFiles(e, e.clipboardData?.files),
          drop: (e) => this.handleFiles(e, e.dataTransfer?.files),
        }),
      ],
    });
  }

  /** Reemplaza el texto conservando el cursor: solo cambia el tramo que difiere. */
  private replaceDoc(text: string): void {
    const old = this.getViewData();
    let start = 0;
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    let endOld = old.length, endNew = text.length;
    while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) { endOld--; endNew--; }
    this.cm.dispatch({ changes: { from: start, to: endOld, insert: text.slice(start, endNew) } });
    this.dirty = false;
  }

  private handleFiles(e: Event, files: FileList | undefined | null): boolean {
    if (!files?.length || !this.file) return false;
    e.preventDefault();
    const pos = e instanceof DragEvent ? this.cm.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.cm.state.selection.main.head : this.cm.state.selection.main.head;
    void this.insertAttachments(Array.from(files), pos);
    return true;
  }

  async insertAttachments(files: File[], pos = this.cm.state.selection.main.head): Promise<void> {
    if (!this.file) return;
    const links: string[] = [];
    for (const f of files) {
      const saved = await this.app.fileManager.saveAttachment(f, this.file.path);
      links.push(this.app.fileManager.generateMarkdownLink(saved, this.file.path, true));
    }
    const insert = links.join('\n');
    this.cm.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + insert.length) });
  }

  private scrollToSubpath(subpath: string): void {
    const wanted = subpath.replace(/^#\^?/, '').trim().toLowerCase();
    const doc = this.cm.state.doc;
    for (let l = 1; l <= doc.lines; l++) {
      const line = doc.line(l);
      const isHeading = /^#{1,6}\s/.test(line.text) && line.text.replace(/^#+\s+/, '').trim().toLowerCase() === wanted;
      const isBlock = subpath.startsWith('#^') && line.text.trimEnd().endsWith(`^${wanted}`);
      if (isHeading || isBlock) {
        if (this.mode === 'source') this.cm.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
        else {
          const target = Array.from(this.renderedEl.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((h) => h.textContent?.trim().toLowerCase() === wanted);
          target?.scrollIntoView({ block: 'start' });
        }
        return;
      }
    }
  }

  private async toggleTaskFromReading(box: HTMLInputElement): Promise<void> {
    const root = box.closest<HTMLElement>('[data-line-offset]');
    const file = root ? this.app.vault.getFileByPath(root.dataset.sourcePath ?? '') : null;
    const line = Number(box.dataset.line);
    if (!root || !file || !(line >= 0)) return;
    const n = line + Number(root.dataset.lineOffset ?? 0);
    await this.app.vault.process(file, (text) => {
      const lines = text.split('\n');
      lines[n] = lines[n]?.replace(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/, (_m, a: string, c: string, b: string) => a + (c === ' ' ? 'x' : ' ') + b) ?? lines[n];
      return lines.join('\n');
    });
  }
}
