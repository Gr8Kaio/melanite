import { Plugin } from '../../../api/plugin';
import { ItemView } from '../../views/view';
import type { WorkspaceLeaf } from '../../workspace';
import type { TFile } from '../../../core/vault';
import { getAliases, type LinkCache } from '../../../core/metadata';
import { renderEmpty, renderFileGroup, renderSection } from '../results';
import { shortestLinktext } from '../link-updater';
import { debounced, flushEditors, openAtLine, ensureSidePanel } from '../util';
import { t } from '../../i18n';

export const BACKLINKS_VIEW = 'backlink';

interface Mention { line: number; text: string; from: number; to: number; offset: number }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Menciones sin linkear: el nombre de la nota (o un alias) como palabra suelta,
 * fuera de links y del frontmatter.
 */
export function findUnlinkedMentions(text: string, names: string[], skip: { from: number; to: number }[]): Mention[] {
  const words = names.filter((n) => n.trim().length > 1).map(esc).sort((a, b) => b.length - a.length);
  if (!words.length) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const out: Mention[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  // ponytail: no excluye bloques de código; usar el texto tapado de parseMetadata si molesta
  for (const m of text.matchAll(re)) {
    const from = m.index!, to = from + m[0].length;
    if (skip.some((s) => from < s.to && to > s.from)) continue;
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= from) line++;
    const end = text.indexOf('\n', lineStarts[line]);
    out.push({ line, text: text.slice(lineStarts[line], end < 0 ? text.length : end), from: from - lineStarts[line], to: to - lineStarts[line], offset: from });
  }
  return out;
}

export class BacklinksView extends ItemView {
  icon = 'link';
  private file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType() { return BACKLINKS_VIEW; }
  getDisplayText() { return t('links.backlinks'); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('ml-pane', 'ml-backlinks');
    const refresh = debounced(() => this.render(), 150);
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    this.registerEvent(this.app.metadataCache.on('resolved', refresh));
    this.render();
  }

  render(): void {
    this.file = this.app.workspace.getActiveFile();
    const el = this.contentEl;
    el.empty();
    const file = this.file;
    if (!file) { renderEmpty(el, t('links.noFile')); return; }
    const mc = this.app.metadataCache;
    const vault = this.app.vault;

    const back = mc.getBacklinksForFile(file);
    const sources = Object.keys(back).sort();
    const linked = renderSection(el, t('links.linkedMentions'), sources.reduce((n, s) => n + back[s].length, 0));
    if (!sources.length) renderEmpty(linked, t('links.noBacklinks'));
    for (const src of sources) {
      const srcFile = vault.getFileByPath(src)!;
      const lines = vault.cachedReadSync(srcFile).split('\n');
      renderFileGroup(linked, {
        title: srcFile.basename, path: src, count: back[src].length,
        onTitleClick: (e) => openAtLine(this.app, srcFile, undefined, e.ctrlKey || e.metaKey ? 'tab' : false),
        matches: back[src].map((l: LinkCache) => {
          const { start, end } = l.position;
          return {
            text: lines[start.line] ?? '',
            ranges: [[start.col, start.line === end.line ? end.col : (lines[start.line] ?? '').length]],
            onClick: (e: MouseEvent) => openAtLine(this.app, srcFile, start.line, e.ctrlKey || e.metaKey ? 'tab' : false),
          };
        }),
      });
    }

    // menciones sin linkear
    const names = [file.basename, ...getAliases(mc.getFileCache(file))];
    const groups: { src: TFile; mentions: Mention[] }[] = [];
    for (const src of mc.getIndexedFiles()) {
      if (src === file) continue;
      const cache = mc.getFileCache(src);
      const skip = [...(cache?.links ?? []), ...(cache?.embeds ?? [])].map((l) => ({ from: l.position.start.offset, to: l.position.end.offset }));
      if (cache?.frontmatterPosition) skip.push({ from: 0, to: cache.frontmatterPosition.end.offset });
      const mentions = findUnlinkedMentions(vault.cachedReadSync(src), names, skip);
      if (mentions.length) groups.push({ src, mentions });
    }
    const unlinked = renderSection(el, t('links.unlinkedMentions'), groups.reduce((n, g) => n + g.mentions.length, 0));
    if (!groups.length) renderEmpty(unlinked, t('links.noUnlinked'));
    for (const { src, mentions } of groups) {
      renderFileGroup(unlinked, {
        title: src.basename, path: src.path, count: mentions.length,
        onTitleClick: () => openAtLine(this.app, src, undefined),
        matches: mentions.map((m) => ({
          text: m.text, ranges: [[m.from, m.to]],
          onClick: () => openAtLine(this.app, src, m.line),
          action: { label: t('links.linkIt'), onClick: () => this.linkMention(src, file, m) },
        })),
      });
    }
  }

  /** Reemplaza la mención por [[nota]] (o [[nota|texto]] si el texto difiere). */
  private async linkMention(src: TFile, target: TFile, m: Mention): Promise<void> {
    await flushEditors(this.app, src);
    const linktext = shortestLinktext(this.app.vault, target, src.path);
    const len = m.to - m.from;
    await this.app.vault.process(src, (text) => {
      const word = text.slice(m.offset, m.offset + len);
      if (word.toLowerCase() !== m.text.slice(m.from, m.to).toLowerCase()) return text;
      const link = word === linktext ? `[[${word}]]` : `[[${linktext}|${word}]]`;
      return text.slice(0, m.offset) + link + text.slice(m.offset + len);
    });
  }
}

export default class BacklinksPlugin extends Plugin {
  onload(): void {
    this.registerView(BACKLINKS_VIEW, (leaf) => new BacklinksView(leaf));
    this.addCommand({ id: 'open', name: t('links.cmd.backlinks'), icon: 'link', callback: () => this.app.workspace.ensureSideLeaf(BACKLINKS_VIEW, 'right', { reveal: true }) });
    this.app.workspace.onLayoutReady(() => void ensureSidePanel(this.app, BACKLINKS_VIEW, 'right'));
  }
}
