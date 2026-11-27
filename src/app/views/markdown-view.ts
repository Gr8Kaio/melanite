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
import { DRAG_TYPE } from './explorer';
import { paginate } from '../render/pages';
import { exportPdf } from '../pdf';
import { IMAGE_EXTS } from '../../core/path';

/** 'source' = editando, 'preview' = lectura, 'split' = editor y vista previa lado a lado (como Overleaf) */
export type MarkdownMode = 'source' | 'preview' | 'split';
const SAVE_DELAY = 400;
/** ancho de `.ml-page` en app.css: 210mm (A4) a 96 dpi */
const PAGE_WIDTH = 794;
const ZOOM_KEY = 'melanite:preview-zoom';

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
  private splitButton: HTMLElement;
  private splitTimer = 0;
  private renderSeq = 0;
  private zoomLabel!: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass('markdown-view');
    this.sourceEl = this.contentEl.createDiv('markdown-source-view');
    this.addSplitResizer();
    this.readingEl = this.contentEl.createDiv('markdown-reading-view');
    this.renderedEl = this.readingEl.createDiv('markdown-preview-view');
    this.addZoomControls();
    this.cm = new EditorView({ parent: this.sourceEl, state: this.newState('') });
    this.editor = new Editor(this.cm);
    const s = this.app.settings;
    this.mode = s.defaultViewMode === 'reading' ? 'preview' : s.defaultViewMode === 'split' ? 'split' : 'source';
    this.sourceMode = s.defaultViewMode === 'source';

    this.splitButton = this.addAction('columns-2', t('view.splitMode'), () => this.toggleSplit());
    this.splitButton.addClass('mod-split');
    this.modeButton = this.addAction('book-open', t('view.toggleMode'), () => this.toggleMode());
    // lado a lado: scroll independiente; doble click en una línea lleva la vista previa ahí
    this.cm.contentDOM.addEventListener('dblclick', (e) => {
      if (this.mode !== 'split') return;
      this.scrollPreviewToLine(this.cm.posAtCoords({ x: e.clientX, y: e.clientY }, false));
    });
    // y al revés: doble click en la vista previa lleva el editor a ese bloque
    this.readingEl.addEventListener('dblclick', (e) => {
      if (this.mode !== 'split') return;
      // el elemento con línea más cercano: ítem de lista, fila de tabla o bloque
      const block = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
      const root = block?.closest<HTMLElement>('[data-line-offset]');
      if (!block || !root || !this.renderedEl.contains(root)) return;
      const n = Number(block.dataset.line) + Number(root.dataset.lineOffset ?? 0) + 1;
      const line = this.cm.state.doc.line(Math.min(Math.max(1, n), this.cm.state.doc.lines));
      this.cm.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 16 }) });
      this.cm.focus();
    });
    let pageTimer = 0;
    this.readingEl.addEventListener('load', () => { clearTimeout(pageTimer); pageTimer = window.setTimeout(() => this.repaginate(), 100); }, true);
    const ro = new ResizeObserver(() => this.fitPages());
    ro.observe(this.readingEl);
    this.register(() => ro.disconnect());
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
    if (state.mode === 'source' || state.mode === 'preview' || state.mode === 'split') this.mode = state.mode;
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
    if (this.mode !== 'source') void this.renderReading();
  }

  focus(): void { if (this.mode !== 'preview') this.cm.focus(); }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on('modify', (f: TFile) => {
      if (f !== this.file) return;
      const text = this.app.vault.cachedReadSync(f);
      // el eco de nuestro propio guardado llega tarde (IndexedDB es async): si mientras tanto se siguió escribiendo, no pisarlo
      if (text !== this.getViewData() && text !== this.lastSaved) this.replaceDoc(text);
      if (this.mode === 'preview') void this.renderReading();
      else if (this.mode === 'split') this.scheduleSplitRender();
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
    menu.addItem((i) => i.setTitle(t('view.splitMode')).setIcon('columns-2').setChecked(this.mode === 'split').onClick(() => this.toggleSplit()));
    if (this.mode === 'source') {
      menu.addItem((i) => i.setTitle(this.sourceMode ? t('view.livePreview') : t('view.sourceMode')).setIcon('code').onClick(() => this.toggleSourceMode()));
    }
    if (!file) return;
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('file.rename')).setIcon('pencil').onClick(() => this.app.fileManager.promptForRename(file)));
    menu.addItem((i) => i.setTitle(t('file.copyPath')).setIcon('copy').onClick(() => navigator.clipboard?.writeText(file.path)));
    menu.addItem((i) => i.setTitle(t('pdf.export')).setIcon('file-down').onClick(async () => { await this.save(); await exportPdf(this.app, [file], file.basename); }));
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

  /** Editor a la izquierda y vista previa a la derecha (en el teléfono, uno arriba del otro). */
  toggleSplit(): void {
    this.mode = this.mode === 'split' ? 'source' : 'split';
    this.applyMode();
    this.app.workspace.requestSaveLayout();
    this.cm.focus();
  }

  toggleSourceMode(): void {
    this.sourceMode = !this.sourceMode;
    this.cm.dispatch({ effects: modeCompartment.reconfigure(this.sourceMode ? [] : livePreview()) });
    this.app.workspace.requestSaveLayout();
  }

  private applyMode(): void {
    const reading = this.mode === 'preview';
    const split = this.mode === 'split';
    this.sourceEl.toggle(!reading);
    this.readingEl.toggle(reading || split);
    this.contentEl.toggleClass('is-split', split);
    this.contentEl.toggleClass('is-readable-line-width', this.app.settings.readableLineLength);
    // lado a lado: el editor muestra el código tal cual (la vista previa ya está al costado)
    this.cm.dispatch({ effects: modeCompartment.reconfigure(this.sourceMode || split ? [] : livePreview()) });
    setIcon(this.modeButton, reading ? 'pencil' : 'book-open');
    this.modeButton.setAttr('aria-label', reading ? t('view.editMode') : t('view.readingMode'));
    this.splitButton.toggleClass('is-active', split);
    if (reading || split) void this.renderReading();
  }

  private async renderReading(): Promise<void> {
    if (!this.file) return;
    const seq = ++this.renderSeq;
    this.renderChild?.unload();
    this.renderChild = this.addChild(new Component());
    const el = createDiv();
    await MarkdownRenderer.render(this.app, this.getViewData(), el, this.file.path, this.renderChild);
    // las imágenes entran ya decodificadas: si no, miden 0 al paginar y la hoja salta cuando cargan
    await Promise.all(Array.from(el.querySelectorAll('img'), (img) => img.decode().catch(() => {})));
    // con notas pesadas los renders se pisan (uno por tecla): solo el último toca la pantalla
    if (seq !== this.renderSeq) return;
    const scroll = this.readingEl.scrollTop;
    this.renderedEl.empty();
    if (this.mode === 'split') this.paginate(el);
    else this.renderedEl.appendChild(el);
    this.readingEl.scrollTop = scroll;
  }

  /** Vista previa lado a lado como un PDF: hojas A4 (las mismas que salen al exportar). */
  private paginate(src: HTMLElement): void {
    const scroll = this.readingEl.scrollTop;
    const pages = createDiv('ml-pages');
    this.renderedEl.empty();
    this.renderedEl.appendChild(pages);
    paginate(src, pages);
    this.fitPages();
    this.readingEl.scrollTop = scroll;
  }

  /** Las imágenes cargan después del render y cambian alturas: se vuelve a repartir. */
  private repaginate(): void {
    const bodies = Array.from(this.renderedEl.querySelectorAll<HTMLElement>(':scope > .ml-pages > .ml-page > div'));
    if (this.mode !== 'split' || !bodies.length) return;
    const src = bodies[0].cloneNode(false) as HTMLElement;
    src.append(...bodies.flatMap((b) => Array.from(b.children)));
    this.paginate(src);
  }

  /** La hoja tiene tamaño fijo; si el panel es más angosto se achica entera (como un visor de PDF), sin re-fluir el texto. */
  private fitPages(): void {
    const pages = this.renderedEl.querySelector<HTMLElement>(':scope > .ml-pages');
    const saved = Number(localStorage.getItem(ZOOM_KEY));
    const z = saved || Math.min(1, (this.readingEl.clientWidth - 32) / PAGE_WIDTH);
    if (pages) pages.style.zoom = String(z);
    this.zoomLabel.setText(`${Math.round(z * 100)}%`);
  }

  /** Zoom de la vista en hojas: - y + en pasos de 10 %, click en el porcentaje vuelve a ajustar al ancho. Queda guardado para todas las notas. */
  private addZoomControls(): void {
    const bar = this.contentEl.createDiv('ml-zoom');
    const set = (z: number | null) => {
      if (z === null) localStorage.removeItem(ZOOM_KEY);
      else localStorage.setItem(ZOOM_KEY, String(Math.min(3, Math.max(0.25, Math.round(z * 10) / 10))));
      this.fitPages();
    };
    const current = () => Number(this.renderedEl.querySelector<HTMLElement>(':scope > .ml-pages')?.style.zoom) || 1;
    const btn = (icon: string, label: string, fn: () => void) => {
      const b = bar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
      setIcon(b, icon);
      b.addEventListener('click', fn);
    };
    btn('zoom-out', t('view.zoomOut'), () => set(current() - 0.1));
    this.zoomLabel = bar.createEl('button', { cls: 'ml-zoom-label', attr: { 'aria-label': t('view.zoomFit') } });
    this.zoomLabel.addEventListener('click', () => set(null));
    btn('zoom-in', t('view.zoomIn'), () => set(current() + 0.1));
  }

  /** Barra entre editor y vista previa: arrastrarla cambia el ancho; el valor queda guardado para todas las notas. */
  private addSplitResizer(): void {
    const KEY = 'melanite:split-ratio';
    const handle = this.contentEl.createDiv('split-resizer');
    const apply = (pct: number) => this.contentEl.style.setProperty('--split-left', `${pct}%`);
    const saved = Number(localStorage.getItem(KEY));
    if (saved) apply(saved);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.addClass('is-dragging');
      const box = this.contentEl.getBoundingClientRect();
      let pct = saved;
      const move = (ev: PointerEvent) => { pct = Math.min(85, Math.max(15, ((ev.clientX - box.left) / box.width) * 100)); apply(pct); };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeClass('is-dragging');
        if (pct) localStorage.setItem(KEY, String(Math.round(pct * 10) / 10));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
    handle.addEventListener('dblclick', () => { this.contentEl.style.removeProperty('--split-left'); localStorage.removeItem(KEY); }); // doble click: mitad y mitad
  }

  private scheduleSplitRender(): void {
    clearTimeout(this.splitTimer);
    this.splitTimer = window.setTimeout(() => void this.renderReading(), 250);
  }

  /**
   * Lleva la vista previa a la línea del editor en `pos`: busca los bloques renderizados
   * que la rodean (data-line) e interpola entre ellos.
   */
  private scrollPreviewToLine(pos: number): void {
    const roots = Array.from(this.renderedEl.querySelectorAll<HTMLElement>(':scope > [data-line-offset], :scope > .ml-pages > .ml-page > [data-line-offset]'));
    if (!roots.length) return;
    const line = this.cm.state.doc.lineAt(pos).number - 1 - Number(roots[0].dataset.lineOffset ?? 0);
    const blocks = roots.flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>(':scope > [data-line]')));
    if (!blocks.length) return;
    let i = 0;
    while (i + 1 < blocks.length && Number(blocks[i + 1].dataset.line) <= line) i++;
    const a = blocks[i], b = blocks[i + 1];
    const base = this.readingEl.getBoundingClientRect().top - this.readingEl.scrollTop;
    const ya = a.getBoundingClientRect().top - base;
    let y = ya;
    if (b) {
      const la = Number(a.dataset.line), lb = Number(b.dataset.line);
      const frac = lb > la ? Math.min(1, Math.max(0, (line - la) / (lb - la))) : 0;
      y = ya + frac * (b.getBoundingClientRect().top - base - ya);
    }
    this.readingEl.scrollTop = Math.max(0, y - 16);
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
            if (this.mode === 'split') this.scheduleSplitRender();
            this.app.workspace.trigger('editor-change', this.editor, this);
          } else if (u.selectionSet) this.app.workspace.trigger('editor-selection-change', this.editor, this);
        }),
        EditorView.domEventHandlers({
          paste: (e) => this.handleFiles(e, e.clipboardData?.files),
          drop: (e) => this.handleVaultDrop(e) || this.handleFiles(e, e.dataTransfer?.files),
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

  /** Archivo arrastrado desde el explorador: escribe su link donde se soltó (`![[img.png]]` para imágenes, `[[nota]]` para el resto). */
  private handleVaultDrop(e: DragEvent): boolean {
    const file = this.app.vault.getFileByPath(e.dataTransfer?.getData(DRAG_TYPE) ?? '');
    if (!file || !this.file) return false;
    e.preventDefault();
    const pos = this.cm.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.cm.state.selection.main.head;
    const insert = this.app.fileManager.generateMarkdownLink(file, this.file.path, IMAGE_EXTS.includes(file.extension));
    this.cm.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + insert.length) });
    this.cm.focus();
    return true;
  }

  private handleFiles(e: Event,files: FileList | undefined | null): boolean {
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
    if (file === this.file) await this.save(); // si no, lo tipeado y sin guardar se pisa con el archivo viejo
    const n = line + Number(root.dataset.lineOffset ?? 0);
    await this.app.vault.process(file, (text) => {
      const lines = text.split('\n');
      lines[n] = lines[n]?.replace(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/, (_m, a: string, c: string, b: string) => a + (c === ' ' ? 'x' : ' ') + b) ?? lines[n];
      return lines.join('\n');
    });
  }
}
