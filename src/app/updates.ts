/**
 * Buscar e instalar versiones nuevas.
 *  - App de escritorio: electron-updater contra los GitHub Releases (IPC del proceso principal).
 *  - Web / iPhone (PWA): version.json del deploy dice si hay una nueva; al aceptar, el
 *    service worker baja el build nuevo y la página se recarga.
 */
export type UpdateStatus =
  | { status: 'latest'; version: string }
  | { status: 'available'; version: string; current: string }
  | { status: 'downloading'; version?: string }
  | { status: 'downloaded'; version: string }
  | { status: 'unsupported'; version?: string }
  | { status: 'error'; message: string };

interface DesktopUpdates {
  check(): Promise<UpdateStatus>;
  download(): Promise<void>;
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
    const res = await fetch(new URL('version.json', reg.scope), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { version } = (await res.json()) as { version: string };
    return version && version !== __APP_VERSION__
      ? { status: 'available', version, current: __APP_VERSION__ }
      : { status: 'latest', version: __APP_VERSION__ };
  } catch (err) {
    return { status: 'error', message: String((err as Error)?.message ?? err) };
  }
}

/** Baja la versión que encontró `checkForUpdates`. En la web, el service worker nuevo recarga la página al activarse. */
export async function downloadUpdate(): Promise<void> {
  const desktop = desktopUpdates();
  if (desktop) return desktop.download();
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) return location.reload();
  await reg.update();
  if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  else if (!reg.installing) location.reload(); // ya estaba bajado: recargar alcanza
}

export async function installUpdate(): Promise<void> {
  const desktop = desktopUpdates();
  if (desktop) await desktop.install();
  else location.reload();
}
