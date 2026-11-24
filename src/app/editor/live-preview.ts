import { Facet, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { App } from '../app';
import type { Component } from '../../core/component';
import { parseWikilink, resolveLinkpath } from '../../core/links';
import { IMAGE_EXTS, extname } from '../../core/path';
import { MarkdownRenderer, calloutIcon, getResourceUrl, renderMath } from '../render/renderer';
import { parseSize } from '../render/markdown';
import { setIcon } from '../ui/icons';

/**
 * Live preview estilo Obsidian: la sintaxis Markdown se oculta y se renderizan
 * math, imágenes, tablas, checkboxes y callouts, salvo en las líneas donde
 * está el cursor (ahí se ve el texto crudo para editarlo).
 */

export interface LivePreviewContext {
  app: App;
  component: Component;
  getSourcePath(): string;
  openLink(linktext: string, newLeaf: boolean): void;
}
export const lpContext = Facet.define<LivePreviewContext, LivePreviewContext | null>({ combine: (v) => v[0] ?? null });
/** Fuerza recalcular (por ejemplo cuando se crea la nota de un link que no existía). */
export const refreshLivePreview = StateEffect.define<null>();

const HIDE = Decoration.replace({});

function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) out.add(l);
  }
  return out;
}

// ---------------------------------------------------------------- widgets

abstract class LPWidget extends WidgetType {
  /** Click en el widget = poner el cursor ahí (revela el código), salvo links/inputs. */
  ignoreEvent(e: Event): boolean {
    if (e.type === 'mousedown') return !!(e.target as HTMLElement).closest('a, input, button, .ml-interactive');
    return true;
  }
}

class HrWidget extends LPWidget {
  eq() { return true; }
  toDOM() { return createEl('hr', 'ml-hr'); }
}

class BulletWidget extends LPWidget {
  eq() { return true; }
  toDOM() { return createSpan({ cls: 'ml-list-bullet', text: '•' }); }
}

class CheckboxWidget extends LPWidget {
  constructor(readonly checked: boolean) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked; }
  toDOM(view: EditorView) {
    const box = createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox ml-interactive' });
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const i = line.text.search(/\[.\]/);
      if (i < 0) return;
      const at = line.from + i + 1;
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
}

class CalloutIconWidget extends LPWidget {
  constructor(readonly type: string, readonly label: string) { super(); }
  eq(o: CalloutIconWidget) { return o.type === this.type && o.label === this.label; }
  toDOM() {
    const el = createSpan('ml-callout-icon');
    setIcon(el.createSpan(), calloutIcon(this.type));
    if (this.label) el.createSpan({ cls: 'ml-callout-label', text: this.label });
    return el;
  }
}

class MathWidget extends LPWidget {
  constructor(readonly tex: string, readonly display: boolean) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex && o.display === this.display; }
  toDOM() {
    const el = createEl(this.display ? 'div' : 'span', `math ${this.display ? 'math-block' : 'math-inline'} ml-math`);
    void renderMath(el, this.tex, this.display);
    return el;
  }
}

class ImageWidget extends LPWidget {
  constructor(readonly ctx: LivePreviewContext, readonly link: string, readonly alias: string) { super(); }
  eq(o: ImageWidget) { return o.link === this.link && o.alias === this.alias; }
  toDOM() {
    const wrap = createSpan('ml-image-embed');
    const img = wrap.createEl('img');
    const size = parseSize(this.alias);
    if (size?.width) img.width = Number(size.width);
    if (size?.height) img.height = Number(size.height);
    if (!size && this.alias) img.alt = this.alias;
    if (/^(https?:|data:|blob:)/i.test(this.link)) img.src = this.link;
    else {
      let path = this.link;
      try { path = decodeURIComponent(path); } catch { /* tal cual */ }
      const file = resolveLinkpath(this.ctx.app.vault, path, this.ctx.getSourcePath());
      if (file) void getResourceUrl(this.ctx.app, file).then((u) => (img.src = u));
      else wrap.setText(this.link), wrap.addClass('embed-missing');
    }
    return wrap;
  }
}

class EmbedWidget extends LPWidget {
  constructor(readonly ctx: LivePreviewContext, readonly inner: string, readonly version: number) { super(); }
  eq(o: EmbedWidget) { return o.inner === this.inner && o.version === this.version; }
  toDOM() {
    const el = createDiv('internal-embed markdown-embed ml-embed');
    void MarkdownRenderer.renderEmbed(this.ctx.app, el, this.inner, this.ctx.getSourcePath(), this.ctx.component, 0);
    return el;
  }
}

/** Bloque renderizado tal cual el modo lectura (tablas, mermaid, bloques de plugins). */
class RenderedBlockWidget extends LPWidget {
  constructor(readonly ctx: LivePreviewContext, readonly source: string) { super(); }
  eq(o: RenderedBlockWidget) { return o.source === this.source; }
  toDOM() {
    const el = createDiv('ml-rendered-block');
    void MarkdownRenderer.render(this.ctx.app, this.source, el, this.ctx.getSourcePath(), this.ctx.component, 1);
    return el;
  }
}

// ---------------------------------------------------------------- decoraciones

const CALLOUT_LINE = /^\s*>\s?\[!([^\]\s]+)\]([+-]?)\s*(.*)$/;

function build(state: EditorState, version: number): DecorationSet {
  const ctx = state.facet(lpContext);
  const doc = state.doc;
  const active = activeLines(state);
  const lineActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const rangeActive = (from: number, to: number) => {
    for (let l = doc.lineAt(from).number, end = doc.lineAt(to).number; l <= end; l++) if (active.has(l)) return true;
    return false;
  };
  const out: Range<Decoration>[] = [];
  const text = (from: number, to: number) => doc.sliceString(from, to);
  const hide = (from: number, to: number) => { if (to > from) out.push(HIDE.range(from, to)); };
  const mark = (from: number, to: number, cls: string, attributes?: Record<string, string>) => {
    if (to > from) out.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  };
  const lines = (from: number, to: number, cls: string, attributes?: Record<string, string>) => {
    for (let l = doc.lineAt(from).number, end = doc.lineAt(to).number; l <= end; l++) {
      out.push(Decoration.line({ class: cls, attributes }).range(doc.line(l).from));
    }
  };
  const replace = (from: number, to: number, widget: WidgetType) => out.push(Decoration.replace({ widget }).range(from, to));
  const block = (from: number, to: number, widget: WidgetType) =>
    out.push(Decoration.replace({ widget, block: true }).range(doc.lineAt(from).from, doc.lineAt(to).to));

  // ponytail: recorre el documento entero en cada cambio; limitar al viewport si notas muy largas se ponen lentas
  syntaxTree(state).iterate({
    enter: (n) => {
      const name = n.name;
      const node = n.node;

      if (name.startsWith('ATXHeading')) {
        lines(n.from, n.from, `ml-h ml-h${name.slice(10)}`);
        if (!lineActive(n.from)) {
          for (const m of node.getChildren('HeaderMark')) {
            if (m.from === n.from) hide(m.from, m.to + (text(m.to, m.to + 1) === ' ' ? 1 : 0));
            else hide(m.from - (text(m.from - 1, m.from) === ' ' ? 1 : 0), m.to);
          }
        }
        return;
      }
      switch (name) {
        case 'SetextHeading1': case 'SetextHeading2':
          lines(n.from, n.from, `ml-h ml-h${name.slice(-1)}`);
          return;
        case 'Emphasis': case 'StrongEmphasis': case 'Strikethrough': case 'Highlight': case 'InlineCode': {
          const markName = { Emphasis: 'EmphasisMark', StrongEmphasis: 'EmphasisMark', Strikethrough: 'StrikethroughMark', Highlight: 'HighlightMark', InlineCode: 'CodeMark' }[name];
          if (name === 'Highlight') mark(n.from, n.to, 'ml-highlight');
          if (name === 'InlineCode') mark(n.from, n.to, 'ml-inline-code');
          if (!lineActive(n.from)) for (const m of node.getChildren(markName)) hide(m.from, m.to);
          return;
        }
        case 'Comment':
          mark(n.from, n.to, 'ml-comment');
          return false;
        case 'Tag':
          mark(n.from, n.to, 'ml-tag', { 'data-tag': text(n.from + 1, n.to) });
          return false;
        case 'Link': {
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          if (marks.length < 2 || !url) return;
          const textFrom = marks[0].to, textTo = marks[1].from;
          mark(textFrom, textTo, 'ml-link', { 'data-href': text(url.from, url.to) });
          if (!lineActive(n.from)) { hide(n.from, textFrom); hide(textTo, n.to); }
          return;
        }
        case 'Autolink': {
          const url = node.getChild('URL');
          if (url) mark(url.from, url.to, 'ml-link', { 'data-href': text(url.from, url.to) });
          if (!lineActive(n.from)) for (const m of node.getChildren('LinkMark')) hide(m.from, m.to);
          return false;
        }
        case 'URL':
          if (node.parent?.name !== 'Link' && node.parent?.name !== 'Image') mark(n.from, n.to, 'ml-link', { 'data-href': text(n.from, n.to) });
          return;
        case 'Image': {
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          if (!ctx || !url || marks.length < 2 || lineActive(n.from)) return;
          const alt = text(marks[0].to, marks[1].from);
          replace(n.from, n.to, new ImageWidget(ctx, text(url.from, url.to), alt.includes('|') ? alt.slice(alt.lastIndexOf('|') + 1) : alt));
          return false;
        }
        case 'WikiLink': {
          const target = node.getChild('WikiTarget');
          if (!target) return false;
          const inner = text(target.from, target.to);
          const bar = inner.indexOf('|');
          const displayFrom = bar >= 0 ? target.from + bar + 1 : target.from;
          const { path } = parseWikilink(inner);
          const resolved = !ctx || !path || !!resolveLinkpath(ctx.app.vault, path, ctx.getSourcePath());
          mark(displayFrom, target.to, resolved ? 'ml-wikilink' : 'ml-wikilink is-unresolved', { 'data-link': bar >= 0 ? inner.slice(0, bar) : inner });
          if (!lineActive(n.from)) { hide(n.from, displayFrom); hide(target.to, n.to); }
          return false;
        }
        case 'Embed': {
          const target = node.getChild('WikiTarget');
          if (!target) return false;
          const inner = text(target.from, target.to);
          if (!ctx || lineActive(n.from)) { mark(target.from, target.to, 'ml-wikilink', { 'data-link': inner }); return false; }
          const { path, alias } = parseWikilink(inner);
          if (IMAGE_EXTS.includes(extname(path))) replace(n.from, n.to, new ImageWidget(ctx, path, alias));
          else replace(n.from, n.to, new EmbedWidget(ctx, inner, version));
          return false;
        }
        case 'Task': {
          const marker = node.getChild('TaskMarker');
          const listMark = node.parent?.getChild('ListMark');
          if (!marker) return;
          const checked = /x/i.test(text(marker.from, marker.to));
          if (checked) mark(marker.to, n.to, 'ml-task-done');
          if (listMark && !lineActive(n.from)) replace(listMark.from, marker.to, new CheckboxWidget(checked));
          return;
        }
        case 'ListMark': {
          const item = node.parent;
          if (item?.parent?.name === 'BulletList' && !item.getChild('Task') && !lineActive(n.from)) replace(n.from, n.to, new BulletWidget());
          return;
        }
        case 'Blockquote': {
          const first = doc.lineAt(n.from);
          const m = CALLOUT_LINE.exec(first.text);
          if (!m) { lines(n.from, n.to, 'ml-quote'); return; }
          const type = m[1].toLowerCase();
          lines(n.from, n.to, 'ml-callout', { 'data-callout': type });
          lines(n.from, n.from, 'ml-callout-title');
          if (!lineActive(n.from)) {
            const start = first.from + first.text.indexOf('[!');
            const label = m[3] ? '' : type.charAt(0).toUpperCase() + type.slice(1);
            replace(start, start + 2 + m[1].length + 1 + m[2].length, new CalloutIconWidget(type, label));
          }
          return;
        }
        case 'QuoteMark':
          if (!lineActive(n.from)) hide(n.from, n.to + (text(n.to, n.to + 1) === ' ' ? 1 : 0));
          return;
        case 'HorizontalRule':
          if (!lineActive(n.from)) replace(n.from, n.to, new HrWidget());
          return;
        case 'FencedCode': {
          const info = node.getChild('CodeInfo');
          const lang = info ? text(info.from, info.to).trim().toLowerCase() : '';
          if (ctx && (lang === 'mermaid' || ctx.app.markdown.codeBlockProcessors.has(lang)) && !rangeActive(n.from, n.to)) {
            block(n.from, n.to, new RenderedBlockWidget(ctx, text(n.from, n.to)));
            return false;
          }
          lines(n.from, n.to, 'ml-codeblock');
          lines(n.from, n.from, 'ml-codeblock-begin');
          lines(n.to, n.to, 'ml-codeblock-end');
          return false;
        }
        case 'InlineMath': {
          if (lineActive(n.from)) { mark(n.from, n.to, 'ml-math-src'); return false; }
          const src = text(n.from, n.to);
          const display = src.startsWith('$$');
          replace(n.from, n.to, new MathWidget(display ? src.slice(2, -2) : src.slice(1, -1), display));
          return false;
        }
        case 'BlockMath': {
          if (rangeActive(n.from, n.to)) { lines(n.from, n.to, 'ml-math-src'); return false; }
          const src = text(n.from, n.to).trim().replace(/^\$\$/, '').replace(/\$\$$/, '');
          block(n.from, n.to, new MathWidget(src.trim(), true));
          return false;
        }
        case 'Table':
          if (ctx && !rangeActive(n.from, n.to)) { block(n.from, n.to, new RenderedBlockWidget(ctx, text(n.from, n.to))); return false; }
          lines(n.from, n.to, 'ml-table-src');
          return;
        case 'Frontmatter':
          lines(n.from, n.to, 'ml-frontmatter');
          return false;
      }
      return;
    },
  });
  return Decoration.set(out, true);
}

interface LPState { deco: DecorationSet; version: number }

const lpField = StateField.define<LPState>({
  create: (s) => ({ deco: build(s, 0), version: 0 }),
  update(v, tr) {
    const refresh = tr.effects.some((e) => e.is(refreshLivePreview));
    if (!refresh && !tr.docChanged && !tr.selection && syntaxTree(tr.state) === syntaxTree(tr.startState)) return v;
    const version = v.version + (refresh ? 1 : 0);
    return { deco: build(tr.state, version), version };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.ml-wikilink, .ml-link');
    const ctx = view.state.facet(lpContext);
    if (!el || !ctx) return false;
    const line = view.state.doc.lineAt(view.posAtDOM(el)).number;
    const mod = e.ctrlKey || e.metaKey;
    if (activeLines(view.state).has(line) && !mod) return false;
    e.preventDefault();
    if (el.dataset.link !== undefined) ctx.openLink(el.dataset.link, mod);
    else if (el.dataset.href) {
      const href = el.dataset.href;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, '_blank', 'noopener');
      else ctx.openLink(decodeURIComponent(href), mod);
    }
    return true;
  },
});

export function livePreview() {
  return [lpField, linkClicks, EditorView.editorAttributes.of({ class: 'is-live-preview' })];
}
