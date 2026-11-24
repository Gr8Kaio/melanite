import './dom';
import { Modal } from './modal';
import type { App } from '../app';
import { t } from '../i18n';
export { fuzzyMatch, type FuzzyMatch } from '../links/fuzzy';

export interface Instruction { command: string; purpose: string }

/**
 * Modal de sugerencias estilo Obsidian (quick switcher, command palette…):
 * un campo de texto y una lista que se navega con flechas, Enter elige, toque
 * en el teléfono. Las subclases implementan getSuggestions/renderSuggestion/onChooseSuggestion.
 */
export abstract class SuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLDivElement;
  instructionsEl: HTMLDivElement;
  limit = 50;
  emptyStateText = t('suggest.empty');
  protected values: T[] = [];
  protected selected = 0;
  private itemEls: HTMLElement[] = [];
  private seq = 0;

  constructor(app: App) {
    super(app);
    this.modalEl.addClass('mod-suggest');
    this.inputEl = this.contentEl.createEl('input', { type: 'text', cls: 'prompt-input', attr: { enterkeyhint: 'go', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' } });
    this.resultContainerEl = this.contentEl.createDiv({ cls: 'suggestion-list prompt-results', attr: { role: 'listbox' } });
    this.instructionsEl = this.contentEl.createDiv('prompt-instructions');
    this.inputEl.addEventListener('input', () => void this.updateSuggestions());
    this.inputEl.addEventListener('keydown', (e) => this.onKey(e));
    // que tocar un ítem no le saque el foco al campo (en iOS cerraría el teclado antes del click)
    this.resultContainerEl.addEventListener('mousedown', (e) => e.preventDefault());
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): unknown;

  /** Enter sin sugerencias (o con modificadores especiales): las subclases lo pueden usar. Devuelve true si lo manejó. */
  onEnter(_evt: KeyboardEvent): boolean { return false; }

  setPlaceholder(text: string): this { this.inputEl.placeholder = text; return this; }

  setInstructions(list: Instruction[]): this {
    this.instructionsEl.empty();
    for (const i of list) {
      const el = this.instructionsEl.createDiv('prompt-instruction');
      el.createSpan({ cls: 'prompt-instruction-command', text: i.command });
      el.createSpan({ text: i.purpose });
    }
    return this;
  }

  onOpen(): void {
    void this.updateSuggestions();
    this.inputEl.focus();
  }

  getSelected(): T | undefined { return this.values[this.selected]; }

  async updateSuggestions(): Promise<void> {
    const seq = ++this.seq;
    const values = (await this.getSuggestions(this.inputEl.value)).slice(0, this.limit);
    if (seq !== this.seq) return;
    this.values = values;
    this.resultContainerEl.empty();
    this.itemEls = values.map((v, i) => {
      const el = this.resultContainerEl.createDiv({ cls: 'suggestion-item', attr: { role: 'option' } });
      this.renderSuggestion(v, el);
      el.addEventListener('mousemove', () => this.select(i, false));
      el.addEventListener('click', (e) => this.choose(i, e));
      return el;
    });
    if (!values.length && this.emptyStateText) this.resultContainerEl.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText });
    this.select(0, false);
  }

  private select(i: number, scroll = true): void {
    this.itemEls[this.selected]?.removeClass('is-selected');
    this.selected = Math.max(0, Math.min(i, this.values.length - 1));
    const el = this.itemEls[this.selected];
    el?.addClass('is-selected');
    if (scroll) el?.scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number, evt: MouseEvent | KeyboardEvent): void {
    const v = this.values[i];
    if (v === undefined) return;
    this.close();
    void this.onChooseSuggestion(v, evt);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (down || up) {
      e.preventDefault();
      const n = this.values.length;
      if (n) this.select((this.selected + (down ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.onEnter(e)) return;
      this.choose(this.selected, e);
    }
  }
}

/** Pinta `text` en `el` resaltando los tramos [desde, hasta). */
export function renderMatches(el: HTMLElement, text: string, ranges: [number, number][], offset = 0): void {
  let last = 0;
  for (const [a0, b0] of ranges) {
    const a = a0 - offset, b = b0 - offset;
    if (b <= 0 || a >= text.length) continue;
    const from = Math.max(a, last);
    if (from > last) el.append(text.slice(last, from));
    if (b > from) el.createSpan({ cls: 'suggestion-highlight', text: text.slice(from, b) });
    last = Math.max(last, b);
  }
  if (last < text.length) el.append(text.slice(last));
}
