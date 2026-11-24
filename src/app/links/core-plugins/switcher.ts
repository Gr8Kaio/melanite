import { Plugin } from '../../../api/plugin';
import type { App } from '../../app';
import { TFile } from '../../../core/vault';
import { isHidden } from '../../../core/path';
import { getAliases } from '../../../core/metadata';
import { SuggestModal, fuzzyMatch, renderMatches } from '../../ui/suggest';
import { isMac } from '../../commands';
import { openAtLine } from '../util';
import { t } from '../../i18n';

const RECENT_KEY = 'melanite:recent-files';
const MAX_RECENT = 50;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function saveRecent(list: string[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* sin storage */ }
}

type Item =
  | { kind: 'file'; file: TFile; alias?: string; score: number; matches: [number, number][] }
  | { kind: 'create'; name: string };

const mod = isMac ? '⌘' : 'Ctrl';

export class QuickSwitcherModal extends SuggestModal<Item> {
  constructor(app: App, private recent: string[]) {
    super(app);
    this.setPlaceholder(t('switcher.placeholder'));
    this.setInstructions([
      { command: '↑↓', purpose: t('suggest.navigate') },
      { command: '↵', purpose: t('switcher.open') },
      { command: `${mod} ↵`, purpose: t('switcher.openTab') },
      { command: '⇧ ↵', purpose: t('switcher.create') },
    ]);
    this.emptyStateText = '';
  }

  getSuggestions(query: string): Item[] {
    const files = this.app.vault.getFiles().filter((f) => !isHidden(f.path) && this.app.viewTypeForExtension(f.extension));
    const rank = new Map(this.recent.map((p, i) => [p, i]));
    const q = query.trim();
    if (!q) {
      return files
        .sort((a, b) => (rank.get(a.path) ?? 1e9) - (rank.get(b.path) ?? 1e9) || b.stat.mtime - a.stat.mtime)
        .map((file) => ({ kind: 'file', file, score: 0, matches: [] }));
    }
    const out: Item[] = [];
    const byPath = q.includes('/');
    for (const file of files) {
      const label = byPath ? this.label(file, true) : this.label(file, false);
      const recency = rank.has(file.path) ? 3 - (rank.get(file.path)! / MAX_RECENT) * 3 : 0;
      const m = fuzzyMatch(q, label);
      if (m) out.push({ kind: 'file', file, score: m.score + recency, matches: m.matches });
      if (file.extension !== 'md') continue;
      for (const alias of getAliases(this.app.metadataCache.getFileCache(file))) {
        const a = fuzzyMatch(q, alias);
        if (a) out.push({ kind: 'file', file, alias, score: a.score + recency - 0.5, matches: a.matches });
      }
    }
    out.sort((a, b) => (b as { score: number }).score - (a as { score: number }).score);
    const exact = files.some((f) => f.basename.toLowerCase() === q.toLowerCase());
    if (!exact) out.push({ kind: 'create', name: q });
    return out;
  }

  private label(file: TFile, full: boolean): string {
    const name = file.extension === 'md' ? file.basename : file.name;
    if (!full) return name;
    return file.parent && !file.parent.isRoot() ? `${file.parent.path}/${name}` : name;
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.addClass('mod-complex');
    const content = el.createDiv('suggestion-content');
    if (item.kind === 'create') {
      content.createDiv({ cls: 'suggestion-title', text: item.name });
      el.createDiv({ cls: 'suggestion-aux', text: t('switcher.createHint') });
      return;
    }
    const title = content.createDiv('suggestion-title');
    const byPath = this.inputEl.value.includes('/');
    renderMatches(title, item.alias ?? this.label(item.file, byPath), item.matches);
    const folder = item.file.parent && !item.file.parent.isRoot() ? item.file.parent.path : '';
    if (item.alias) content.createDiv({ cls: 'suggestion-note', text: `↳ ${this.label(item.file, true)}` });
    else if (folder && !byPath) content.createDiv({ cls: 'suggestion-note', text: folder });
  }

  onEnter(evt: KeyboardEvent): boolean {
    const q = this.inputEl.value.trim();
    if (!evt.shiftKey || !q) return false;
    this.close();
    void this.create(q, evt);
    return true;
  }

  async onChooseSuggestion(item: Item, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const newLeaf = evt.ctrlKey || evt.metaKey ? 'tab' : false;
    if (item.kind === 'create') return this.create(item.name, evt);
    await openAtLine(this.app, item.file, undefined, newLeaf);
  }

  private async create(name: string, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const file = await this.app.fileManager.createNewMarkdownFile(name, this.app.workspace.getActiveFile()?.path ?? '');
    await openAtLine(this.app, file, undefined, evt.ctrlKey || evt.metaKey ? 'tab' : false);
  }
}

export default class QuickSwitcherPlugin extends Plugin {
  private recent: string[] = loadRecent();

  onload(): void {
    this.addCommand({ id: 'open', name: t('switcher.cmd'), icon: 'search', hotkeys: [{ modifiers: ['Mod'], key: 'o' }],
      callback: () => new QuickSwitcherModal(this.app, this.recent).open() });
    this.registerEvent(this.app.workspace.on('file-open', (f: TFile | null) => {
      if (!f) return;
      this.recent = [f.path, ...this.recent.filter((p) => p !== f.path)];
      saveRecent(this.recent);
    }));
    this.registerEvent(this.app.vault.on('rename', (f, oldPath: string) => {
      this.recent = this.recent.map((p) => (p === oldPath ? f.path : p.startsWith(oldPath + '/') ? f.path + p.slice(oldPath.length) : p));
      saveRecent(this.recent);
    }));
  }
}
