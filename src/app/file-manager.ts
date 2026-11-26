import type { App } from './app';
import { TAbstractFile, TFile, TFolder } from '../core/vault';
import { basename, dirname, extname, joinPath, normalizePath, stripExt } from '../core/path';
import { fileToLinktext } from '../core/links';
import { newNotePath } from './workspace';
import { Modal, Notice, confirmDialog, promptText } from './ui/modal';
import { t } from './i18n';

const INVALID = /[\\:*?"<>|#^[\]]/;

/** Operaciones de archivos de alto nivel (las que hace la UI y la API de plugins). */
export class FileManager {
  app: App;
  constructor(app: App) { this.app = app; }

  /** Carpeta donde va una nota nueva según los ajustes. */
  getNewFileParent(sourcePath = this.app.workspace.getActiveFile()?.path ?? ''): TFolder {
    const s = this.app.settings;
    const vault = this.app.vault;
    if (s.newFileLocation === 'current') return vault.getFolderByPath(dirname(sourcePath)) ?? vault.getRoot();
    if (s.newFileLocation === 'folder') return vault.getFolderByPath(s.newFileFolder) ?? vault.getRoot();
    return vault.getRoot();
  }

  async createNewMarkdownFile(name: string, sourcePath = ''): Promise<TFile> {
    const path = newNotePath(this.app, name, sourcePath);
    return this.app.vault.getFileByPath(path) ?? this.app.vault.create(path, '');
  }

  async createAndOpen(folder: TFolder, content = ''): Promise<TFile> {
    const path = this.app.vault.getAvailablePath(joinPath(folder.path, t('file.untitled')), 'md');
    const file = await this.app.vault.create(path, content);
    await this.app.workspace.getLeaf(false).openFile(file);
    return file;
  }

  async promptNewFolder(parent: TFolder): Promise<void> {
    const name = await promptText(this.app, { title: t('cmd.newFolder'), placeholder: t('file.folderName') });
    if (!name) return;
    if (!this.validName(name)) return;
    const path = joinPath(parent.path, name);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t('notice.exists', { name })); return; }
    await this.app.vault.createFolder(path);
  }

  /** Renombra o mueve. (En la fase 2 también actualiza los links que apuntan al archivo.) */
  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    await this.app.vault.rename(file, normalizePath(newPath));
  }

  async promptForRename(file: TAbstractFile): Promise<void> {
    const isMd = file instanceof TFile && file.extension === 'md';
    const current = isMd ? (file as TFile).basename : file.name;
    const dot = file instanceof TFile && !isMd ? current.lastIndexOf('.') : -1;
    const name = await promptText(this.app, { title: t('file.rename'), value: current, cta: t('file.rename'), selectUntil: dot > 0 ? dot : undefined });
    if (!name || name === current || !this.validName(name)) return;
    const newPath = joinPath(dirname(file.path), isMd ? `${name}.md` : name);
    if (this.app.vault.getAbstractFileByPath(newPath)) { new Notice(t('notice.exists', { name })); return; }
    try { await this.renameFile(file, newPath); } catch (err) { new Notice(String((err as Error).message)); }
  }

  async moveFile(file: TAbstractFile, folder: TFolder): Promise<void> {
    const target = joinPath(folder.path, file.name);
    if (this.app.vault.getAbstractFileByPath(target)) { new Notice(t('notice.exists', { name: file.name })); return; }
    try { await this.renameFile(file, target); } catch (err) { new Notice(String((err as Error).message)); }
  }

  /** Elegir carpeta destino de una lista filtrable. */
  async promptMove(file: TAbstractFile): Promise<void> {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.path.split('/').some((s) => s.startsWith('.')))
      .filter((f) => !(file instanceof TFolder && (f.path + '/').startsWith(file.path + '/')))
      .sort((a, b) => a.path.localeCompare(b.path));
    const folder = await new Promise<TFolder | null>((resolve) => {
      let chosen: TFolder | null = null;
      const m = new Modal(this.app);
      m.setTitle(t('file.moveTo'));
      const input = m.contentEl.createEl('input', { type: 'text', cls: 'prompt-input', placeholder: t('file.filterFolders') });
      const list = m.contentEl.createDiv('suggestion-list');
      const draw = () => {
        list.empty();
        const q = input.value.toLowerCase();
        for (const f of folders.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 50)) {
          list.createDiv({ cls: 'suggestion-item', text: f.isRoot() ? '/' : f.path }).addEventListener('click', () => { chosen = f; m.close(); });
        }
      };
      input.addEventListener('input', draw);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const first = folders.find((f) => f.path.toLowerCase().includes(input.value.toLowerCase()));
        if (first) { chosen = first; m.close(); }
      });
      m.onClose = () => resolve(chosen);
      m.open();
      draw();
      input.focus();
    });
    if (folder) await this.moveFile(file, folder);
  }

  async duplicate(file: TFile): Promise<void> {
    const path = this.app.vault.getAvailablePath(joinPath(dirname(file.path), file.basename), file.extension);
    if (file.extension === 'md') await this.app.vault.create(path, this.app.vault.cachedReadSync(file));
    else await this.app.vault.createBinary(path, await this.app.vault.readBinary(file));
  }

  async promptForDeletion(file: TAbstractFile): Promise<void> {
    if (this.app.settings.confirmDelete) {
      const ok = await confirmDialog(this.app, {
        title: t('file.delete'),
        message: t(file instanceof TFolder ? 'file.confirmDeleteFolder' : 'file.confirmDelete', { name: file.name }),
        cta: t('file.delete'),
        warning: true,
      });
      if (!ok) return;
    }
    await this.trashFile(file);
  }

  /** Borra a la papelera del vault (.trash). */
  async trashFile(file: TAbstractFile): Promise<void> {
    await this.app.vault.trash(file);
  }

  /** Guarda un archivo pegado/soltado/elegido en la carpeta de adjuntos. */
  async saveAttachment(f: File, sourcePath: string): Promise<TFile> {
    const folderSetting = this.app.settings.attachmentFolder.trim();
    const folder = folderSetting === './' ? dirname(sourcePath) : folderSetting.startsWith('./') ? joinPath(dirname(sourcePath), folderSetting.slice(2)) : folderSetting;
    const ext = extname(f.name) || (f.type.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const isGeneric = !f.name || /^image\.(png|jpe?g|gif|webp|heic)$/i.test(f.name);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const base = isGeneric ? `${t('file.pastedImage')} ${stamp}` : stripExt(basename(f.name)).replace(INVALID, '-');
    const path = this.app.vault.getAvailablePath(joinPath(folder, base), ext);
    return this.app.vault.createBinary(path, await f.arrayBuffer());
  }

  /** Archivo soltado en el explorador desde el sistema operativo. */
  async importFile(f: File, folder: TFolder): Promise<TFile> {
    const ext = extname(f.name);
    const path = this.app.vault.getAvailablePath(joinPath(folder.path, stripExt(f.name)), ext);
    return this.app.vault.createBinary(path, await f.arrayBuffer());
  }

  generateMarkdownLink(file: TFile, sourcePath: string, embed = false, subpath = '', alias = ''): string {
    const target = fileToLinktext(this.app.vault, file, sourcePath) + subpath;
    return `${embed ? '!' : ''}[[${target}${alias ? `|${alias}` : ''}]]`;
  }

  private validName(name: string): boolean {
    if (INVALID.test(name) || name.includes('/') || name.startsWith('.')) {
      new Notice(t('notice.invalidName'));
      return false;
    }
    return true;
  }
}
