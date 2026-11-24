// Actualización desde los GitHub Releases del repo (electron-updater).
// Automática al arrancar y cada 6 h, y a pedido desde Ajustes → About.
const { app, dialog, ipcMain } = require('electron');

const CADA_HORAS = 6;
let downloaded = null; // versión ya descargada, lista para instalar

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
      return { status: 'downloading', version: latest };
    } catch (e) {
      return { status: 'error', message: String(e?.message ?? e) };
    }
  });
  ipcMain.handle('update:install', () => { if (downloaded) updater().quitAndInstall(); });
  ipcMain.handle('update:version', () => app.getVersion());

  if (!app.isPackaged) return;
  const au = updater();
  au.autoDownload = true;
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
  const check = () => au.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CADA_HORAS * 3600_000);
};
