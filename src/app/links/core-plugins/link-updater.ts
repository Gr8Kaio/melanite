import { Plugin } from '../../../api/plugin';
import type { TAbstractFile } from '../../../core/vault';
import { normalizePath } from '../../../core/path';
import { Notice } from '../../ui/modal';
import { renameWithLinks } from '../link-updater';
import { flushEditors } from '../util';
import { t } from '../../i18n';

/**
 * Al renombrar o mover (nota, adjunto o carpeta) actualiza los links que apuntan ahí.
 * Se engancha envolviendo app.fileManager.renameFile; al desactivarlo vuelve el original.
 */
export default class LinkUpdaterPlugin extends Plugin {
  onload(): void {
    const fm = this.app.fileManager;
    const original = fm.renameFile;
    fm.renameFile = async (file: TAbstractFile, newPath: string) => {
      await flushEditors(this.app);
      const r = await renameWithLinks(this.app.vault, file, normalizePath(newPath), (f, p) => original.call(fm, f, p));
      if (r.links) new Notice(t('links.updated', { links: r.links, files: r.files }));
    };
    this.register(() => { fm.renameFile = original; });
  }
}
