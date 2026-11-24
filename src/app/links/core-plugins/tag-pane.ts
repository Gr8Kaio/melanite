import { Plugin } from '../../../api/plugin';
import { ItemView } from '../../views/view';
import { setIcon } from '../../ui/icons';
import { renderEmpty } from '../results';
import { debounced, ensureSidePanel } from '../util';
import { openSearch } from './search';
import { t } from '../../i18n';

export const TAGS_VIEW = 'tag';

interface TagNode { name: string; full: string; count: number; children: Map<string, TagNode> }

/** "#a/b" y "#a/c" → árbol a → {b, c}; el conteo de cada nodo incluye a sus hijos. */
export function buildTagTree(tags: Record<string, number>): TagNode {
  const root: TagNode = { name: '', full: '', count: 0, children: new Map() };
  for (const [tag, n] of Object.entries(tags)) {
    let node = root;
    const parts = tag.replace(/^#/, '').split('/').filter(Boolean);
    parts.forEach((p, i) => {
      const key = p.toLowerCase();
      let next = node.children.get(key);
      if (!next) { next = { name: p, full: parts.slice(0, i + 1).join('/'), count: 0, children: new Map() }; node.children.set(key, next); }
      next.count += n;
      node = next;
    });
  }
  return root;
}

export class TagsView extends ItemView {
  icon = 'tags';
  private collapsed = new Set<string>();
  getViewType() { return TAGS_VIEW; }
  getDisplayText() { return t('links.tags'); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('ml-pane', 'ml-tags');
    this.registerEvent(this.app.metadataCache.on('resolved', debounced(() => this.render(), 200)));
    this.render();
  }

  render(): void {
    const el = this.contentEl;
    el.empty();
    const root = buildTagTree(this.app.metadataCache.getTags());
    if (!root.children.size) { renderEmpty(el, t('links.noTags')); return; }
    const draw = (node: TagNode, parent: HTMLElement, depth: number) => {
      for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const wrap = parent.createDiv('ml-tag-node');
        const self = wrap.createDiv({ cls: 'tree-item-self ml-tag-item', attr: { 'data-tag': child.full } });
        self.style.setProperty('--depth', String(depth));
        const toggle = self.createDiv({ cls: 'ml-tag-toggle', attr: { 'aria-label': child.name } });
        if (child.children.size) setIcon(toggle, this.collapsed.has(child.full) ? 'chevron-right' : 'chevron-down');
        self.createDiv({ cls: 'tree-item-inner', text: `#${child.name}` });
        self.createDiv({ cls: 'ml-result-count', text: String(child.count) });
        self.addEventListener('click', (e) => {
          if (child.children.size && (e.target as HTMLElement).closest('.ml-tag-toggle')) {
            if (this.collapsed.has(child.full)) this.collapsed.delete(child.full); else this.collapsed.add(child.full);
            this.render();
            return;
          }
          void openSearch(this.app, `tag:#${child.full}`);
        });
        if (child.children.size && !this.collapsed.has(child.full)) draw(child, wrap, depth + 1);
      }
    };
    draw(root, el, 0);
  }
}

export default class TagPanePlugin extends Plugin {
  onload(): void {
    this.registerView(TAGS_VIEW, (leaf) => new TagsView(leaf));
    this.addCommand({ id: 'open', name: t('links.cmd.tags'), icon: 'tags', callback: () => this.app.workspace.ensureSideLeaf(TAGS_VIEW, 'right', { reveal: true }) });
    this.app.workspace.onLayoutReady(() => void ensureSidePanel(this.app, TAGS_VIEW, 'right'));
  }
}
