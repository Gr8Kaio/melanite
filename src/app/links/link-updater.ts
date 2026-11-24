import { TFile, TFolder, type TAbstractFile, type Vault } from '../../core/vault';
import { parseMetadata, getLinkpath, type LinkCache } from '../../core/metadata';
import { resolveLinkpath } from '../../core/links';
import { basename, isHidden, stripExt } from '../../core/path';

/**
 * Actualización de links al renombrar/mover (sin DOM: se testea con el vault solo).
 * Antes de renombrar se anota cada link que apunta a un archivo movido (o que sale
 * de una nota movida) junto con su destino; después del renombre, los que ya no
 * resuelven a ese destino se reescriben con el linktext más corto que sí lo hace.
 */
export interface LinkRef { source: TFile; link: LinkCache; target: TFile }

/** Linktext más corto (sufijo de la ruta) que resuelve a `file` desde `sourcePath`. */
export function shortestLinktext(vault: Vault, file: TFile, sourcePath: string): string {
  const full = file.extension === 'md' ? stripExt(file.path) : file.path;
  const parts = full.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const cand = parts.slice(i).join('/');
    if (resolveLinkpath(vault, cand, sourcePath) === file) return cand;
  }
  return full;
}

export function movedFiles(file: TAbstractFile): TFile[] {
  if (file instanceof TFile) return [file];
  const out: TFile[] = [];
  const walk = (f: TFolder) => { for (const c of f.children) if (c instanceof TFile) out.push(c); else walk(c as TFolder); };
  walk(file as TFolder);
  return out;
}

const lowerName = (p: string) => basename(p).toLowerCase();

/** Links afectados por mover `moved` (se llama ANTES de renombrar). */
export function collectAffectedLinks(vault: Vault, moved: TFile[]): LinkRef[] {
  const set = new Set(moved);
  const names = new Set(moved.flatMap((f) => [f.name.toLowerCase(), f.basename.toLowerCase()]));
  const refs: LinkRef[] = [];
  for (const source of vault.getMarkdownFiles()) {
    if (isHidden(source.path)) continue;
    const srcMoved = set.has(source);
    const text = vault.cachedReadSync(source);
    if (!srcMoved && !text.includes('[') ) continue;
    const cache = parseMetadata(text);
    for (const link of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
      const path = getLinkpath(link.link);
      if (!path) continue;
      if (!srcMoved && !names.has(lowerName(path))) continue;
      const target = resolveLinkpath(vault, path, source.path);
      if (target && (srcMoved || set.has(target))) refs.push({ source, link, target });
    }
  }
  return refs;
}

const encodeMd = (s: string) => s.replace(/ /g, '%20');

/** Texto nuevo del link, o null si sigue resolviendo bien (se llama DESPUÉS de renombrar). */
export function updatedLinkText(vault: Vault, ref: LinkRef): string | null {
  const { source, link, target } = ref;
  const path = getLinkpath(link.link);
  if (resolveLinkpath(vault, path, source.path) === target) return null;
  const linktext = shortestLinktext(vault, target, source.path);
  const o = link.original;
  const wiki = /^(!?)\[\[([\s\S]*)\]\]$/.exec(o);
  if (wiki) {
    const inner = wiki[2];
    const bar = inner.indexOf('|');
    const target = bar >= 0 ? inner.slice(0, bar) : inner;
    const hash = target.indexOf('#');
    const subpath = hash >= 0 ? target.slice(hash).trim() : '';
    return `${wiki[1]}[[${linktext}${subpath}${bar >= 0 ? inner.slice(bar) : ''}]]`;
  }
  const md = /^(!?\[[^\]\n]*\]\(\s*)(<[^>\n]+>|[^)\s]+)([\s\S]*)$/.exec(o);
  if (!md) return null;
  const angle = md[2].startsWith('<');
  const url = angle ? md[2].slice(1, -1) : md[2];
  const hash = url.indexOf('#');
  const subpath = hash >= 0 ? url.slice(hash) : '';
  const withExt = target.extension === 'md' && /\.md$/i.test(hash >= 0 ? url.slice(0, hash) : url) ? `${linktext}.md` : linktext;
  const newUrl = angle ? `<${withExt}${subpath}>` : encodeMd(withExt) + subpath;
  return md[1] + newUrl + md[3];
}

/** Aplica los cambios (de atrás para adelante en cada nota). Devuelve cuántas notas cambiaron. */
export async function applyLinkUpdates(vault: Vault, refs: LinkRef[]): Promise<{ links: number; files: number }> {
  const bySource = new Map<TFile, { from: number; to: number; original: string; text: string }[]>();
  for (const ref of refs) {
    const text = updatedLinkText(vault, ref);
    if (text === null || text === ref.link.original) continue;
    const list = bySource.get(ref.source) ?? [];
    list.push({ from: ref.link.position.start.offset, to: ref.link.position.end.offset, original: ref.link.original, text });
    bySource.set(ref.source, list);
  }
  let links = 0;
  for (const [file, edits] of bySource) {
    edits.sort((a, b) => b.from - a.from);
    await vault.process(file, (data) => {
      for (const e of edits) {
        if (data.slice(e.from, e.to) !== e.original) continue; // cambió en el medio: no tocar
        data = data.slice(0, e.from) + e.text + data.slice(e.to);
        links++;
      }
      return data;
    });
  }
  return { links, files: bySource.size };
}

/** Renombra/mueve y actualiza los links entrantes (y los relativos de las notas movidas). */
export async function renameWithLinks(
  vault: Vault, file: TAbstractFile, newPath: string,
  rename: (f: TAbstractFile, p: string) => Promise<void> = (f, p) => vault.rename(f, p),
): Promise<{ links: number; files: number }> {
  const refs = collectAffectedLinks(vault, movedFiles(file));
  await rename(file, newPath);
  return applyLinkUpdates(vault, refs);
}
