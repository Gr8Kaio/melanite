import '../ui/dom';
import type { App } from '../app';
import { Component } from '../../core/component';
import type { TFile } from '../../core/vault';
import { IMAGE_EXTS, extname } from '../../core/path';
import { parseWikilink, resolveLinkpath } from '../../core/links';
import { codeBlockLangs, renderHtml, splitFrontmatter } from './markdown';
import { setIcon } from '../ui/icons';
import { t } from '../i18n';

export interface MarkdownPostProcessorContext {
  sourcePath: string;
  docId: string;
  frontmatter: string | null;
  addChild(child: Component): void;
  getSectionInfo(el: HTMLElement): null;
}
export type MarkdownPostProcessor = ((el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void) & { sortOrder?: number };
export type CodeBlockProcessor = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void;

const MAX_EMBED_DEPTH = 3;

// ---------------------------------------------------------------- recursos

const resourceCache = new Map<string, { mtime: number; url: string }>();
const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', pdf: 'application/pdf' };

/** URL (blob:) para mostrar un archivo binario del vault. Se cachea por versión. */
export async function getResourceUrl(app: App, file: TFile): Promise<string> {
  const hit = resourceCache.get(file.id);
  if (hit && hit.mtime === file.stat.mtime) return hit.url;
  const data = await app.vault.readBinary(file);
  const url = URL.createObjectURL(new Blob([data], { type: MIME[file.extension] ?? 'application/octet-stream' }));
  if (hit) URL.revokeObjectURL(hit.url);
  resourceCache.set(file.id, { mtime: file.stat.mtime, url });
  return url;
}

// ---------------------------------------------------------------- math / mermaid / código

let katexP: Promise<typeof import('katex')> | null = null;
export async function renderMath(el: HTMLElement, tex: string, display: boolean): Promise<void> {
  const katex = (await (katexP ??= import('katex'))).default;
  katex.render(tex, el, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
}

let mermaidP: Promise<typeof import('mermaid')> | null = null;
let mermaidSeq = 0;
export async function renderMermaid(el: HTMLElement, code: string): Promise<void> {
  const mermaid = (await (mermaidP ??= import('mermaid'))).default;
  const dark = document.body.hasClass('theme-dark');
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
  try {
    const { svg } = await mermaid.render(`ml-mermaid-${++mermaidSeq}`, code);
    el.innerHTML = svg;
  } catch (err) {
    el.addClass('mermaid-error');
    el.setText(String((err as Error).message ?? err));
  }
}

async function highlightCodeEl(codeEl: HTMLElement, lang: string): Promise<void> {
  const [{ LanguageDescription }, { languages }, { highlightCode, classHighlighter }] = await Promise.all([
    import('@codemirror/language'), import('@codemirror/language-data'), import('@lezer/highlight'),
  ]);
  const desc = LanguageDescription.matchLanguageName(languages, lang, true);
  if (!desc) return;
  const support = desc.support ?? (await desc.load());
  const text = codeEl.textContent ?? '';
  const tree = support.language.parser.parse(text);
  const frag = document.createDocumentFragment();
  highlightCode(text, tree, classHighlighter,
    (txt, cls) => { if (cls) frag.appendChild(createSpan({ cls, text: txt })); else frag.appendChild(document.createTextNode(txt)); },
    () => frag.appendChild(document.createTextNode('\n')));
  codeEl.empty();
  codeEl.appendChild(frag);
}

// ---------------------------------------------------------------- callouts

const CALLOUT_ICONS: Record<string, string> = {
  note: 'pencil', abstract: 'clipboard', summary: 'clipboard', tldr: 'clipboard', info: 'info', todo: 'list-todo',
  tip: 'flame', hint: 'flame', important: 'flame', success: 'check', check: 'check', done: 'check',
  question: 'help-circle', help: 'help-circle', faq: 'help-circle', warning: 'alert-triangle', caution: 'alert-triangle',
  attention: 'alert-triangle', failure: 'x', fail: 'x', missing: 'x', danger: 'flame', error: 'x-circle', bug: 'bug',
  example: 'list', quote: 'quote', cite: 'quote',
};
export const calloutIcon = (type: string) => CALLOUT_ICONS[type] ?? 'pencil';
export const CALLOUT_RE = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/;

function buildCallouts(root: HTMLElement): void {
  for (const bq of Array.from(root.querySelectorAll('blockquote'))) {
    const p = bq.firstElementChild;
    const first = p?.firstChild;
    if (!p || p.tagName !== 'P' || !(first instanceof Text)) continue;
    const m = CALLOUT_RE.exec(first.data);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const fold = m[2];
    first.data = first.data.slice(m[0].length);

    const callout = createDiv({ cls: 'callout', attr: { 'data-callout': type, 'data-callout-fold': fold || null } });
    const titleEl = callout.createDiv('callout-title');
    setIcon(titleEl.createDiv('callout-icon'), calloutIcon(type));
    const titleInner = titleEl.createDiv('callout-title-inner');
    let n = p.firstChild;
    while (n && n.nodeName !== 'BR') { const next = n.nextSibling; titleInner.appendChild(n); n = next; }
    if (n) { const next = n.nextSibling; n.remove(); if (next instanceof Text) next.data = next.data.replace(/^\n/, ''); }
    if (!titleInner.textContent?.trim()) titleInner.setText(type.charAt(0).toUpperCase() + type.slice(1));

    const content = callout.createDiv('callout-content');
    if (p.childNodes.length && p.textContent?.trim()) content.appendChild(p); else p.remove();
    while (bq.firstChild) content.appendChild(bq.firstChild);
    if (!content.childNodes.length) content.remove();
    if (fold) {
      callout.addClass('is-collapsible');
      if (fold === '-') callout.addClass('is-collapsed');
      titleEl.addEventListener('click', () => callout.toggleClass('is-collapsed', !callout.hasClass('is-collapsed')));
    }
    bq.replaceWith(callout);
  }
}

// ---------------------------------------------------------------- saneado

function sanitize(root: HTMLElement): void {
  root.querySelectorAll('script, object, embed, base, meta, link').forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith('on') || ((a.name === 'href' || a.name === 'src' || a.name === 'xlink:href') && v.startsWith('javascript:'))) el.removeAttribute(a.name);
    }
  });
}

// ---------------------------------------------------------------- secciones (para embeds con #encabezado o #^bloque)

export function extractSection(text: string, subpath: string): string {
  if (!subpath) return text;
  const lines = text.split('\n');
  if (subpath.startsWith('#^')) {
    const id = subpath.slice(2);
    const i = lines.findIndex((l) => l.trimEnd().endsWith(`^${id}`));
    return i < 0 ? '' : lines[i].replace(new RegExp(`\\s*\\^${id}\\s*$`), '');
  }
  const wanted = subpath.slice(1).trim().toLowerCase();
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s+/, '').trim().toLowerCase() === wanted);
  if (start < 0) return '';
  const level = /^#+/.exec(lines[start])![0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#{1,6}\s/.test(lines[end]) && /^#+/.exec(lines[end])![0].length <= level)) end++;
  return lines.slice(start, end).join('\n');
}

// ---------------------------------------------------------------- render

export class MarkdownRenderer {
  /** Renderiza `markdown` dentro de `el` (como el modo lectura). */
  static async render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component, depth = 0): Promise<void> {
    const { yaml, body, lineOffset } = splitFrontmatter(markdown);
    el.addClass('markdown-rendered');
    el.innerHTML = renderHtml(body);
    el.dataset.sourcePath = sourcePath;
    el.dataset.lineOffset = String(lineOffset);
    sanitize(el);
    buildCallouts(el);
    for (const table of Array.from(el.querySelectorAll('table'))) {
      const wrap = createDiv('table-wrapper');
      table.replaceWith(wrap);
      wrap.appendChild(table);
    }

    const ctx: MarkdownPostProcessorContext = {
      sourcePath, docId: Math.random().toString(36).slice(2), frontmatter: yaml,
      addChild: (c) => component.addChild(c), getSectionInfo: () => null,
    };
    const jobs: Promise<unknown>[] = [];

    for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (a.hasClass('internal-link') || a.hasClass('tag') || a.closest('.footnotes, sup.footnote-ref') || a.getAttribute('href')!.startsWith('#')) continue;
      const href = a.getAttribute('href')!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.addClass('external-link'); a.target = '_blank'; a.rel = 'noopener'; }
      else { a.addClass('internal-link'); a.dataset.href = decodeURIComponent(href); }
    }
    for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
      const { path } = parseWikilink(a.dataset.href ?? '');
      if (path && !resolveLinkpath(app.vault, path, sourcePath)) a.addClass('is-unresolved');
    }

    for (const img of Array.from(el.querySelectorAll<HTMLImageElement>('img'))) {
      const link = img.dataset.vaultSrc ?? img.getAttribute('src') ?? '';
      if (/^(https?:|data:|blob:)/i.test(link)) continue;
      img.removeAttribute('src');
      const file = resolveLinkpath(app.vault, safeDecode(link), sourcePath);
      if (file) jobs.push(getResourceUrl(app, file).then((u) => { img.src = u; }));
      else img.replaceWith(createSpan({ cls: 'embed-missing', text: t('embed.missing', { name: link }) }));
    }

    for (const embed of Array.from(el.querySelectorAll<HTMLElement>('.markdown-embed[data-src]'))) {
      jobs.push(this.renderEmbed(app, embed, embed.dataset.src!, sourcePath, component, depth));
    }

    for (const m of Array.from(el.querySelectorAll<HTMLElement>('.math[data-tex]'))) {
      jobs.push(renderMath(m, m.dataset.tex!, m.hasClass('math-block')));
    }

    for (const code of Array.from(el.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'))) {
      const lang = /language-(\S+)/.exec(code.className)?.[1];
      if (lang) jobs.push(highlightCodeEl(code, lang).catch(() => {}));
    }

    for (const block of Array.from(el.querySelectorAll<HTMLElement>('.block-language-mermaid[data-code]'))) {
      jobs.push(renderMermaid(block, block.dataset.code!));
    }

    for (const block of Array.from(el.querySelectorAll<HTMLElement>('[data-lang][data-code]'))) {
      const fn = app.markdown.codeBlockProcessors.get(block.dataset.lang!);
      const code = block.dataset.code!.replace(/\n$/, '');
      delete block.dataset.code;
      if (fn) jobs.push(Promise.resolve(fn(code, block, ctx)).catch((e) => console.error('[melanite] code block processor', e)));
    }

    for (const pp of app.markdown.postProcessors) {
      jobs.push(Promise.resolve(pp(el, ctx)).catch((e) => console.error('[melanite] post processor', e)));
    }
    await Promise.all(jobs);
  }

  static async renderEmbed(app: App, el: HTMLElement, linktext: string, sourcePath: string, component: Component, depth: number): Promise<void> {
    const { path, subpath } = parseWikilink(linktext);
    const file = resolveLinkpath(app.vault, path, sourcePath);
    el.empty();
    if (!file) { el.addClass('is-unresolved'); el.setText(t('embed.missing', { name: linktext })); return; }
    if (IMAGE_EXTS.includes(extname(file.path))) {
      const img = el.createEl('img');
      img.src = await getResourceUrl(app, file);
      return;
    }
    if (depth >= MAX_EMBED_DEPTH || file.path === sourcePath && !subpath) { el.setText(linktext); return; }
    const title = el.createDiv('markdown-embed-title');
    title.createEl('a', { cls: 'internal-link', text: file.basename + (subpath ? ` › ${subpath.replace(/^#\^?/, '')}` : ''), attr: { 'data-href': linktext } });
    const content = el.createDiv('markdown-embed-content');
    const text = extractSection(await app.vault.cachedRead(file), subpath);
    await this.render(app, text, content, file.path, component, depth + 1);
  }
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Lo que guarda la app para los plugins: post-processors y procesadores de bloques de código. */
export class MarkdownRegistry {
  postProcessors: MarkdownPostProcessor[] = [];
  codeBlockProcessors = new Map<string, CodeBlockProcessor>();

  addPostProcessor(pp: MarkdownPostProcessor): () => void {
    this.postProcessors.push(pp);
    this.postProcessors.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return () => { this.postProcessors = this.postProcessors.filter((x) => x !== pp); };
  }

  addCodeBlockProcessor(lang: string, fn: CodeBlockProcessor): () => void {
    lang = lang.toLowerCase();
    this.codeBlockProcessors.set(lang, fn);
    codeBlockLangs.add(lang);
    return () => {
      if (this.codeBlockProcessors.get(lang) !== fn) return;
      this.codeBlockProcessors.delete(lang);
      codeBlockLangs.delete(lang);
    };
  }
}
