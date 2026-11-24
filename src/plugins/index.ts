import type { App } from '../app/app';
import * as api from '../api';
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import { registerStrings } from '../app/i18n';
import { es, en } from './strings';
import { pluginSettingTabs } from './settings-tabs';
import DailyNotes, { manifest as dailyManifest } from './core-plugins/daily-notes';
import Templates, { manifest as templatesManifest } from './core-plugins/templates';
import Bookmarks, { manifest as bookmarksManifest } from './core-plugins/bookmarks';
import WordCount, { manifest as wordCountManifest } from './core-plugins/word-count';
import './plugins.css';

const shared: Record<string, unknown> = {
  melanite: api,
  '@codemirror/state': cmState,
  '@codemirror/view': cmView,
  '@codemirror/language': cmLanguage,
};

/** Sistema de plugins (fase 3): API pública en runtime, plugins internos y pantallas de ajustes. */
export async function install(app: App): Promise<void> {
  (globalThis as { __melanite?: unknown }).__melanite = {
    require(name: string) {
      if (name in shared) return shared[name];
      throw new Error(`[melanite] módulo no disponible para plugins: ${name}`);
    },
  };
  registerStrings({ es, en });
  app.plugins.registerCore(dailyManifest(), DailyNotes);
  app.plugins.registerCore(templatesManifest(), Templates);
  app.plugins.registerCore(bookmarksManifest(), Bookmarks);
  app.plugins.registerCore(wordCountManifest(), WordCount);
  // antes de "Acerca de", que queda última
  const about = app.settingTabs.findIndex((tab) => tab.id === 'about');
  app.settingTabs.splice(about < 0 ? app.settingTabs.length : about, 0, ...pluginSettingTabs(app));
}
