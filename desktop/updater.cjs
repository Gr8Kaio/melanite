// Actualización automática desde los GitHub Releases del repo (electron-updater).
const { dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const CADA_HORAS = 6;

exports.start = (getWin) => {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => console.error('updater:', e?.message ?? e));
  autoUpdater.on('update-downloaded', (info) => {
    const win = getWin();
    const opts = {
      type: 'info', buttons: ['Reiniciar ahora', 'Después'], defaultId: 0, cancelId: 1,
      title: 'Melanite', message: `Hay una versión nueva (${info.version}).`,
      detail: 'Reiniciá para instalarla. Si elegís "Después", se instala al cerrar la app.',
    };
    void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CADA_HORAS * 3600_000);
};
