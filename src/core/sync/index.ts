import type { App } from '../../app/app';
import type { TFile } from '../vault';
import { MarkdownView } from '../../app/views/markdown-view';
import { flushEditors } from '../../app/links/util';
import { Notice } from '../../app/ui/modal';
import { t } from '../../app/i18n';
import { SyncEngine } from './engine';
import { getSupabaseClient } from './client';
import './strings';

export { SyncEngine } from './engine';
export type { SyncConflict, SyncState, SyncStatus } from './engine';
export { getSupabaseClient } from './client';

/** Ningún editor abierto tiene texto sin guardar de `file`. */
function editorsClean(app: App, file: TFile): boolean {
  let clean = true;
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.getViewData() !== app.vault.cachedReadSync(file)) clean = false;
  });
  return clean;
}

/** El motor de sync de la app (`app.sync`), enganchado a los editores y con avisos de conflicto. */
export function createSync(app: App): SyncEngine {
  const sync = new SyncEngine(app.vault, { flush: (f) => flushEditors(app, f), editorsClean: (f) => editorsClean(app, f) });
  sync.on('conflict', (c: SyncEngine['conflicts'][number]) => {
    const key = c.kind === 'edit' ? 'sync.noticeEdit' : c.kind === 'rename' ? 'sync.noticeRename' : 'sync.noticePath';
    new Notice(t(key, { path: c.path, copy: c.copyPath ?? '', local: c.localPath ?? '' }), 8000);
  });
  return sync;
}

/** Si quedó una sesión guardada, retoma la sync sola; al cerrar sesión, la para. */
export async function resumeSync(app: App): Promise<void> {
  const client = await getSupabaseClient();
  if (!client) return;
  client.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') void app.sync.stop(); });
  const { data } = await client.auth.getSession();
  if (data.session) await app.sync.start(client);
}
