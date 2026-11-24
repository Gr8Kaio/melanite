import { Plugin } from '../../../api/plugin';
import { ItemView } from '../../views/view';
import { renderEmpty } from '../results';
import { debounced, openAtLine, ensureSidePanel } from '../util';
import { t } from '../../i18n';

export const OUTLINE_VIEW = 'outline';

export class OutlineView extends ItemView {
  icon = 'list';
  getViewType() { return OUTLINE_VIEW; }
  getDisplayText() { return t('links.outline'); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('ml-pane', 'ml-outline');
    const refresh = debounced(() => this.render(), 150);
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.render();
  }

  render(): void {
    const el = this.contentEl;
    el.empty();
    const file = this.app.workspace.getActiveFile();
    if (!file) { renderEmpty(el, t('links.noFile')); return; }
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    if (!headings.length) { renderEmpty(el, t('links.noHeadings')); return; }
    const min = Math.min(...headings.map((h) => h.level));
    for (const h of headings) {
      const item = el.createDiv({ cls: 'ml-tree-item ml-outline-item', attr: { 'data-level': h.level } });
      item.style.setProperty('--depth', String(h.level - min));
      item.createDiv({ cls: 'tree-item-inner', text: h.heading });
      item.addEventListener('click', () => void openAtLine(this.app, file, h.position.start.line, false, { subpath: `#${h.heading}` }));
    }
  }
}

export default class OutlinePlugin extends Plugin {
  onload(): void {
    this.registerView(OUTLINE_VIEW, (leaf) => new OutlineView(leaf));
    this.addCommand({ id: 'open', name: t('links.cmd.outline'), icon: 'list', callback: () => this.app.workspace.ensureSideLeaf(OUTLINE_VIEW, 'right', { reveal: true }) });
    this.app.workspace.onLayoutReady(() => void ensureSidePanel(this.app, OUTLINE_VIEW, 'right'));
  }
}
