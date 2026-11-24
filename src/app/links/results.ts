import '../ui/dom';
import { setIcon } from '../ui/icons';
import { renderMatches } from '../ui/suggest';

export interface ResultMatch {
  text: string;
  ranges: [number, number][];
  onClick: (evt: MouseEvent) => unknown;
  /** botón extra a la derecha (ej. "Linkear") */
  action?: { label: string; onClick: () => unknown };
}

const SNIPPET = 160;

/** Recorta líneas largas alrededor del primer resaltado. */
function snippet(text: string, ranges: [number, number][]): { text: string; offset: number } {
  if (text.length <= SNIPPET) return { text, offset: 0 };
  const first = ranges[0]?.[0] ?? 0;
  const start = Math.max(0, Math.min(first - 50, text.length - SNIPPET));
  const pre = start > 0 ? '…' : '';
  const body = text.slice(start, start + SNIPPET);
  return { text: pre + body + (start + SNIPPET < text.length ? '…' : ''), offset: start - pre.length };
}

/** Grupo "archivo + coincidencias" (lo usan búsqueda y backlinks). */
export function renderFileGroup(parent: HTMLElement, opts: {
  title: string; path?: string; count?: number; matches: ResultMatch[]; onTitleClick: (evt: MouseEvent) => unknown;
}): HTMLElement {
  const group = parent.createDiv('ml-result-file');
  const head = group.createDiv({ cls: 'ml-result-file-title tree-item-self', attr: { 'data-path': opts.path ?? null } });
  const toggle = head.createDiv({ cls: 'ml-result-collapse clickable-icon', attr: { 'aria-label': opts.title } });
  setIcon(toggle, 'chevron-down');
  head.createDiv({ cls: 'tree-item-inner', text: opts.title });
  if (opts.count !== undefined) head.createDiv({ cls: 'ml-result-count', text: String(opts.count) });
  head.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.ml-result-collapse')) {
      group.toggleClass('is-collapsed', !group.hasClass('is-collapsed'));
      return;
    }
    void opts.onTitleClick(e);
  });
  if (!opts.matches.length) { toggle.addClass('is-hidden'); return group; }
  const list = group.createDiv('ml-result-matches');
  for (const m of opts.matches) {
    const row = list.createDiv('ml-result-match');
    const s = snippet(m.text, m.ranges);
    renderMatches(row.createDiv('ml-result-match-text'), s.text, m.ranges, s.offset);
    row.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) void m.onClick(e); });
    if (m.action) {
      const btn = row.createEl('button', { cls: 'ml-result-action', text: m.action.label });
      btn.addEventListener('click', () => void m.action!.onClick());
    }
  }
  return group;
}

/** Encabezado de sección colapsable (backlinks / menciones, etc). */
export function renderSection(parent: HTMLElement, title: string, count: number | null): HTMLElement {
  const sec = parent.createDiv('ml-pane-section');
  const head = sec.createDiv('ml-pane-section-title');
  const icon = head.createDiv('ml-pane-section-icon');
  setIcon(icon, 'chevron-down');
  head.createSpan({ text: title });
  if (count !== null) head.createSpan({ cls: 'ml-result-count', text: String(count) });
  head.addEventListener('click', () => sec.toggleClass('is-collapsed', !sec.hasClass('is-collapsed')));
  return sec.createDiv('ml-pane-section-body');
}

/** Mensaje de "no hay nada". */
export function renderEmpty(parent: HTMLElement, text: string): void {
  parent.createDiv({ cls: 'ml-pane-empty', text });
}
