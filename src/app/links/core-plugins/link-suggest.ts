import { autocompletion, pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Plugin } from '../../../api/plugin';
import type { App } from '../../app';
import type { TFile } from '../../../core/vault';
import { isHidden } from '../../../core/path';
import { getAliases } from '../../../core/metadata';
import { lpContext } from '../../editor/live-preview';
import { fuzzyMatch } from '../fuzzy';
import { shortestLinktext } from '../link-updater';
import { t } from '../../i18n';

const LIMIT = 40;
const CODE_NODES = /^(FencedCode|CodeBlock|InlineCode|CodeText|Comment)/;

function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (CODE_NODES.test(n.name)) return true;
  }
  return false;
}

/** Reemplaza [from, to) por `text` y deja el cursor después de "]]" (lo agrega si falta). */
function applyLink(text: string, closeAfter: boolean) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const hasClose = view.state.sliceDoc(to, to + 2) === ']]';
    const insert = text + (closeAfter && !hasClose ? ']]' : '');
    const cursor = from + insert.length + (closeAfter && hasClose ? 2 : 0);
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor }, annotations: pickedCompletion.of(completion) });
  };
}

function rank<T>(items: T[], query: string, label: (x: T) => string): { item: T; score: number }[] {
  const out: { item: T; score: number }[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, label(item));
    if (m) out.push({ item, score: m.score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, LIMIT);
}

/** [[nota, [[nota#encabezado, [[nota#^bloque, [[nota|alias */
export function wikilinkSource(app: App) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^[\]\n]*$/);
    if (!before || inCode(ctx.state, before.from)) return null;
    const sourcePath = ctx.state.facet(lpContext)?.getSourcePath() ?? '';
    const start = before.from + 2;
    const query = before.text.slice(2);
    const mc = app.metadataCache;
    const resolve = (p: string): TFile | null => (p ? mc.getFirstLinkpathDest(p, sourcePath) : app.vault.getFileByPath(sourcePath));

    const bar = query.indexOf('|');
    if (bar >= 0) {
      const file = resolve(query.slice(0, bar).replace(/#.*$/, ''));
      const aliases = getAliases(file ? mc.getFileCache(file) : null);
      const q = query.slice(bar + 1);
      const options = rank(aliases, q, (a) => a).map(({ item }) => ({ label: item, type: 'text', detail: t('links.ac.alias'), apply: applyLink(item, true) }));
      return options.length ? { from: start + bar + 1, options, filter: false } : null;
    }

    const hash = query.indexOf('#');
    if (hash >= 0) {
      const file = resolve(query.slice(0, hash));
      if (!file) return null;
      const cache = mc.getFileCache(file);
      const sub = query.slice(hash + 1);
      if (sub.startsWith('^')) {
        const ids = Object.keys(cache?.blocks ?? {});
        const lines = app.vault.cachedReadSync(file).split('\n');
        const options = rank(ids, sub.slice(1), (id) => id).map(({ item }) => ({
          label: item, type: 'constant', detail: (lines[cache!.blocks![item].position.start.line] ?? '').replace(/\s*\^[\w-]+\s*$/, '').slice(0, 60),
          apply: applyLink(item, true),
        }));
        return { from: start + hash + 2, options, filter: false };
      }
      const options = rank(cache?.headings ?? [], sub, (h) => h.heading).map(({ item }) => ({
        label: item.heading, type: 'keyword', detail: 'H' + item.level, apply: applyLink(item.heading, true),
      }));
      return { from: start + hash + 1, options, filter: false };
    }

    if (!query && !ctx.explicit && ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) !== ']]') return null;
    const files = app.vault.getFiles().filter((f) => !isHidden(f.path));
    type Cand = { file: TFile; alias?: string; label: string };
    const cands: Cand[] = [];
    for (const f of files) {
      const name = f.extension === 'md' ? f.basename : f.name;
      cands.push({ file: f, label: query.includes('/') ? (f.extension === 'md' ? f.path.replace(/\.md$/, '') : f.path) : name });
      if (f.extension === 'md') for (const alias of getAliases(mc.getFileCache(f))) cands.push({ file: f, alias, label: alias });
    }
    const ranked = query
      ? rank(cands, query, (c) => c.label)
      : cands.filter((c) => !c.alias).sort((a, b) => b.file.stat.mtime - a.file.stat.mtime).slice(0, LIMIT).map((item) => ({ item }));
    const options: Completion[] = ranked.map(({ item }) => {
      const linktext = shortestLinktext(app.vault, item.file, sourcePath);
      return {
        label: item.label, type: item.alias ? 'text' : item.file.extension === 'md' ? 'variable' : 'property',
        detail: item.alias ? `→ ${item.file.basename}` : item.file.parent && !item.file.parent.isRoot() ? item.file.parent.path : undefined,
        apply: applyLink(item.alias ? `${linktext}|${item.alias}` : linktext, true),
      };
    });
    const q = query.trim();
    if (q && !files.some((f) => f.basename.toLowerCase() === q.toLowerCase() || f.name.toLowerCase() === q.toLowerCase())) {
      options.push({ label: q, type: 'keyword', detail: t('links.ac.create'), apply: applyLink(q, true) });
    }
    return { from: start, options, filter: false };
  };
}

/** #tag */
export function tagSource(app: App) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/(?:^|\s)#[\p{L}\p{N}_/-]*$/u);
    if (!before) return null;
    const at = before.from + before.text.indexOf('#');
    const query = ctx.state.sliceDoc(at + 1, ctx.pos);
    if ((!query && !ctx.explicit) || inCode(ctx.state, at)) return null;
    const tags = Object.entries(app.metadataCache.getTags()).map(([tag, n]) => ({ tag: tag.slice(1), n }));
    const options = rank(tags, query, (x) => x.tag)
      .filter(({ item }) => item.tag !== query)
      .map(({ item }) => ({ label: item.tag, type: 'keyword', detail: String(item.n) }));
    return options.length ? { from: at + 1, options, filter: false } : null;
  };
}

export default class LinkSuggestPlugin extends Plugin {
  onload(): void {
    this.registerEditorExtension([
      EditorState.languageData.of(() => [{ autocomplete: wikilinkSource(this.app) }, { autocomplete: tagSource(this.app) }]),
      autocompletion({ icons: false, closeOnBlur: true, maxRenderedOptions: LIMIT }),
    ]);
  }
}
