import type { App } from '../app';
import type { TFile } from '../../core/vault';
import type { PaneType } from '../workspace';
import { MarkdownView } from '../views/markdown-view';
import type { PluginManifest } from '../../api/plugin';
import { t } from '../i18n';
import { Platform } from '../platform';

/** Guarda lo que esté escrito y sin guardar en los editores (antes de reescribir notas desde afuera). */
export async function flushEditors(app: App, file?: TFile): Promise<void> {
  const jobs: Promise<void>[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView && (!file || leaf.view.file === file)) jobs.push(leaf.view.save());
  });
  await Promise.all(jobs);
}

/** Abre la nota y pone el cursor en la línea (desde 0). */
export async function openAtLine(app: App, file: TFile, line: number | undefined, newLeaf: PaneType = false, extra: Record<string, unknown> = {}): Promise<void> {
  if (Platform.isPhone) { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); }
  await app.workspace.getLeaf(newLeaf).openFile(file, { eState: line === undefined ? extra : { ...extra, line } });
}

export const coreManifest = (id: string): PluginManifest => ({
  id, name: t(`links.plugin.${id}`), version: '1.0.0', description: t(`links.plugin.${id}.desc`), author: 'Melanite',
});

/** Agrega la hoja al sidebar si no está, sin cambiarle la pestaña visible. */
export async function ensureSidePanel(app: App, type: string, side: 'left' | 'right'): Promise<void> {
  if (app.workspace.getLeavesOfType(type).length) return;
  const ws = app.workspace;
  const tabs = (side === 'left' ? ws.leftSplit : ws.rightSplit).tabs;
  const current = tabs.activeLeaf;
  const leaf = side === 'left' ? ws.getLeftLeaf() : ws.getRightLeaf();
  if (current) tabs.selectTab(current);
  await leaf.setViewState({ type });
}

/** Debounce simple (para refrescar paneles). */
export function debounced(fn: () => void, ms = 100): () => void {
  let timer = 0;
  return () => { clearTimeout(timer); timer = window.setTimeout(fn, ms); };
}
