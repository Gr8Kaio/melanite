import { Plugin } from '../../../api/plugin';
import type { App } from '../../app';
import { ItemView } from '../../views/view';
import type { TFile } from '../../../core/vault';
import { parseMetadata } from '../../../core/metadata';
import { parseYaml } from '../../../core/yaml';
import { setIcon } from '../../ui/icons';
import { Notice } from '../../ui/modal';
import { emptyValue, propertyType, setFrontmatter, type PropertyType } from '../frontmatter';
import { renderEmpty } from '../results';
import { debounced, flushEditors, ensureSidePanel } from '../util';
import { t } from '../../i18n';

export const PROPERTIES_VIEW = 'file-properties';

const TYPE_ICONS: Record<PropertyType, string> = { text: 'text', number: 'binary', checkbox: 'square-check', date: 'calendar', datetime: 'clock', list: 'list' };

/** Cambia el frontmatter de la nota (lee el texto actual, no el caché). */
export async function updateFrontmatter(app: App, file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<boolean> {
  await flushEditors(app, file);
  let ok = true;
  await app.vault.process(file, (text) => {
    const cache = parseMetadata(text);
    if (cache.frontmatterPosition && !cache.frontmatter) { ok = false; return text; } // YAML roto: no pisarlo
    const fm = { ...(cache.frontmatter ?? {}) };
    fn(fm);
    return setFrontmatter(text, fm);
  });
  if (!ok) new Notice(t('props.invalidYaml'));
  return ok;
}

const display = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Editor de una propiedad según su tipo. `commit` guarda el valor nuevo. */
function valueEditor(parent: HTMLElement, key: string, value: unknown, type: PropertyType, commit: (v: unknown) => unknown): void {
  const box = parent.createDiv(`ml-prop-value mod-${type}`);
  if (type === 'checkbox') {
    const cb = box.createEl('input', { type: 'checkbox', attr: { 'aria-label': key } });
    cb.checked = value === true;
    cb.addEventListener('change', () => commit(cb.checked));
    return;
  }
  if (type === 'list') {
    const items = (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]).map(display);
    const isTags = /^tags?$/.test(key);
    for (const [i, item] of items.entries()) {
      const pill = box.createDiv('ml-prop-pill');
      pill.createSpan({ cls: isTags ? 'ml-prop-tag' : '', text: isTags ? `#${item.replace(/^#/, '')}` : item, attr: isTags ? { 'data-tag': item.replace(/^#/, '') } : undefined });
      const x = pill.createDiv({ cls: 'ml-prop-pill-remove clickable-icon', attr: { 'aria-label': t('props.removeItem', { item }) } });
      setIcon(x, 'x');
      x.addEventListener('click', () => commit(items.filter((_, j) => j !== i)));
    }
    const input = box.createEl('input', { type: 'text', cls: 'ml-prop-list-input', placeholder: t('props.addItem'), attr: { 'aria-label': t('props.addItem'), 'data-key': key, enterkeyhint: 'done' } });
    const add = () => {
      const vals = input.value.split(',').map((s) => (isTags ? s.trim().replace(/^#/, '') : s.trim())).filter(Boolean);
      if (vals.length) commit([...items, ...vals]);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
    input.addEventListener('blur', add);
    return;
  }
  const input = box.createEl('input', {
    type: { text: 'text', number: 'number', date: 'date', datetime: 'datetime-local' }[type],
    cls: 'ml-prop-input', value: type === 'datetime' ? display(value).slice(0, 16) : display(value), attr: { 'aria-label': key, 'data-key': key },
  });
  const save = () => {
    if (input.value === (type === 'datetime' ? display(value).slice(0, 16) : display(value))) return;
    commit(type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value);
  };
  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); } });
}

export class PropertiesView extends ItemView {
  icon = 'info';
  private focusKey: string | null = null;
  getViewType() { return PROPERTIES_VIEW; }
  getDisplayText() { return t('props.title'); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('ml-pane', 'ml-properties');
    const refresh = debounced(() => this.render(), 120);
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', (f: TFile) => { if (f === this.app.workspace.getActiveFile()) refresh(); }));
    this.registerDomEvent(this.contentEl, 'focusout', refresh);
    this.render();
  }

  render(): void {
    const el = this.contentEl;
    // no re-dibujar mientras se escribe en un campo de texto (perdería el foco)
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && el.contains(active) && active.type !== 'checkbox' && !active.hasClass('ml-prop-list-input')) return;
    el.empty();
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') { renderEmpty(el, t('links.noFile')); return; }
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatterPosition && !cache.frontmatter) { renderEmpty(el, t('props.invalidYaml')); return; }
    const fm = cache?.frontmatter ?? {};
    const list = el.createDiv('ml-prop-list');
    const keys = Object.keys(fm);
    if (!keys.length) renderEmpty(list, t('props.none'));
    for (const key of keys) {
      const type = propertyType(key, fm[key]);
      const row = list.createDiv({ cls: 'ml-prop-row', attr: { 'data-key': key } });
      const keyEl = row.createDiv('ml-prop-key');
      setIcon(keyEl.createDiv('ml-prop-icon'), TYPE_ICONS[type]);
      keyEl.createSpan({ text: key });
      valueEditor(row, key, fm[key], type, (v) => this.write(file, key, (o) => { o[key] = v; }));
      const del = row.createDiv({ cls: 'clickable-icon ml-prop-remove', attr: { 'aria-label': t('props.remove', { key }) } });
      setIcon(del, 'trash');
      del.addEventListener('click', () => void this.write(file, null, (o) => { delete o[key]; }));
    }
    this.addForm(el, file, fm);
    if (this.focusKey) {
      el.querySelector<HTMLInputElement>(`.ml-prop-list-input[data-key="${CSS.escape(this.focusKey)}"]`)?.focus();
      this.focusKey = null;
    }
  }

  private async write(file: TFile, focusKey: string | null, fn: (fm: Record<string, unknown>) => void): Promise<void> {
    if (focusKey && document.activeElement?.hasClass('ml-prop-list-input')) this.focusKey = focusKey;
    await updateFrontmatter(this.app, file, fn);
  }

  private addForm(el: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
    const add = el.createEl('button', { cls: 'ml-prop-add', text: t('props.add') });
    const form = el.createDiv('ml-prop-form');
    form.hide();
    const name = form.createEl('input', { type: 'text', cls: 'ml-prop-name', placeholder: t('props.name'), attr: { 'aria-label': t('props.name'), autocapitalize: 'off' } });
    const type = form.createEl('select', { cls: 'dropdown', attr: { 'aria-label': t('props.type') } });
    for (const ty of ['text', 'list', 'number', 'checkbox', 'date', 'datetime'] as PropertyType[]) type.createEl('option', { value: ty, text: t(`props.type.${ty}`) });
    const ok = form.createEl('button', { cls: 'mod-cta', text: t('props.addConfirm') });
    add.addEventListener('click', () => { form.show(); add.hide(); name.focus(); });
    const submit = () => {
      const key = name.value.trim();
      if (!key) return;
      if (key in fm) { new Notice(t('props.exists', { key })); return; }
      void this.write(file, null, (o) => { o[key] = emptyValue(type.value as PropertyType); });
    };
    ok.addEventListener('click', submit);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
  }
}

/** Propiedades arriba de la nota en modo lectura (solo lectura). */
function renderReadingProperties(el: HTMLElement, yaml: string): void {
  let fm: Record<string, unknown>;
  try { fm = parseYaml(yaml); } catch { return; }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm) || !Object.keys(fm).length) return;
  const box = createDiv('metadata-container ml-reading-props');
  for (const [key, value] of Object.entries(fm)) {
    const type = propertyType(key, value);
    const row = box.createDiv('ml-prop-row');
    const keyEl = row.createDiv('ml-prop-key');
    setIcon(keyEl.createDiv('ml-prop-icon'), TYPE_ICONS[type]);
    keyEl.createSpan({ text: key });
    const v = row.createDiv(`ml-prop-value mod-${type}`);
    if (type === 'list') {
      const isTags = /^tags?$/.test(key);
      for (const item of (Array.isArray(value) ? value : [value]).filter((x) => x !== null && x !== undefined && x !== '').map(display)) {
        const clean = item.replace(/^#/, '');
        v.createSpan({ cls: isTags ? 'ml-prop-pill ml-prop-tag' : 'ml-prop-pill', text: isTags ? `#${clean}` : item, attr: isTags ? { 'data-tag': clean } : undefined });
      }
    } else if (type === 'checkbox') {
      const cb = v.createEl('input', { type: 'checkbox', attr: { disabled: true, 'aria-label': key } });
      cb.checked = value === true;
    } else v.setText(display(value));
  }
  el.prepend(box);
}

export default class PropertiesPlugin extends Plugin {
  onload(): void {
    this.registerView(PROPERTIES_VIEW, (leaf) => new PropertiesView(leaf));
    this.addCommand({ id: 'open', name: t('props.cmd'), icon: 'info', callback: () => this.app.workspace.ensureSideLeaf(PROPERTIES_VIEW, 'right', { reveal: true }) });
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (ctx.frontmatter === null || el.hasClass('markdown-embed-content')) return;
      renderReadingProperties(el, ctx.frontmatter);
    }, -100);
    this.app.workspace.onLayoutReady(() => void ensureSidePanel(this.app, PROPERTIES_VIEW, 'right'));
  }
}
