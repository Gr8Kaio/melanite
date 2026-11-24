/**
 * Buscar e instalar versiones nuevas.
 *  - App de escritorio: electron-updater contra los GitHub Releases (IPC del proceso principal).
 *  - Web / iPhone (PWA): el service worker baja el build nuevo de GitHub Pages; con
 *    registerType 'autoUpdate' se activa solo y la página se recarga.
 */
export type UpdateStatus =
  | { status: 'latest'; version: string }
  | { status: 'downloading'; version?: string }
  | { status: 'downloaded'; version: string }
  | { status: 'unsupported'; version?: string }
  | { status: 'error'; message: string };

interface DesktopUpdates {
  check(): Promise<UpdateStatus>;
  install(): Promise<void>;
  onProgress(cb: (percent: number) => void): () => void;
  onDownloaded(cb: (version: string) => void): () => void;
}

export function desktopUpdates(): DesktopUpdates | null {
  return (globalThis as { melaniteDesktop?: { updates?: DesktopUpdates } }).melaniteDesktop?.updates ?? null;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const desktop = desktopUpdates();
  if (desktop) return desktop.check();
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) return { status: 'unsupported' };
  try {
    await reg.update();
  } catch (err) {
    return { status: 'error', message: String((err as Error)?.message ?? err) };
  }
  // hay un service worker nuevo instalándose: al activarse, la página se recarga sola
  if (reg.installing || reg.waiting) {
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    return { status: 'downloading' };
  }
  return { status: 'latest', version: __APP_VERSION__ };
}

export async function installUpdate(): Promise<void> {
  const desktop = desktopUpdates();
  if (desktop) await desktop.install();
  else location.reload();
}
