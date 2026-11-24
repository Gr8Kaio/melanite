import { Plugin, PluginSettingTab, Setting, Notice, TFile, normalizePath, type App } from '../../api';
import { t } from '../../app/i18n';
import { pickItem } from '../pick';
import { applyTemplate } from './dates';

interface TemplateSettings { folder: string; dateFormat: string; timeFormat: string }
const DEFAULTS: TemplateSettings = { folder: 'plantillas', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' };

export const manifest = () => ({ id: 'templates', name: t('plugins.templates.name'), description: t('plugins.templates.desc'), version: '1.0.0' });

export default class TemplatesPlugin extends Plugin {
  settings: TemplateSettings = { ...DEFAULTS };

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) ?? {}) };
    this.addCommand({
      id: 'insert', name: t('plugins.templates.insert'), icon: 'file-text',
      editorCallback: async (editor, view) => {
        const folder = normalizePath(this.settings.folder);
        const files = this.app.vault.getMarkdownFiles().filter((f) => !folder || f.path.startsWith(`${folder}/`))
          .sort((a, b) => a.path.localeCompare(b.path));
        if (!files.length) { new Notice(t('plugins.templates.none', { folder })); return; }
        const file = await pickItem<TFile>(this.app, files, (f) => f.path.slice(folder ? folder.length + 1 : 0).replace(/\.md$/, ''), t('plugins.templates.pick'));
        if (!file) return;
        editor.replaceSelection(this.render(await this.app.vault.read(file), view.file?.basename ?? ''));
        editor.focus();
      },
    });
    this.addSettingTab(new TemplateSettingTab(this.app, this));
  }

  render(text: string, title: string, date = new Date()): string {
    return applyTemplate(text, { title, date, dateFormat: this.settings.dateFormat, timeFormat: this.settings.timeFormat });
  }

  async save() { await this.saveData(this.settings); }
}

class TemplateSettingTab extends PluginSettingTab {
  constructor(app: App, public plugin: TemplatesPlugin) { super(app, plugin); }
  display() {
    const el = this.containerEl;
    const s = this.plugin.settings;
    const text = (name: string, key: keyof TemplateSettings) => new Setting(el).setName(name)
      .addText((x) => x.setPlaceholder(DEFAULTS[key]).setValue(s[key]).onChange((v) => { s[key] = v.trim() || DEFAULTS[key]; void this.plugin.save(); }));
    text(t('plugins.templates.folder'), 'folder');
    text(t('plugins.templates.dateFormat'), 'dateFormat');
    text(t('plugins.templates.timeFormat'), 'timeFormat');
  }
}
