// Actualización desde los GitHub Releases del repo (electron-updater).
// Busca al arrancar y cada 6 h, y a pedido desde Ajustes → About; nunca descarga sin preguntar.
const { app, dialog, ipcMain } = require('electron');

const CADA_HORAS = 6;
let downloaded = null; // versión ya descargada, lista para instalar
let downloading = null; // versión que se está bajando
let asked = null; // la búsqueda automática pregunta una sola vez por versión

async function download() {
  if (downloading || !app.isPackaged) return;
  try {
    const r = await updater().checkForUpdates();
    downloading = r?.updateInfo?.version ?? 'nueva';
    await updater().downloadUpdate();
  } catch (e) {
    console.error('updater:', e?.message ?? e);
  } finally {
    downloading = null;
  }
}

function updater() {
  return require('electron-updater').autoUpdater;
}

/** IPC para Ajustes → About. Se registra siempre (en desarrollo responde "unsupported"). */
exports.register = (getWin) => {
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { status: 'unsupported', version: app.getVersion() };
    try {
      const r = await updater().checkForUpdates();
      const latest = r?.updateInfo?.version;
      const available = r?.isUpdateAvailable ?? (!!latest && latest !== app.getVersion());
      if (!available) return { status: 'latest', version: app.getVersion() };
      if (downloaded === latest) return { status: 'downloaded', version: latest };
      if (downloading === latest) return { status: 'downloading', version: latest };
      return { status: 'available', version: latest, current: app.getVersion() };
    } catch (e) {
      return { status: 'error', message: String(e?.message ?? e) };
    }
  });
  ipcMain.handle('update:download', () => download());
  ipcMain.handle('update:install', () => { if (downloaded) updater().quitAndInstall(); });
  ipcMain.handle('update:version', () => app.getVersion());

  if (!app.isPackaged) return;
  const au = updater();
  au.autoDownload = false;
  au.autoInstallOnAppQuit = true;
  au.on('error', (e) => console.error('updater:', e?.message ?? e));
  au.on('download-progress', (p) => getWin()?.webContents.send('update:progress', Math.round(p.percent ?? 0)));
  au.on('update-downloaded', (info) => {
    downloaded = info.version;
    const win = getWin();
    win?.webContents.send('update:downloaded', info.version);
    const opts = {
      type: 'info', buttons: ['Reiniciar ahora', 'Después'], defaultId: 0, cancelId: 1,
      title: 'Melanite', message: `Hay una versión nueva (${info.version}).`,
      detail: 'Reiniciá para instalarla. Si elegís "Después", se instala al cerrar la app.',
    };
    void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).then((r) => {
      if (r.response === 0) au.quitAndInstall();
    });
  });
  // búsqueda automática: si hay versión nueva, pregunta (una vez por versión) antes de bajarla
  const check = async () => {
    try {
      const r = await au.checkForUpdates();
      const v = r?.updateInfo?.version;
      const available = r?.isUpdateAvailable ?? (!!v && v !== app.getVersion());
      if (!available || !v || v === asked || v === downloaded || v === downloading) return;
      asked = v;
      const win = getWin();
      const opts = {
        type: 'info', buttons: ['Descargar', 'Ahora no'], defaultId: 0, cancelId: 1,
        title: 'Melanite', message: `Hay una versión nueva: ${v} (tenés ${app.getVersion()}).`,
        detail: '¿Querés descargarla? Cuando termine te pregunta si reiniciar.',
      };
      const res = await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
      if (res.response === 0) void download();
    } catch { /* sin red: se reintenta en la próxima vuelta */ }
  };
  check();
  setInterval(check, CADA_HORAS * 3600_000);
};
