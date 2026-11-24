import { Plugin } from '../../../api/plugin';
import type { App } from '../../app';
import { hotkeyLabel, type Command } from '../../commands';
import { SuggestModal, fuzzyMatch, renderMatches } from '../../ui/suggest';
import { t } from '../../i18n';

const RECENT_KEY = 'melanite:recent-commands';

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}

interface Item { cmd: Command; score: number; matches: [number, number][] }

export class CommandPaletteModal extends SuggestModal<Item> {
  constructor(app: App) {
    super(app);
    this.setPlaceholder(t('palette.placeholder'));
    this.setInstructions([{ command: '↑↓', purpose: t('suggest.navigate') }, { command: '↵', purpose: t('palette.run') }]);
    this.emptyStateText = t('palette.none');
  }

  getSuggestions(query: string): Item[] {
    const recent = loadRecent();
    const rank = new Map(recent.map((id, i) => [id, i]));
    const cmds = this.app.commands.listCommands();
    if (!query.trim()) {
      return cmds
        .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name))
        .map((cmd) => ({ cmd, score: 0, matches: [] }));
    }
    const out: Item[] = [];
    for (const cmd of cmds) {
      const m = fuzzyMatch(query, cmd.name);
      if (m) out.push({ cmd, score: m.score + (rank.has(cmd.id) ? 2 - rank.get(cmd.id)! * 0.1 : 0), matches: m.matches });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.addClass('mod-complex');
    renderMatches(el.createDiv('suggestion-content suggestion-title'), item.cmd.name, item.matches);
    const keys = this.app.commands.hotkeysFor(item.cmd);
    if (!keys.length) return;
    const aux = el.createDiv('suggestion-aux');
    for (const h of keys) aux.createEl('kbd', { cls: 'suggestion-hotkey', text: hotkeyLabel(h) });
  }

  onChooseSuggestion(item: Item): void {
    const recent = [item.cmd.id, ...loadRecent().filter((id) => id !== item.cmd.id)].slice(0, 30);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* sin storage */ }
    this.app.getActiveMarkdownView()?.focus();
    this.app.commands.executeCommand(item.cmd);
  }
}

export default class CommandPalettePlugin extends Plugin {
  onload(): void {
    this.addCommand({ id: 'open', name: t('palette.cmd'), icon: 'menu', hotkeys: [{ modifiers: ['Mod'], key: 'p' }],
      callback: () => new CommandPaletteModal(this.app).open() });
    this.addRibbonIcon('menu', t('palette.cmd'), () => new CommandPaletteModal(this.app).open());
  }
}
