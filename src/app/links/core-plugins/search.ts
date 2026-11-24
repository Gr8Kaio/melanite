import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { Plugin } from '../../../api/plugin';
import type { App } from '../../app';
import { ItemView, type ViewState } from '../../views/view';
import { getAllTags } from '../../../core/metadata';
import { setIcon } from '../../ui/icons';
import { findMatches, highlightTerms, matches, parseQuery } from '../search-query';
import { renderEmpty, renderFileGroup } from '../results';
import { ensureSidePanel, openAtLine } from '../util';
import { t } from '../../i18n';

export const SEARCH_VIEW = 'search';
const MAX_FILES = 200;
const MAX_LINES = 10;

/** Abre el panel de búsqueda (sidebar izquierdo) con una consulta. */
export async function openSearch(app: App, query?: string): Promise<void> {
  const leaf = await app.workspace.ensureSideLeaf(SEARCH_VIEW, 'left', { reveal: true });
  const view = leaf.view as SearchView;
  if (query !== undefined) view.setQuery(query);
  view.focusInput();
}

export class SearchView extends ItemView {
  icon = 'search';
  inputEl!: HTMLInputElement;
  private summaryEl!: HTMLDivElement;
  private resultsEl!: HTMLDivElement;
  private timer = 0;

  getViewType() { return SEARCH_VIEW; }
  getDisplayText() { return t('search.title'); }
  getState(): ViewState { return { query: this.inputEl?.value ?? '' }; }
  async setState(state: ViewState): Promise<void> {
    if (typeof state.query === 'string') this.setQuery(state.query);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('ml-pane', 'ml-search');
    const bar = this.contentEl.createDiv('ml-search-bar');
    const box = bar.createDiv('ml-search-input-container');
    setIcon(box.createDiv('ml-search-icon'), 'search');
    this.inputEl = box.createEl('input', { type: 'search', cls: 'ml-search-input', placeholder: t('search.placeholder'), attr: { 'aria-label': t('search.title'), enterkeyhint: 'search', autocapitalize: 'off', spellcheck: 'false' } });
    const clear = box.createDiv({ cls: 'clickable-icon ml-search-clear', attr: { 'aria-label': t('search.clear') } });
    setIcon(clear, 'x');
    clear.addEventListener('click', () => { this.setQuery(''); this.focusInput(); });
    const help = bar.createDiv({ cls: 'clickable-icon ml-search-help-btn', attr: { 'aria-label': t('search.help') } });
    setIcon(help, 'help-circle');
    const helpEl = this.contentEl.createDiv('ml-search-help');
    helpEl.hide();
    for (const [op, desc] of [['a b', t('search.help.and')], ['"a b"', t('search.help.phrase')], ['-a', t('search.help.not')], ['a OR b', t('search.help.or')], ['tag:#x', t('search.help.tag')], ['path:x', t('search.help.path')], ['file:x', t('search.help.file')], ['line:(a b)', t('search.help.line')]]) {
      const row = helpEl.createDiv('ml-search-help-row');
      row.createEl('code', { text: op });
      row.createSpan({ text: desc });
      row.addEventListener('click', () => { this.setQuery(`${this.inputEl.value} ${op}`.trim()); this.focusInput(); });
    }
    help.addEventListener('click', () => helpEl.toggle(helpEl.style.display === 'none'));
    this.summaryEl = this.contentEl.createDiv('ml-search-summary');
    this.resultsEl = this.contentEl.createDiv('ml-search-results');
    this.inputEl.addEventListener('input', () => this.schedule());
    this.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.run(); } });
    this.registerEvent(this.app.metadataCache.on('resolved', () => { if (this.inputEl.value.trim()) this.schedule(); }));
  }

  focusInput(): void { this.inputEl.focus(); this.inputEl.select(); }

  setQuery(q: string): void {
    this.inputEl.value = q;
    this.run();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), 200);
  }

  run(): void {
    clearTimeout(this.timer);
    this.app.workspace.requestSaveLayout();
    const q = parseQuery(this.inputEl.value);
    this.resultsEl.empty();
    this.summaryEl.empty();
    if (!q) return;
    const terms = highlightTerms(q);
    const mc = this.app.metadataCache;
    const hits: { file: ReturnType<typeof mc.getIndexedFiles>[number]; lines: ReturnType<typeof findMatches> }[] = [];
    for (const file of mc.getIndexedFiles()) {
      const text = this.app.vault.cachedReadSync(file);
      if (!matches(q, { path: file.path, name: file.basename, text, tags: getAllTags(mc.getFileCache(file)) })) continue;
      hits.push({ file, lines: findMatches(text, terms, MAX_LINES) });
    }
    hits.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
    const total = hits.reduce((n, h) => n + h.lines.length, 0);
    this.summaryEl.setText(t('search.summary', { files: hits.length, matches: total }));
    if (!hits.length) { renderEmpty(this.resultsEl, t('search.none')); return; }
    for (const { file, lines } of hits.slice(0, MAX_FILES)) {
      const newLeaf = (e: MouseEvent) => (e.ctrlKey || e.metaKey ? 'tab' : false) as 'tab' | false;
      renderFileGroup(this.resultsEl, {
        title: file.basename, path: file.path, count: lines.length || undefined,
        onTitleClick: (e) => openAtLine(this.app, file, lines[0]?.line, newLeaf(e)),
        matches: lines.map((m) => ({ text: m.text, ranges: m.ranges, onClick: (e: MouseEvent) => openAtLine(this.app, file, m.line, newLeaf(e)) })),
      });
    }
  }
}

export default class SearchPlugin extends Plugin {
  /** Igual que en Obsidian: otros plugins (bookmarks) abren la búsqueda con esto. */
  openGlobalSearch(query: string): void { void openSearch(this.app, query); }

  onload(): void {
    this.registerView(SEARCH_VIEW, (leaf) => new SearchView(leaf));
    this.addCommand({
      id: 'open', name: t('search.cmd'), icon: 'search', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }],
      callback: () => {
        const sel = this.app.getActiveMarkdownView()?.editor.getSelection();
        return openSearch(this.app, sel && !sel.includes('\n') ? sel : undefined);
      },
    });
    this.addRibbonIcon('search', t('search.cmd'), () => openSearch(this.app));
    // CodeMirror, si no tiene Shift-Mod-f, prueba Mod-f (su buscador) y se come el atajo:
    // dentro del editor, los atajos Mod+Shift de la app tienen prioridad
    this.registerEditorExtension(Prec.high(keymap.of([{
      any: (_view, e) => {
        if (!e.shiftKey || !(e.ctrlKey || e.metaKey)) return false;
        this.app.commands.handleKeydown(e);
        return e.defaultPrevented;
      },
    }])));
    this.app.workspace.onLayoutReady(() => void ensureSidePanel(this.app, SEARCH_VIEW, 'left'));
    // click en un #tag del modo lectura o de las propiedades → buscarlo
    this.registerDomEvent(document, 'click', (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('a.tag, .ml-prop-tag');
      if (!a) return;
      e.preventDefault();
      const tag = (a.dataset.tag ?? a.textContent ?? '').replace(/^#/, '');
      if (tag) void openSearch(this.app, `tag:#${tag}`);
    });
  }
}
