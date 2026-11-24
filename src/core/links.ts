import type { TFile, Vault } from './vault';
import { dirname, extname, joinPath, normalizePath, stripExt } from './path';

export interface ParsedWikilink { path: string; subpath: string; alias: string }

/** "nota#encabezado|alias" → { path: "nota", subpath: "#encabezado", alias: "alias" } */
export function parseWikilink(inner: string): ParsedWikilink {
  const bar = inner.indexOf('|');
  const target = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : '';
  const hash = target.indexOf('#');
  return {
    path: (hash >= 0 ? target.slice(0, hash) : target).trim(),
    subpath: hash >= 0 ? target.slice(hash).trim() : '',
    alias,
  };
}

/** Texto visible de un wikilink. */
export function wikilinkDisplay(inner: string): string {
  const { path, subpath, alias } = parseWikilink(inner);
  if (alias) return alias;
  if (!path) return subpath.replace(/^#\^?/, '');
  return subpath ? `${path} > ${subpath.replace(/^#\^?/, '')}` : path;
}

/**
 * Resuelve un linkpath ("nota", "carpeta/nota", "imagen.png", "../x") como Obsidian:
 * ruta exacta, ruta relativa a la nota de origen, y si no, por nombre de archivo
 * (sin distinguir mayúsculas), prefiriendo la ruta más corta.
 */
export function resolveLinkpath(vault: Vault, linkpath: string, sourcePath = ''): TFile | null {
  linkpath = linkpath.trim();
  if (!linkpath) return sourcePath ? vault.getFileByPath(sourcePath) : null;
  try { linkpath = decodeURIComponent(linkpath); } catch { /* no estaba codificado */ }
  const withMd = (p: string) => (extname(p) ? [p, `${p}.md`] : [`${p}.md`, p]);

  const candidates = [
    ...withMd(normalizePath(linkpath)),
    ...withMd(joinPath(dirname(sourcePath), linkpath)),
    ...withMd(resolveRelative(dirname(sourcePath), linkpath)),
  ];
  for (const p of candidates) {
    const f = vault.getFileByPath(p);
    if (f) return f;
  }

  const lower = linkpath.toLowerCase();
  const matches = vault.getFiles().filter((f) => {
    const p = f.path.toLowerCase();
    const keys = f.extension === 'md' ? [p, stripExt(p)] : [p];
    return keys.some((k) => k === lower || k.endsWith('/' + lower));
  });
  matches.sort((a, b) => a.path.length - b.path.length);
  return matches[0] ?? null;
}

function resolveRelative(base: string, rel: string): string {
  const out = base ? base.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

/** Linktext más corto que resuelve de forma única a `file` (para insertar links). */
export function fileToLinktext(vault: Vault, file: TFile, sourcePath = ''): string {
  const name = file.extension === 'md' ? file.basename : file.name;
  return resolveLinkpath(vault, name, sourcePath) === file ? name : file.extension === 'md' ? stripExt(file.path) : file.path;
}
