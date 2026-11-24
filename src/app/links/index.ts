import type { App } from '../app';
import './links.css';
import { registerStrings } from '../i18n';
import { strings } from './strings';
import { coreManifest } from './util';
import { HotkeysSettingTab, loadHotkeys } from './hotkeys';
import { MarkdownView } from '../views/markdown-view';
import { parseWikilink } from '../../core/links';
import LinkUpdaterPlugin from './core-plugins/link-updater';
import LinkSuggestPlugin from './core-plugins/link-suggest';
import BacklinksPlugin from './core-plugins/backlinks';
import OutgoingLinksPlugin from './core-plugins/outgoing-links';
import OutlinePlugin from './core-plugins/outline';
import TagPanePlugin from './core-plugins/tag-pane';
import PropertiesPlugin from './core-plugins/properties';
import SearchPlugin from './core-plugins/search';
import QuickSwitcherPlugin from './core-plugins/switcher';
import CommandPalettePlugin from './core-plugins/command-palette';

/** Módulo links/búsqueda (fase 2): metadataCache, paneles, búsqueda, palette, renombrado con links. */
export async function install(app: App): Promise<void> {
  registerStrings(strings);
  app.metadataCache.initialize();

  await loadHotkeys(app);
  const about = app.settingTabs.findIndex((s) => s.id === 'about');
  app.settingTabs.splice(about < 0 ? app.settingTabs.length : about, 0, new HotkeysSettingTab(app));

  const core = [
    ['link-updater', LinkUpdaterPlugin], ['link-suggest', LinkSuggestPlugin], ['global-search', SearchPlugin],
    ['switcher', QuickSwitcherPlugin], ['command-palette', CommandPalettePlugin], ['backlink', BacklinksPlugin],
    ['outgoing-link', OutgoingLinksPlugin], ['outline', OutlinePlugin], ['tag-pane', TagPanePlugin], ['properties', PropertiesPlugin],
  ] as const;
  for (const [id, C] of core) app.plugins.registerCore(coreManifest(id), C);

  // el live preview ya se refresca solo con create/delete/rename; el modo lectura no se re-renderiza: marcamos los links a mano
  app.metadataCache.on('resolved', () => {
    app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView) || leaf.view.mode !== 'preview') return;
      for (const a of Array.from(leaf.view.readingEl.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
        const { path } = parseWikilink(a.dataset.href ?? '');
        if (!path) continue;
        const src = a.closest<HTMLElement>('[data-source-path]')?.dataset.sourcePath ?? leaf.view.file?.path ?? '';
        a.toggleClass('is-unresolved', !app.metadataCache.getFirstLinkpathDest(path, src));
      }
    });
  });
}
