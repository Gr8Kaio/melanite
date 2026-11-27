import type { App, AppSettings } from '../app';
import { Modal, confirmDialog } from '../ui/modal';
import { Setting } from '../ui/setting';
import { t } from '../i18n';
import { checkForUpdates, desktopUpdates, downloadUpdate, installUpdate } from '../updates';

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
    // barra "Apply": aparece cuando hay cambios pendientes en los ajustes del núcleo
    this.applyBar = this.modalEl.createDiv('settings-apply-bar');
    this.applyBar.createSpan({ cls: 'settings-apply-text', text: t('settings.pending') });
    this.applyBar.createEl('button', { text: t('settings.discard') }).addEventListener('click', () => this.discard());
    this.applyBar.createEl('button', { cls: 'mod-cta', text: t('settings.apply') }).addEventListener('click', () => void this.apply());
    this.refreshBar = () => this.applyBar.toggleClass('is-visible', hasPending());
    draftListeners.add(this.refreshBar);
    this.refreshBar();
  }

  private applyBar!: HTMLDivElement;
  private refreshBar = () => {};

  onClose(): void {
    this.current?.hide();
    draftListeners.delete(this.refreshBar);
    if (!hasPending()) return;
    void confirmDialog(this.app, { title: t('settings.unsavedTitle'), message: t('settings.unsavedMsg'), cta: t('settings.apply') })
      .then((ok) => (ok ? applyDraft(this.app) : clearDraft()));
  }

  private async apply() {
    await applyDraft(this.app);
    this.rerender();
  }

  private discard() {
    clearDraft();
    this.rerender();
  }

  private rerender() {
    const nav = this.navEl.querySelector<HTMLElement>('.vertical-tab-nav-item.is-active');
    if (this.current && nav) this.openTab(this.current, nav);
    this.refreshBar();
  }

  private openTab(tab: SettingTab, nav: HTMLElement) {
    this.current?.hide();
    this.navEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
    nav.addClass('is-active');
    nav.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // en el teléfono las pestañas scrollean en horizontal
    this.current = tab;
    this.paneEl.empty();
    this.paneEl.appendChild(tab.containerEl);
    tab.containerEl.empty();
    tab.containerEl.createEl('h2', { text: tab.name });
    tab.display();
    this.contentEl.addClass('is-showing-pane');
  }
}

// ---------------------------------------------------------------- actualizaciones (About)

function updatesSetting(el: HTMLElement): void {
  const row = new Setting(el).setName(t('settings.updates')).setDesc(t('settings.updatesIdle'));
  let installBtn: HTMLButtonElement | null = null;
  let downloadBtn: HTMLButtonElement | null = null;
  const showAvailable = (version: string, current: string) => {
    row.setDesc(t('settings.updatesAvailable', { v: version, current }));
    if (downloadBtn) return;
    row.addButton((b) => {
      downloadBtn = b.buttonEl;
      b.setButtonText(t('settings.updatesDownload')).setCta().onClick(async () => {
        b.setDisabled(true);
        row.setDesc(desktopUpdates() ? t('settings.updatesDownloading', { v: version }) : t('settings.updatesWeb'));
        await downloadUpdate();
        b.buttonEl.remove();
        downloadBtn = null;
      });
    });
  };
  const showInstall = (version: string) => {
    row.setDesc(t('settings.updatesReady', { v: version }));
    if (installBtn) return;
    row.addButton((b) => { installBtn = b.buttonEl; b.setButtonText(t('settings.updatesInstall')).setCta().onClick(() => void installUpdate()); });
  };
  const desktop = desktopUpdates();
  if (desktop) {
    // los listeners viven mientras la fila esté en pantalla
    const offProgress = desktop.onProgress((p) => { row.setDesc(t('settings.updatesProgress', { p })); });
    const offDone = desktop.onDownloaded((v) => { showInstall(v); });
    const stop = new MutationObserver(() => { if (!row.settingEl.isConnected) { offProgress(); offDone(); stop.disconnect(); } });
    stop.observe(document.body, { childList: true, subtree: true });
  }
  row.addButton((b) => b.setButtonText(t('settings.updatesCheck')).onClick(async () => {
    b.setDisabled(true);
    row.setDesc(t('settings.updatesChecking'));
    const r = await checkForUpdates();
    b.setDisabled(false);
    if (r.status === 'latest') { row.setDesc(t('settings.updatesLatest', { v: r.version })); }
    else if (r.status === 'available') { showAvailable(r.version, r.current); }
    else if (r.status === 'downloading') { row.setDesc(r.version ? t('settings.updatesDownloading', { v: r.version }) : t('settings.updatesWeb')); }
    else if (r.status === 'downloaded') { showInstall(r.version); }
    else if (r.status === 'unsupported') { row.setDesc(t('settings.updatesUnsupported')); }
    else { row.setDesc(t('settings.updatesError', { msg: r.message })); }
  }));
}

// ---------------------------------------------------------------- colores de sintaxis

const SYNTAX_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'math', 'code', 'quote', 'tag', 'formatting'] as const;

/** Un selector de color por tipo de línea; edita los colores del tema que está activo. */
function syntaxColorSettings(el: HTMLElement, s: AppSettings, set: Setter): void {
  const theme = document.body.hasClass('theme-dark') ? 'dark' : 'light';
  el.createEl('h3', { text: t('settings.syntaxColors') });
  el.createDiv({ cls: 'setting-item-description', text: t(theme === 'dark' ? 'settings.syntaxColorsDescDark' : 'settings.syntaxColorsDescLight') });
  // el color que se ve hoy (elegido o de fábrica): sin el estilo del usuario, el de fábrica
  const factory = (k: string) => {
    const style = document.getElementById('ml-syntax-colors') as HTMLStyleElement | null;
    const was = style?.disabled ?? false;
    if (style) style.disabled = true;
    const v = getComputedStyle(document.body).getPropertyValue(`--syn-${k}`).trim();
    if (style) style.disabled = was;
    return v;
  };
  const current = () => ({ ...s.syntaxColors[theme] });
  const save = (m: Record<string, string>) => set('syntaxColors', { ...s.syntaxColors, [theme]: m });
  for (const k of SYNTAX_KEYS) {
    const row = new Setting(el).setName(t(`settings.syn.${k}`));
    const input = row.controlEl.createEl('input', { type: 'color', cls: 'syntax-color-input' });
    input.value = s.syntaxColors[theme][k] ?? factory(k);
    input.addEventListener('input', () => save({ ...current(), [k]: input.value }));
    row.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(t('settings.syntaxReset')).onClick(() => {
      const m = current(); delete m[k]; save(m);
      input.value = factory(k);
    }));
  }
}

// ---------------------------------------------------------------- borrador + Apply

/** Cambios pendientes de los ajustes del núcleo (se aplican con el botón Apply). */
const draft: Partial<AppSettings> = {};
const draftListeners = new Set<() => void>();
const hasPending = () => Object.keys(draft).length > 0;
const notify = () => draftListeners.forEach((fn) => fn());
function clearDraft() { for (const k of Object.keys(draft)) delete draft[k as keyof AppSettings]; notify(); }

async function applyDraft(app: App): Promise<void> {
  if (!hasPending()) return;
  const langChanged = draft.language !== undefined && draft.language !== app.settings.language;
  Object.assign(app.settings, draft);
  clearDraft();
  await app.saveSettings();
  // los textos ya dibujados no se traducen solos: recargar es lo más simple y seguro
  if (langChanged) location.reload();
}

type Setter = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;

/** Pestaña de ajustes del núcleo: lee el borrador y escribe en él. */
function appTab(app: App, id: string, name: string, build: (el: HTMLElement, s: AppSettings, set: Setter) => void): SettingTab {
  const tab = new (class extends SettingTab {
    display() {
      const view = { ...app.settings, ...draft } as AppSettings;
      build(this.containerEl, view, (k, v) => {
        if (app.settings[k] === v) delete draft[k]; else draft[k] = v;
        view[k] = v;
        notify();
      });
    }
  })(app);
  tab.id = id;
  tab.name = name;
  return tab;
}

export function coreSettingTabs(app: App): SettingTab[] {
  return [
    appTab(app, 'editor', t('settings.editor'), (el, s, set) => {
      new Setting(el).setName(t('settings.defaultMode')).setDesc(t('settings.defaultModeDesc')).addDropdown((d) => d
        .addOptions({ live: t('view.livePreview'), source: t('view.sourceMode'), reading: t('view.readingMode'), split: t('view.splitMode') })
        .setValue(s.defaultViewMode).onChange((v) => set('defaultViewMode', v as AppSettings['defaultViewMode'])));
      new Setting(el).setName(t('settings.readable')).setDesc(t('settings.readableDesc')).addToggle((tg) => tg
        .setValue(s.readableLineLength).onChange((v) => set('readableLineLength', v)));
      new Setting(el).setName(t('settings.pageNumbers')).setDesc(t('settings.pageNumbersDesc')).addToggle((tg) => tg
        .setValue(s.pageNumbers).onChange((v) => set('pageNumbers', v)));
      new Setting(el).setName(t('settings.spellcheck')).addToggle((tg) => tg.setValue(s.spellcheck).onChange((v) => set('spellcheck', v)));
      new Setting(el).setName(t('settings.fontSize')).addSlider((sl) => sl.setLimits(12, 24, 1).setValue(s.fontSize).setDynamicTooltip()
        .onChange((v) => set('fontSize', v)));
    }),
    appTab(app, 'files', t('settings.files'), (el, s, set) => {
      new Setting(el).setName(t('settings.newLocation')).addDropdown((d) => d
        .addOptions({ root: t('settings.locRoot'), current: t('settings.locCurrent'), folder: t('settings.locFolder') })
        .setValue(s.newFileLocation).onChange((v) => { set('newFileLocation', v as AppSettings['newFileLocation']); folder.settingEl.toggle(v === 'folder'); }));
      const folder = new Setting(el).setName(t('settings.newFolder')).addText((tx) => tx.setPlaceholder('notas').setValue(s.newFileFolder).onChange((v) => set('newFileFolder', v.trim())));
      folder.settingEl.toggle(s.newFileLocation === 'folder');
      new Setting(el).setName(t('settings.attachments')).setDesc(t('settings.attachmentsDesc')).addText((tx) => tx
        .setPlaceholder('adjuntos').setValue(s.attachmentFolder).onChange((v) => set('attachmentFolder', v.trim())));
      new Setting(el).setName(t('settings.confirmDelete')).addToggle((tg) => tg.setValue(s.confirmDelete).onChange((v) => set('confirmDelete', v)));
    }),
    appTab(app, 'appearance', t('settings.appearance'), (el, s, set) => {
      new Setting(el).setName(t('settings.theme')).addDropdown((d) => d
        .addOptions({ system: t('settings.themeSystem'), light: t('settings.themeLight'), dark: t('settings.themeDark') })
        .setValue(s.theme).onChange((v) => set('theme', v as AppSettings['theme'])));
      new Setting(el).setName(t('settings.language')).setDesc(t('settings.languageDesc')).addDropdown((d) => d
        .addOptions({ es: 'Español', en: 'English' }).setValue(s.language).onChange((v) => set('language', v as AppSettings['language'])));
      syntaxColorSettings(el, s, set);
    }),
    appTab(app, 'about', t('settings.about'), (el) => {
      new Setting(el).setName('Melanite').setDesc(t('settings.version', { v: __APP_VERSION__ }));
      updatesSetting(el);
      new Setting(el).setName(t('settings.storage')).then((st) => {
        // ojo: Setting tiene then(); si un .then() de promesa lo devuelve, la promesa lo trata
        // como thenable y entra en un bucle infinito (así se colgaba About). Siempre con llaves.
        void navigator.storage?.estimate?.().then((e) => { st.setDesc(t('settings.storageDesc', { used: ((e.usage ?? 0) / 1048576).toFixed(1) })); });
        void navigator.storage?.persisted?.().then((p) => { st.controlEl.createSpan({ cls: 'setting-badge', text: p ? t('settings.persisted') : t('settings.notPersisted') }); });
      });
    }),
  ];
}

declare global { const __APP_VERSION__: string; }
