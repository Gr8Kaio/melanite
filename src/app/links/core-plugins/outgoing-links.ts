import { Plugin } from '../../../api/plugin';
import { ItemView } from '../../views/view';
import type { TFile } from '../../../core/vault';
import { getLinkpath } from '../../../core/metadata';
import { setIcon } from '../../ui/icons';
import { renderEmpty, renderSection } from '../results';
import { debounced, openAtLine, ensureSidePanel } from '../util';
import { t } from '../../i18n';

export const OUTGOING_VIEW = 'outgoing-link';

export class OutgoingLinksView extends ItemView {
  icon = 'external-link';
  getViewType() { return OUTGOING_VIEW; }
  getDisplayText() { return t('links.outgoing'); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('ml-pane', 'ml-outgoing');
    const refresh = debounced(() => this.render(), 150);
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    this.registerEvent(this.app.metadataCache.on('resolved', refresh));
    this.render();
  }

  render(): void {
    const el = this.contentEl;
    el.empty();
    const file = this.app.workspace.getActiveFile();
    if (!file) { renderEmpty(el, t('links.noFile')); return; }
    const cache = this.app.metadataCache.getFileCache(file);
    const resolved = new Map<TFile, number>();
    const unresolved = new Map<string, number>();
    for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
      const p = getLinkpath(l.link);
      if (!p) continue;
      const dest = this.app.metadataCache.getFirstLinkpathDest(p, file.path);
      if (dest) resolved.set(dest, (resolved.get(dest) ?? 0) + 1);
      else unresolved.set(p, (unresolved.get(p) ?? 0) + 1);
    }
    const row = (parent: HTMLElement, icon: string, text: string, count: number, cls: string, onClick: (e: MouseEvent) => unknown) => {
      const item = parent.createDiv({ cls: `tree-item-self ml-link-row ${cls}` });
      setIcon(item.createDiv('ml-link-row-icon'), icon);
      item.createDiv({ cls: 'tree-item-inner', text });
      if (count > 1) item.createDiv({ cls: 'ml-result-count', text: String(count) });
      item.addEventListener('click', (e) => void onClick(e));
    };
    const links = renderSection(el, t('links.outgoingResolved'), resolved.size);
    if (!resolved.size) renderEmpty(links, t('links.noOutgoing'));
    for (const [dest, n] of [...resolved].sort((a, b) => a[0].basename.localeCompare(b[0].basename))) {
      row(links, dest.extension === 'md' ? 'file-text' : 'file', dest.extension === 'md' ? dest.basename : dest.name, n, '',
        (e) => openAtLine(this.app, dest, undefined, e.ctrlKey || e.metaKey ? 'tab' : false));
    }
    const missing = renderSection(el, t('links.outgoingUnresolved'), unresolved.size);
    if (!unresolved.size) renderEmpty(missing, t('links.noUnresolved'));
    for (const [p, n] of [...unresolved].sort((a, b) => a[0].localeCompare(b[0]))) {
      row(missing, 'file-plus', p, n, 'is-unresolved', () => this.app.workspace.openLinkText(p, file.path));
    }
  }
}

export default class OutgoingLinksPlugin extends Plugin {
  onload(): void {
    this.registerView(OUTGOING_VIEW, (leaf) => new OutgoingLinksView(leaf));
    this.addCommand({ id: 'open', name: t('links.cmd.outgoing'), icon: 'external-link', callback: () => this.app.workspace.ensureSideLeaf(OUTGOING_VIEW, 'right', { reveal: true }) });
    this.app.workspace.onLayoutReady(() => void ensureSidePanel(this.app, OUTGOING_VIEW, 'right'));
  }
}
