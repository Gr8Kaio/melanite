import { Plugin, PluginSettingTab, Setting, TFile, normalizePath, type App } from '../../api';
import { t } from '../../app/i18n';
import { applyTemplate, formatDate } from './dates';

interface DailySettings { folder: string; format: string; template: string }
const DEFAULTS: DailySettings = { folder: '', format: 'YYYY-MM-DD', template: '' };

export const manifest = () => ({ id: 'daily-notes', name: t('plugins.dailyNotes.name'), description: t('plugins.dailyNotes.desc'), version: '1.0.0' });

/** Una nota por día. Otros plugins usan `getDailyNote()` (ej. Pomodoro agrega líneas). */
export default class DailyNotesPlugin extends Plugin {
  settings: DailySettings = { ...DEFAULTS };

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) ?? {}) };
    this.addCommand({ id: 'open-today', name: t('plugins.dailyNotes.open'), icon: 'calendar', callback: () => this.openToday() });
    this.addRibbonIcon('calendar', t('plugins.dailyNotes.open'), () => this.openToday());
    this.addSettingTab(new DailySettingTab(this.app, this));
  }

  pathFor(date: Date): string {
    return normalizePath(`${this.settings.folder}/${formatDate(date, this.settings.format || DEFAULTS.format)}.md`);
  }

  /** La nota del día `date` (hoy por defecto). Con `create` la crea desde la plantilla si no existe. */
  async getDailyNote(date = new Date(), create = true): Promise<TFile> {
    const path = this.pathFor(date);
    const existing = this.app.vault.getFileByPath(path);
    if (existing) return existing;
    if (!create) throw new Error(`no existe ${path}`);
    let content = '## To do\n\n- [ ] '; // sin plantilla configurada: arranca con la lista del día
    const tpl = this.settings.template && this.app.vault.getFileByPath(normalizePath(this.settings.template.replace(/(\.md)?$/, '.md')));
    if (tpl) content = applyTemplate(await this.app.vault.read(tpl), { title: path.replace(/^.*\//, '').replace(/\.md$/, ''), date });
    return this.app.vault.create(path, content);
  }

  async openToday() {
    const file = await this.getDailyNote();
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async save() { await this.saveData(this.settings); }
}

class DailySettingTab extends PluginSettingTab {
  constructor(app: App, public plugin: DailyNotesPlugin) { super(app, plugin); }
  display() {
    const el = this.containerEl;
    const s = this.plugin.settings;
    new Setting(el).setName(t('plugins.dailyNotes.folder')).setDesc(t('plugins.dailyNotes.folderDesc'))
      .addText((x) => x.setPlaceholder('diario').setValue(s.folder).onChange((v) => { s.folder = v.trim(); void this.plugin.save(); }));
    const fmt = new Setting(el).setName(t('plugins.dailyNotes.format'));
    const example = () => fmt.setDesc(t('plugins.dailyNotes.formatDesc', { example: formatDate(new Date(), s.format || DEFAULTS.format) }));
    example();
    fmt.addText((x) => x.setPlaceholder(DEFAULTS.format).setValue(s.format).onChange((v) => { s.format = v.trim(); example(); void this.plugin.save(); }));
    new Setting(el).setName(t('plugins.dailyNotes.template')).setDesc(t('plugins.dailyNotes.templateDesc'))
      .addText((x) => x.setPlaceholder('plantillas/diaria').setValue(s.template).onChange((v) => { s.template = v.trim(); void this.plugin.save(); }));
  }
}
