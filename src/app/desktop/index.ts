import type { App } from '../app';
import { SettingTab } from '../views/settings';
import { Setting } from '../ui/setting';
import { confirmDialog } from '../ui/modal';
import { t } from '../i18n';
import { FolderMirror, desktopFolderApi } from './folder-mirror';

/** Funciones exclusivas de la app de escritorio (Electron). En la web/iPhone no hace nada. */
export function install(app: App): void {
  const api = desktopFolderApi();
  if (!api) return;
  const mirror = new FolderMirror(app, api);

  class VaultFolderTab extends SettingTab {
    display(): void {
      const el = this.containerEl;
      el.createEl('p', { cls: 'setting-item-description', text: t('folder.desc') });
      const row = new Setting(el).setName(t('folder.current')).setDesc(mirror.root ?? t('folder.none'));
      row.addButton((b) => {
        b.setButtonText(mirror.root ? t('folder.change') : t('folder.choose')).setCta().onClick(async () => {
          b.setDisabled(true);
          try { if (await mirror.choose()) this.redraw(); } finally { b.setDisabled(false); }
        });
      });
      if (!mirror.root) return;
      row.addButton((b) => { b.setButtonText(t('folder.reveal')).onClick(() => { void api!.reveal(); }); });
      new Setting(el).addButton((b) => {
        b.setButtonText(t('folder.stop')).setWarning().onClick(async () => {
          const ok = await confirmDialog(app, { title: t('folder.stop'), message: t('folder.stopConfirm'), cta: t('folder.stop'), warning: true });
          if (ok) { await mirror.stop(); this.redraw(); }
        });
      });
    }

    private redraw() {
      this.containerEl.empty();
      this.containerEl.createEl('h2', { text: this.name });
      this.display();
    }
  }

  const tab = new VaultFolderTab(app);
  tab.id = 'vault-folder';
  tab.name = t('folder.tab');
  const at = app.settingTabs.findIndex((s) => s.id === 'files');
  app.settingTabs.splice(at < 0 ? app.settingTabs.length : at + 1, 0, tab);

  // la reconciliación no frena el arranque
  app.workspace.onLayoutReady(() => { void mirror.start(); });
}
