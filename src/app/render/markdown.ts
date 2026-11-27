import MarkdownIt, { type StateInline, type StateBlock, type StateCore, type Token, type RendererRule } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { extname, IMAGE_EXTS } from '../../core/path';
import { parseWikilink, wikilinkDisplay } from '../../core/links';

/**
 * Markdown → HTML para el modo lectura. Las partes que necesitan el vault
 * (imágenes, embeds, links, math, mermaid) salen como marcadores que completa
 * postprocess.ts.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const embed = src.charCodeAt(state.pos) === 0x21;
  const open = embed ? state.pos + 1 : state.pos;
  if (src.charCodeAt(open) !== 0x5b || src.charCodeAt(open + 1) !== 0x5b) return false;
  const close = src.indexOf(']]', open + 2);
  if (close < 0) return false;
  const inner = src.slice(open + 2, close);
  if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return false;
  if (!silent) state.push(embed ? 'ml_embed' : 'ml_wikilink', '', 0).content = inner;
  state.pos = close + 2;
  return true;
}

function inlineMathRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const p = state.pos;
  if (src.charCodeAt(p) !== 0x24) return false;
  let start: number, end: number, display = false;
  if (src.charCodeAt(p + 1) === 0x24) {
    start = p + 2;
    end = src.indexOf('$$', start);
    if (end <= start) return false;
    display = true;
  } else {
    start = p + 1;
    if (/[\s]/.test(src[start] ?? ' ')) return false;
    end = -1;
    for (let i = start; i < state.posMax; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '$') {
        if (/\s/.test(src[i - 1]) || /\d/.test(src[i + 1] ?? '')) return false;
        end = i;
        break;
      }
    }
    if (end <= start) return false;
  }
  if (!silent) {
    const tok = state.push('ml_math', '', 0);
    tok.content = src.slice(start, end);
    tok.meta = { display };
  }
  state.pos = end + (display ? 2 : 1);
  return true;
}

function blockMathRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = lineText(startLine);
  if (!first.startsWith('$$')) return false;
  if (silent) return true;
  const rest = first.slice(2).trimEnd();
  let content: string;
  let last = startLine;
  if (rest.endsWith('$$') && rest.length > 2) content = rest.slice(0, -2);
  else {
    const lines = [rest];
    for (last = startLine + 1; last < endLine; last++) {
      const l = lineText(last).trimEnd();
      if (l.endsWith('$$')) { lines.push(l.slice(0, -2)); break; }
      lines.push(l);
    }
    if (last >= endLine) last = endLine - 1;
    content = lines.join('\n');
  }
  const tok = state.push('ml_math', '', 0);
  tok.block = true;
  tok.content = content.trim();
  tok.meta = { display: true };
  tok.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

function delimitedRule(delim: string, keep: boolean) {
  return (state: StateInline, silent: boolean): boolean => {
    if (!state.src.startsWith(delim, state.pos)) return false;
    const start = state.pos + delim.length;
    const end = state.src.indexOf(delim, start);
    if (end <= start || end > state.posMax) return false;
    if (keep && /^\s|\s$/.test(state.src.slice(start, end))) return false;
    if (!silent && keep) {
      state.push('mark_open', 'mark', 1);
      const oldMax = state.posMax;
      state.pos = start;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + delim.length;
    return true;
  };
}

const TAG_RE = /^#([\p{L}\p{N}_/\-]+)/u;
function tagRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x23) return false;
  if (state.pos > 0 && !/\s/.test(state.src[state.pos - 1])) return false;
  const m = TAG_RE.exec(state.src.slice(state.pos, state.posMax));
  if (!m || /^\d+$/.test(m[1])) return false;
  if (!silent) state.push('ml_tag', '', 0).content = m[1];
  state.pos += m[0].length;
  return true;
}

const TASK_RE = /^\[([^\]])\]\s/;
function taskRule(state: StateCore): void {
  const toks = state.tokens;
  for (let i = 2; i < toks.length; i++) {
    const inline = toks[i];
    if (inline.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
    const m = TASK_RE.exec(inline.content);
    const firstText = inline.children?.[0];
    if (!m || !firstText || firstText.type !== 'text' || !firstText.content.startsWith(m[0].trimEnd())) continue;
    firstText.content = firstText.content.slice(m[0].length - 1).replace(/^\s/, '');
    const box = new state.Token('ml_task', '', 0);
    box.content = m[1];
    box.meta = { line: toks[i - 1].map?.[0] ?? -1 };
    inline.children!.unshift(box);
    toks[i - 2].attrJoin('class', 'task-list-item');
    toks[i - 2].attrSet('data-task', m[1]);
    if (m[1] !== ' ') toks[i - 2].attrJoin('class', 'is-checked');
  }
}

// ---------------------------------------------------------------- listas estilo LaTeX (itemize / enumerate / description)

const LIST_ENV = 'itemize|enumerate|description';
const LIST_BEGIN_LINE = new RegExp(`^\\\\begin\\{(${LIST_ENV})\\}\\s*$`);
const LIST_BEGIN = new RegExp(`^\\\\begin\\{(${LIST_ENV})\\}`);
const LIST_END = new RegExp(`^\\\\end\\{(${LIST_ENV})\\}`);

function latexListRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (!LIST_BEGIN_LINE.test(lineText(startLine))) return false;
  if (silent) return true;
  let depth = 0;
  let last = endLine - 1;
  for (let l = startLine; l < endLine; l++) {
    const t = lineText(l).trim();
    if (LIST_BEGIN.test(t)) depth++;
    else if (LIST_END.test(t) && --depth === 0) { last = l; break; }
  }
  const lines: string[] = [];
  for (let l = startLine; l <= last; l++) lines.push(lineText(l));
  const tok = state.push('ml_latex_list', '', 0);
  tok.block = true;
  tok.content = lines.join('\n');
  tok.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

/** `\begin{itemize} \item …` → <ul><li>…; anida entornos y acepta `\item[etiqueta]`. */
export function latexListToHtml(src: string, inline: (s: string) => string): string {
  let html = '';
  const stack: { env: string; open: boolean }[] = [];
  const openTag = (env: string) => (env === 'enumerate' ? '<ol>' : env === 'description' ? '<dl>' : '<ul>');
  const closeTag = (env: string) => (env === 'enumerate' ? '</ol>' : env === 'description' ? '</dl>' : '</ul>');
  const closeItem = () => {
    const top = stack[stack.length - 1];
    if (top?.open) { html += top.env === 'description' ? '</dd>' : '</li>'; top.open = false; }
  };
  const ensureItem = (top: { env: string; open: boolean }) => {
    if (!top.open) { html += top.env === 'description' ? '<dd>' : '<li>'; top.open = true; }
  };
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const b = LIST_BEGIN.exec(line);
    if (b) {
      const parent = stack[stack.length - 1];
      if (parent) ensureItem(parent);
      html += openTag(b[1]);
      stack.push({ env: b[1], open: false });
      continue;
    }
    if (LIST_END.test(line)) {
      closeItem();
      const top = stack.pop();
      if (top) html += closeTag(top.env);
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top) continue;
    const item = /^\\item(?:\[([^\]]*)\])?\s*(.*)$/.exec(line);
    if (item) {
      closeItem();
      if (top.env === 'description') html += `<dt>${inline(item[1] ?? '')}</dt>`;
      ensureItem(top);
      html += inline(item[2]);
    } else {
      ensureItem(top);
      html += ` ${inline(line)}`;
    }
  }
  while (stack.length) { closeItem(); html += closeTag(stack.pop()!.env); }
  return `<div class="latex-list">${html}</div>\n`;
}

/** "300" → ancho, "x200" → solo alto, "300x200" → ancho y alto por separado (estira la imagen). */
export function parseSize(alias: string): { width?: string; height?: string } | null {
  const m = /^(\d+)?(?:x(\d+))?$/.exec(alias.trim());
  return m && (m[1] || m[2]) ? { width: m[1], height: m[2] } : null;
}

export type ImageAlign = 'center' | 'left' | 'right';
/** "desc|300|left" → alt "desc", tamaño 300, alineada a la izquierda. Por defecto, centrada. */
export function parseImageOpts(alias: string): { alt: string; width?: string; height?: string; align: ImageAlign } {
  const out: ReturnType<typeof parseImageOpts> = { alt: '', align: 'center' };
  const rest: string[] = [];
  for (const part of alias.split('|')) {
    const p = part.trim(), size = parseSize(p);
    if (size) Object.assign(out, size);
    else if (p === 'center' || p === 'left' || p === 'right') out.align = p;
    else rest.push(part);
  }
  out.alt = rest.join('|').trim();
  return out;
}

/** Atributos HTML del <img> según las opciones (tamaño y clase de alineación). */
function imageAttrs(o: ReturnType<typeof parseImageOpts>): string {
  return `${o.width ? ` width="${o.width}"` : ''}${o.height ? ` height="${o.height}"` : ''} class="ml-align-${o.align}"`;
}

export const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
md.use(footnote);
md.inline.ruler.before('link', 'ml_wikilink', wikilinkRule);
md.inline.ruler.after('escape', 'ml_math', inlineMathRule);
md.inline.ruler.before('emphasis', 'ml_highlight', delimitedRule('==', true));
md.inline.ruler.before('emphasis', 'ml_comment', delimitedRule('%%', false));
md.inline.ruler.push('ml_tag', tagRule);
md.block.ruler.before('fence', 'ml_math_block', blockMathRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.block.ruler.before('fence', 'ml_latex_list', latexListRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.core.ruler.after('inline', 'ml_tasks', taskRule);

// ---------------------------------------------------------------- títulos numerados (`## #. Título` → `## 2. Título`)

/** Marcador de título numerado: `#.` al principio del texto del título. */
export const HEADING_NUMBER_RE = /^#\.(?=\s|$)/;

/**
 * Números de los títulos marcados con `#.`, como \section/\subsection de LaTeX: el nivel más alto marcado es 1, 2, 3…
 * y los de adentro 2.1, 2.2… Los títulos sin marcador no cuentan. Devuelve null para los no marcados.
 */
export function numberHeadings(hs: { level: number; numbered: boolean }[]): (string | null)[] {
  const levels = hs.filter((h) => h.numbered).map((h) => h.level);
  const top = levels.length ? Math.min(...levels) : 0;
  const count: number[] = [];
  return hs.map((h) => {
    if (!h.numbered) return null;
    const d = h.level - top;
    count.length = d + 1;
    for (let i = 0; i < d; i++) count[i] ??= 0;
    count[d] = (count[d] ?? 0) + 1;
    return d === 0 ? `${count[0]}.` : count.join('.');
  });
}

md.core.ruler.after('inline', 'ml_heading_numbers', (state) => {
  const heads: { inline: Token; level: number; numbered: boolean }[] = [];
  state.tokens.forEach((tok, i) => {
    const inline = state.tokens[i + 1];
    if (tok.type === 'heading_open' && inline?.type === 'inline') heads.push({ inline, level: Number(tok.tag.slice(1)), numbered: HEADING_NUMBER_RE.test(inline.content) });
  });
  if (!heads.some((h) => h.numbered)) return;
  numberHeadings(heads).forEach((label, i) => {
    if (!label) return;
    const { inline } = heads[i];
    inline.content = inline.content.replace(HEADING_NUMBER_RE, label);
    const first = inline.children?.[0];
    if (first?.type === 'text') first.content = first.content.replace(HEADING_NUMBER_RE, label);
  });
});
// línea de origen de cada bloque de primer nivel (para alinear la vista previa con el editor),
// y de cada ítem de lista y fila de tabla (para que el doble click caiga en la línea justa)
md.core.ruler.push('ml_lines', (state) => {
  for (const tok of state.tokens) {
    if (!tok.map || tok.nesting !== 1) continue;
    if (tok.level === 0 || tok.type === 'list_item_open' || tok.type === 'tr_open') tok.attrSet('data-line', String(tok.map[0]));
  }
});

const r = md.renderer.rules as Record<string, RendererRule>;
r.ml_wikilink = (toks, i) => {
  const inner = toks[i].content;
  const { path, subpath } = parseWikilink(inner);
  const href = path + subpath;
  return `<a class="internal-link" data-href="${esc(href)}" href="${esc(href)}">${esc(wikilinkDisplay(inner))}</a>`;
};
r.ml_embed = (toks, i) => {
  const inner = toks[i].content;
  const { path, subpath, alias } = parseWikilink(inner);
  if (IMAGE_EXTS.includes(extname(path))) {
    const o = parseImageOpts(alias);
    return `<span class="internal-embed image-embed ml-align-${o.align}" data-src="${esc(path)}"><img data-vault-src="${esc(path)}" alt="${esc(o.alt || path)}"${imageAttrs(o)}></span>`;
  }
  return `<span class="internal-embed markdown-embed" data-src="${esc(path + subpath)}"></span>`;
};
// ![alt|300](url) y ![alt|300x200](url): tamaño al final del texto alternativo, como Obsidian
const defaultImage = md.renderer.rules.image!;
r.image = (toks, i, opts, env, self) => {
  const t = toks[i];
  const o = parseImageOpts(t.content);
  if (o.alt !== t.content) {
    t.content = o.alt;
    t.children = md.parseInline(t.content, env ?? {})[0]?.children ?? [];
  }
  if (o.width) t.attrSet('width', o.width);
  if (o.height) t.attrSet('height', o.height);
  t.attrSet('class', `ml-align-${o.align}`);
  return defaultImage(toks, i, opts, env, self);
};
r.ml_math = (toks, i) => {
  const t = toks[i];
  const display = (t.meta as { display: boolean }).display;
  const tag = t.block ? 'div' : 'span';
  return `<${tag} class="math ${display ? 'math-block' : 'math-inline'}" data-tex="${esc(t.content)}"></${tag}>${t.block ? '\n' : ''}`;
};
r.ml_latex_list = (toks, i) => latexListToHtml(toks[i].content, (s) => md.renderInline(s));
r.ml_tag = (toks, i) => `<a class="tag" data-tag="${esc(toks[i].content)}" href="#${esc(toks[i].content)}">#${esc(toks[i].content)}</a>`;
r.ml_task = (toks, i) => {
  const t = toks[i];
  return `<input type="checkbox" class="task-list-item-checkbox" data-line="${(t.meta as { line: number }).line}"${t.content === ' ' ? '' : ' checked'}>`;
};
const defaultFence = r.fence!;
r.fence = (toks, i, opts, env, self) => {
  const lang = toks[i].info.trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'mermaid') return `<div class="block-language-mermaid" data-code="${esc(toks[i].content)}"></div>`;
  if (lang && codeBlockLangs.has(lang)) return `<div class="block-language-${esc(lang)}" data-lang="${esc(lang)}" data-code="${esc(toks[i].content)}"></div>`;
  return defaultFence(toks, i, opts, env, self);
};

/** Lenguajes que tienen un code block processor registrado (los completa la app). */
export const codeBlockLangs = new Set<string>();

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Separa el frontmatter YAML: devuelve el YAML, el cuerpo y cuántas líneas ocupaba. */
export function splitFrontmatter(text: string): { yaml: string | null; body: string; lineOffset: number } {
  const m = FM_RE.exec(text);
  if (!m) return { yaml: null, body: text, lineOffset: 0 };
  return { yaml: m[1], body: text.slice(m[0].length), lineOffset: m[0].split('\n').length - 1 };
}

/** Propiedades del frontmatter que cambian cómo se ve la nota en hojas y en el PDF (no se muestran como propiedades). */
export const PAGE_KEYS = ['fontsize', 'margin', 'lineheight', 'font', 'pagenumbers'] as const;

const FONTS: Record<string, string> = {
  serif: '"Latin Modern Roman", "Computer Modern", "Times New Roman", Georgia, serif',
  sans: 'var(--font-text)',
  mono: 'var(--font-monospace)',
};

/**
 * Formato de hoja de una nota desde su frontmatter. Valores sin unidad: `fontsize` en pt, `margin` en mm.
 * Lo inválido se ignora (queda el valor por defecto).
 */
export function pageStyle(fm: unknown): { vars: Record<string, string>; numbers?: boolean } {
  const out: { vars: Record<string, string>; numbers?: boolean } = { vars: {} };
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return out;
  const f = fm as Record<string, unknown>;
  const size = (v: unknown, units: RegExp, def: string, min: number, max: number) => {
    const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/i.exec(String(v ?? '').trim());
    if (!m) return null;
    const n = Number(m[1].replace(',', '.')), unit = (m[2] || def).toLowerCase();
    return units.test(unit) && n >= min && n <= max ? `${n}${unit}` : null;
  };
  const fs = size(f.fontsize, /^(pt|px)$/, 'pt', 4, 72);
  if (fs) out.vars['--page-font-size'] = fs;
  const mg = size(f.margin, /^(mm|cm|in|pt)$/, 'mm', 0, 100);
  if (mg) out.vars['--page-margin'] = mg;
  const lh = Number(String(f.lineheight ?? '').replace(',', '.'));
  if (f.lineheight != null && lh >= 0.8 && lh <= 3) out.vars['--page-line-height'] = String(lh);
  if (typeof f.font === 'string' && f.font.trim()) {
    const name = f.font.trim();
    // una palabra clave o el nombre de una fuente instalada (solo letras, números, espacios y guiones)
    if (FONTS[name.toLowerCase()]) out.vars['--page-font'] = FONTS[name.toLowerCase()];
    else if (/^[\p{L}\p{N} -]+$/u.test(name)) out.vars['--page-font'] = `"${name}", var(--font-text)`;
  }
  if (typeof f.pagenumbers === 'boolean') out.numbers = f.pagenumbers;
  return out;
}

export function renderHtml(markdown: string): string {
  return md.render(markdown);
}

export type { Token };
