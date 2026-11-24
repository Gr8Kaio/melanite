import { Events } from './events';
import type { TFile, Vault } from './vault';
import { resolveLinkpath, fileToLinktext } from './links';

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

  constructor(vault: Vault) {
    super();
    this.vault = vault;
  }

  getFileCache(_file: TFile): CachedMetadata | null { return null; }
  getCache(path: string): CachedMetadata | null {
    const f = this.vault.getFileByPath(path);
    return f ? this.getFileCache(f) : null;
  }
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    return resolveLinkpath(this.vault, linkpath, sourcePath);
  }
  fileToLinktext(file: TFile, sourcePath: string): string { return fileToLinktext(this.vault, file, sourcePath); }
  /** Todas las etiquetas del vault con su cantidad ("#tag" → n). */
  getTags(): Record<string, number> { return {}; }
}
