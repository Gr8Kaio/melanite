import { Events } from './events';
import { TFile, TFolder, type TAbstractFile, type Vault } from './vault';
import { resolveLinkpath, fileToLinktext, parseWikilink } from './links';
import { isHidden } from './path';
import { parseYaml } from './yaml';

/**
 * CONTRATO (forma de la API de Obsidian). Lo implementa el módulo "links".
 * Posiciones: line/col desde 0, offset en caracteres desde el inicio del archivo.
 */
export interface Loc { line: number; col: number; offset: number }
export interface Pos { start: Loc; end: Loc }
export interface LinkCache { link: string; original: string; displayText?: string; position: Pos }
export interface EmbedCache extends LinkCache {}
export interface TagCache { tag: string; position: Pos }
export interface HeadingCache { heading: string; level: number; position: Pos }
export interface BlockCache { id: string; position: Pos }
export interface ListItemCache { position: Pos; parent: number; task?: string }
export interface SectionCache { type: string; position: Pos; id?: string }
export type FrontMatterCache = Record<string, unknown>;
export interface CachedMetadata {
  links?: LinkCache[];
  embeds?: EmbedCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  blocks?: Record<string, BlockCache>;
  listItems?: ListItemCache[];
  sections?: SectionCache[];
  frontmatter?: FrontMatterCache;
  frontmatterPosition?: Pos;
}

// ---------------------------------------------------------------- parser (puro)

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const WIKI_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(?:\[(.)\][ \t])?/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const blank = (s: string) => s.replace(/[^\n]/g, ' ');
function safeDecode(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

/** Convierte offsets en posiciones línea/columna. */
function locator(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const loc = (offset: number): Loc => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo, col: offset - starts[lo], offset };
  };
  return { starts, loc, pos: (a: number, b: number): Pos => ({ start: loc(a), end: loc(b) }) };
}

/**
 * Parsea una nota y devuelve su metadata (links, embeds, tags, encabezados,
 * bloques, listas, secciones y frontmatter). Ignora bloques de código, código
 * inline y comentarios %%…%%.
 */
export function parseMetadata(text: string): CachedMetadata {
  const { starts, loc, pos } = locator(text);
  const out: CachedMetadata = {};
  let masked = text;
  let bodyStart = 0;

  const fm = FM_RE.exec(text);
  if (fm) {
    bodyStart = fm[0].length;
    const end = fm[0].replace(/\r?\n$/, '').length;
    out.frontmatterPosition = pos(0, end);
    try {
      const data = parseYaml(fm[1]);
      if (data && typeof data === 'object' && !Array.isArray(data)) out.frontmatter = data as FrontMatterCache;
    } catch { /* YAML inválido: sin frontmatter */ }
    masked = blank(text.slice(0, bodyStart)) + text.slice(bodyStart);
  }

  // código en bloque: se tapa línea por línea
  const lines = masked.split('\n');
  const isCode: boolean[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]);
    if (fence) {
      isCode[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !lines[i].slice(m[0].length).trim()) fence = null;
    } else if (m && starts[i] >= bodyStart) { fence = m[1]; isCode[i] = true; }
    if (isCode[i]) lines[i] = blank(lines[i]);
  }
  masked = lines.join('\n');
  // comentarios y código inline
  masked = masked.replace(/%%[\s\S]*?%%/g, blank).replace(/(`+)([^`\n]|[^`\n][^\n]*?[^`\n])\1(?!`)/g, blank);

  // links y embeds (sobre el texto tapado; los offsets coinciden con el original)
  const links: LinkCache[] = [], embeds: EmbedCache[] = [];
  const push = (embed: boolean, l: LinkCache) => (embed ? embeds : links).push(l);
  masked = masked.replace(WIKI_RE, (m, bang: string, inner: string, offset: number) => {
    const bar = inner.indexOf('|');
    const link = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
    const alias = bar >= 0 ? inner.slice(bar + 1).trim() : '';
    push(!!bang, { link, original: m, displayText: alias || link, position: pos(offset, offset + m.length) });
    return blank(m);
  });
  masked = masked.replace(MDLINK_RE, (m, bang: string, label: string, url: string, offset: number) => {
    const raw = url.startsWith('<') ? url.slice(1, -1) : url;
    if (SCHEME_RE.test(raw) || raw.startsWith('#')) return blank(m);
    push(!!bang, { link: safeDecode(raw), original: m, displayText: label, position: pos(offset, offset + m.length) });
    return blank(m);
  });
  const byOffset = (a: LinkCache, b: LinkCache) => a.position.start.offset - b.position.start.offset;
  if (links.length) out.links = links.sort(byOffset);
  if (embeds.length) out.embeds = embeds.sort(byOffset);

  const tags: TagCache[] = [];
  for (const m of masked.matchAll(TAG_RE)) {
    if (/^\d+$/.test(m[2])) continue;
    const at = m.index! + m[1].length;
    tags.push({ tag: `#${m[2]}`, position: pos(at, at + m[2].length + 1) });
  }
  if (tags.length) out.tags = tags;

  // estructura línea por línea
  const headings: HeadingCache[] = [];
  const blocks: Record<string, BlockCache> = {};
  const listItems: ListItemCache[] = [];
  const sections: SectionCache[] = [];
  const mlines = masked.split('\n');
  const olines = text.split('\n');
  const lineEnd = (i: number) => starts[i] + olines[i].length;
  const st: { cur: SectionCache | null } = { cur: null };
  const open = (type: string, i: number) => { st.cur = { type, position: pos(starts[i], lineEnd(i)) }; sections.push(st.cur); };
  const extend = (i: number) => { if (st.cur) st.cur.position.end = loc(lineEnd(i)); };
  let listStack: { indent: number; line: number }[] = [];
  let listFirst = -1;

  if (out.frontmatterPosition) sections.push({ type: 'yaml', position: out.frontmatterPosition });
  const firstBody = fm ? (fm[0].endsWith('\n') ? loc(bodyStart).line : olines.length) : 0;
  for (let i = firstBody; i < olines.length; i++) {
    const o = olines[i], m = mlines[i];
    const curType = st.cur?.type;
    if (isCode[i]) {
      if (curType === 'code') extend(i); else open('code', i);
      continue;
    }
    if (curType === 'code') st.cur = null;
    if (!o.trim()) { st.cur = null; listStack = []; listFirst = -1; continue; }
    const h = HEADING_RE.exec(m);
    if (h) {
      headings.push({ heading: HEADING_RE.exec(o)![2].trim(), level: h[1].length, position: pos(starts[i], lineEnd(i)) });
      open('heading', i);
      st.cur = null;
      continue;
    }
    const li = LIST_RE.exec(m);
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(m)) {
      open('thematicBreak', i);
      st.cur = null;
      continue;
    } else if (li) {
      const indent = li[1].replace(/\t/g, '    ').length;
      if (curType !== 'list') { open('list', i); listStack = []; listFirst = i; } else extend(i);
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      const parent = listStack.length ? listStack[listStack.length - 1].line : -listFirst;
      const item: ListItemCache = { position: pos(starts[i] + li[1].length, lineEnd(i)), parent };
      if (li[3] !== undefined) item.task = li[3];
      listItems.push(item);
      listStack.push({ indent, line: i });
    } else if (/^\s*>/.test(m)) {
      if (curType === 'blockquote' || curType === 'callout') extend(i);
      else open(/^\s*>\s*\[!/.test(o) ? 'callout' : 'blockquote', i);
    } else if (/^\s*\|/.test(m)) {
      if (curType === 'table') extend(i); else open('table', i);
    } else if (curType) {
      // continuación (párrafo, o línea dentro de un ítem de lista / cita)
      extend(i);
      if (curType === 'list') listItems[listItems.length - 1].position.end = loc(lineEnd(i));
    } else open('paragraph', i);

    const b = BLOCK_ID_RE.exec(m);
    if (b && st.cur) {
      const isList = st.cur.type === 'list';
      blocks[b[1]] = { id: b[1], position: isList ? listItems[listItems.length - 1].position : st.cur.position };
      if (!isList) st.cur.id = b[1];
    }
  }
  if (headings.length) out.headings = headings;
  if (Object.keys(blocks).length) out.blocks = blocks;
  if (listItems.length) out.listItems = listItems;
  if (sections.length) out.sections = sections;
  return out;
}

const toTag = (s: string) => (s.startsWith('#') ? s : `#${s}`);

/** Valores de una propiedad tipo lista del frontmatter ("a, b" o [a, b]). */
export function frontmatterList(fm: FrontMatterCache | undefined, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = fm?.[k];
    if (typeof v === 'string') out.push(...v.split(k.startsWith('tag') ? /[,\s]+/ : /,/));
    else if (Array.isArray(v)) out.push(...v.filter((x) => x !== null && x !== undefined).map(String));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Tags del frontmatter y del texto ("#tag"), con repetidos. */
export function getAllTags(cache: CachedMetadata | null): string[] {
  if (!cache) return [];
  return [...frontmatterList(cache.frontmatter, 'tags', 'tag').map(toTag), ...(cache.tags ?? []).map((t) => t.tag)];
}

/** Alias del frontmatter (aliases / alias). */
export function getAliases(cache: CachedMetadata | null): string[] {
  return frontmatterList(cache?.frontmatter, 'aliases', 'alias');
}

/** "nota#h|x" → "nota" (también para links markdown ya decodificados). */
export const getLinkpath = (link: string) => parseWikilink(link).path;

// ---------------------------------------------------------------- índice

const MODIFY_DELAY = 250;
const RESOLVE_DELAY = 50;
const indexable = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === 'md' && !isHidden(f.path);

/**
 * Índice de metadata de las notas. Eventos:
 *  - changed(file, data, cache): se reindexó un archivo
 *  - deleted(file, prevCache)
 *  - resolved(): terminó la indexación inicial / se recalcularon los links
 */
export class MetadataCache extends Events {
  vault: Vault;
  /** origen → destino → cantidad de links (solo destinos que existen) */
  resolvedLinks: Record<string, Record<string, number>> = {};
  /** origen → linkpath sin resolver → cantidad */
  unresolvedLinks: Record<string, Record<string, number>> = {};
  /** true cuando terminó la indexación inicial */
  initialized = false;
  private caches = new Map<string, CachedMetadata>();
  private pending = new Map<string, number>();
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(vault: Vault) {
    super();
    this.vault = vault;
  }

  /** Indexa todo el vault y se engancha a sus eventos. Lo llama el módulo links al arrancar. */
  initialize(): void {
    if (this.initialized) return;
    for (const f of this.vault.getMarkdownFiles()) if (indexable(f)) this.caches.set(f.id, parseMetadata(this.vault.cachedReadSync(f)));
    this.resolveAll();
    this.initialized = true;
    this.vault.on('create', (f: TAbstractFile) => { if (indexable(f)) { this.index(f); this.scheduleResolve(); } });
    this.vault.on('modify', (f: TAbstractFile) => {
      if (!indexable(f)) return;
      clearTimeout(this.pending.get(f.id));
      this.pending.set(f.id, setTimeout(() => { this.index(f); this.resolveFile(f); this.trigger('resolved'); }, MODIFY_DELAY) as unknown as number);
    });
    this.vault.on('delete', (f: TAbstractFile) => {
      if (!(f instanceof TFile)) return;
      clearTimeout(this.pending.get(f.id));
      this.pending.delete(f.id);
      const prev = this.caches.get(f.id);
      if (!prev) return;
      this.caches.delete(f.id);
      this.trigger('deleted', f, prev);
      this.scheduleResolve();
    });
    this.vault.on('rename', (f: TAbstractFile) => {
      const files = f instanceof TFolder ? this.vault.getFiles().filter((x) => x.path.startsWith(f.path + '/')) : [f as TFile];
      for (const x of files) {
        const prev = this.caches.get(x.id);
        if (x.extension === 'md' && !isHidden(x.path)) { if (!prev) this.index(x); }
        else if (prev) { this.caches.delete(x.id); this.trigger('deleted', x, prev); }
      }
      this.scheduleResolve();
    });
    this.trigger('resolved');
  }

  getFileCache(file: TFile): CachedMetadata | null {
    if (this.pending.has(file.id)) { this.index(file); this.resolveFile(file); this.scheduleResolve(); }
    return this.caches.get(file.id) ?? null;
  }
  getCache(path: string): CachedMetadata | null {
    const f = this.vault.getFileByPath(path);
    return f ? this.getFileCache(f) : null;
  }
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    return resolveLinkpath(this.vault, linkpath, sourcePath);
  }
  fileToLinktext(file: TFile, sourcePath: string): string { return fileToLinktext(this.vault, file, sourcePath); }

  /** Todas las etiquetas del vault con su cantidad ("#tag" → n). */
  getTags(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.caches.values()) for (const tag of getAllTags(c)) out[tag] = (out[tag] ?? 0) + 1;
    return out;
  }

  /** Links y embeds que apuntan a `file`, por ruta de la nota de origen. */
  getBacklinksForFile(file: TFile): Record<string, LinkCache[]> {
    const out: Record<string, LinkCache[]> = {};
    for (const [src, dests] of Object.entries(this.resolvedLinks)) {
      if (!dests[file.path]) continue;
      const cache = this.getCache(src);
      const hits = [...(cache?.links ?? []), ...(cache?.embeds ?? [])]
        .filter((l) => { const p = getLinkpath(l.link); return p && resolveLinkpath(this.vault, p, src) === file; })
        .sort((a, b) => a.position.start.offset - b.position.start.offset);
      if (hits.length) out[src] = hits;
    }
    return out;
  }

  /** Notas indexadas (las de carpetas ocultas como .trash no). */
  getIndexedFiles(): TFile[] { return this.vault.getMarkdownFiles().filter((f) => this.caches.has(f.id)); }

  // ---- interno

  private index(f: TFile): void {
    clearTimeout(this.pending.get(f.id));
    this.pending.delete(f.id);
    const data = this.vault.cachedReadSync(f);
    const cache = parseMetadata(data);
    this.caches.set(f.id, cache);
    this.trigger('changed', f, data, cache);
  }

  private scheduleResolve(): void {
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    this.resolveTimer = setTimeout(() => { this.resolveTimer = null; this.resolveAll(); this.trigger('resolved'); }, RESOLVE_DELAY);
  }

  // ponytail: recalcula todos los links ante cada alta/baja/renombre (O(links × archivos) por la resolución por nombre); índice por nombre si vaults grandes se ponen lentos
  private resolveAll(): void {
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    for (const f of this.vault.getMarkdownFiles()) if (this.caches.has(f.id)) this.resolveFile(f);
  }

  private resolveFile(f: TFile): void {
    const resolved: Record<string, number> = {}, unresolved: Record<string, number> = {};
    const cache = this.caches.get(f.id);
    for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
      const p = getLinkpath(l.link);
      if (!p) continue;
      const dest = resolveLinkpath(this.vault, p, f.path);
      if (dest) resolved[dest.path] = (resolved[dest.path] ?? 0) + 1;
      else unresolved[p] = (unresolved[p] ?? 0) + 1;
    }
    this.resolvedLinks[f.path] = resolved;
    this.unresolvedLinks[f.path] = unresolved;
  }
}
