import type { App, AppSettings } from '../app';
import { Modal } from '../ui/modal';
import { Setting } from '../ui/setting';
import { t } from '../i18n';

/** Pestaña de ajustes (la app y los plugins agregan las suyas). */
export abstract class SettingTab {
  app: App;
  containerEl: HTMLDivElement;
  id = '';
  name = '';
  constructor(app: App) {
    this.app = app;
    this.containerEl = createDiv('vertical-tab-content');
  }
  abstract display(): void;
  hide(): void { this.containerEl.empty(); }
}

export class SettingsModal extends Modal {
  private navEl!: HTMLDivElement;
  private paneEl!: HTMLDivElement;
  private current: SettingTab | null = null;

  constructor(app: App, private initial?: string) {
    super(app);
    this.modalEl.addClass('mod-settings');
  }

  onOpen(): void {
    this.contentEl.addClass('vertical-tabs-container');
    this.navEl = this.contentEl.createDiv('vertical-tab-header');
    this.paneEl = this.contentEl.createDiv('vertical-tab-content-container');
    const groups: [string, SettingTab[]][] = [
      [t('settings.groupOptions'), this.app.settingTabs],
      [t('settings.groupPlugins'), this.app.pluginSettingTabs],
    ];
    for (const [title, tabs] of groups) {
      if (!tabs.length) continue;
      this.navEl.createDiv({ cls: 'vertical-tab-header-group-title', text: title });
      for (const tab of tabs) {
        const nav = this.navEl.createDiv({ cls: 'vertical-tab-nav-item', text: tab.name });
        nav.addEventListener('click', () => this.openTab(tab, nav));
        if (tab.id === this.initial || (!this.initial && !this.current)) this.openTab(tab, nav);
      }
    }
  }

  onClose(): void { this.current?.hide(); }

  private openTab(tab: SettingTab, nav: HTMLElement) {
    this.current?.hide();
    this.navEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
    nav.addClass('is-active');
    this.current = tab;
    this.paneEl.empty();
    this.paneEl.appendChild(tab.containerEl);
    tab.containerEl.empty();
    tab.containerEl.createEl('h2', { text: tab.name });
    tab.display();
    this.contentEl.addClass('is-showing-pane');
  }
}

/** Ajustes propios de la app, agrupados en pestañas. */
function appTab(app: App, id: string, name: string, build: (el: HTMLElement, set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void) => void): SettingTab {
  const tab = new (class extends SettingTab {
    display() {
      build(this.containerEl, (k, v) => { app.settings[k] = v; void app.saveSettings(); });
    }
  })(app);
  tab.id = id;
  tab.name = name;
  return tab;
}

export function coreSettingTabs(app: App): SettingTab[] {
  const s = app.settings;
  return [
    appTab(app, 'editor', t('settings.editor'), (el, set) => {
      new Setting(el).setName(t('settings.defaultMode')).setDesc(t('settings.defaultModeDesc')).addDropdown((d) => d
        .addOptions({ live: t('view.livePreview'), source: t('view.sourceMode'), reading: t('view.readingMode') })
        .setValue(s.defaultViewMode).onChange((v) => set('defaultViewMode', v as AppSettings['defaultViewMode'])));
      new Setting(el).setName(t('settings.readable')).setDesc(t('settings.readableDesc')).addToggle((tg) => tg
        .setValue(s.readableLineLength).onChange((v) => set('readableLineLength', v)));
      new Setting(el).setName(t('settings.spellcheck')).addToggle((tg) => tg.setValue(s.spellcheck).onChange((v) => set('spellcheck', v)));
      new Setting(el).setName(t('settings.fontSize')).addSlider((sl) => sl.setLimits(12, 24, 1).setValue(s.fontSize).setDynamicTooltip()
        .onChange((v) => set('fontSize', v)));
    }),
    appTab(app, 'files', t('settings.files'), (el, set) => {
      new Setting(el).setName(t('settings.newLocation')).addDropdown((d) => d
        .addOptions({ root: t('settings.locRoot'), current: t('settings.locCurrent'), folder: t('settings.locFolder') })
        .setValue(s.newFileLocation).onChange((v) => { set('newFileLocation', v as AppSettings['newFileLocation']); folder.settingEl.toggle(v === 'folder'); }));
      const folder = new Setting(el).setName(t('settings.newFolder')).addText((tx) => tx.setPlaceholder('notas').setValue(s.newFileFolder).onChange((v) => set('newFileFolder', v.trim())));
      folder.settingEl.toggle(s.newFileLocation === 'folder');
      new Setting(el).setName(t('settings.attachments')).setDesc(t('settings.attachmentsDesc')).addText((tx) => tx
        .setPlaceholder('adjuntos').setValue(s.attachmentFolder).onChange((v) => set('attachmentFolder', v.trim())));
      new Setting(el).setName(t('settings.confirmDelete')).addToggle((tg) => tg.setValue(s.confirmDelete).onChange((v) => set('confirmDelete', v)));
    }),
    appTab(app, 'appearance', t('settings.appearance'), (el, set) => {
      new Setting(el).setName(t('settings.theme')).addDropdown((d) => d
        .addOptions({ system: t('settings.themeSystem'), light: t('settings.themeLight'), dark: t('settings.themeDark') })
        .setValue(s.theme).onChange((v) => set('theme', v as AppSettings['theme'])));
      new Setting(el).setName(t('settings.language')).setDesc(t('settings.languageDesc')).addDropdown((d) => d
        .addOptions({ es: 'Español', en: 'English' }).setValue(s.language).onChange((v) => set('language', v as AppSettings['language'])));
    }),
    appTab(app, 'about', t('settings.about'), (el) => {
      new Setting(el).setName('Melanite').setDesc(t('settings.version', { v: __APP_VERSION__ }));
      new Setting(el).setName(t('settings.storage')).then((st) => {
        void navigator.storage?.estimate?.().then((e) => st.setDesc(t('settings.storageDesc', { used: ((e.usage ?? 0) / 1048576).toFixed(1) })));
        void navigator.storage?.persisted?.().then((p) => st.controlEl.createSpan({ cls: 'setting-badge', text: p ? t('settings.persisted') : t('settings.notPersisted') }));
      });
    }),
  ];
}

declare global { const __APP_VERSION__: string; }
