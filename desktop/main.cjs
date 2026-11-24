// Proceso principal de la app de escritorio. Carga dist-desktop/ por el protocolo app://melanite/
const { app, BrowserWindow, protocol, shell, dialog, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'app://melanite';
const DIST = path.join(__dirname, '..', 'dist-desktop');
const DEV_URL = process.env.MELANITE_DEV_URL; // desktop:dev apunta al dev server de Vite

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

app.setAppUserModelId('com.gr8kaio.melanite');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // --- tamaño/posición/maximizada recordados ---
  const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
  function loadState() {
    try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
  }
  function saveState() {
    if (!win || win.isDestroyed()) return;
    const s = { maximized: win.isMaximized(), ...(win.isMaximized() || win.isMinimized() ? loadState() : win.getBounds()) };
    s.maximized = win.isMaximized();
    try { fs.writeFileSync(stateFile(), JSON.stringify(s)); } catch { /* no es crítico */ }
  }

  function serve(request) {
    let p = decodeURIComponent(new URL(request.url).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    let target = file;
    // ponytail: sin ruta de SPA; lo desconocido cae en index.html. Si hay rutas reales, revisar.
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(DIST, 'index.html');
    return new Response(fs.readFileSync(target), {
      headers: { 'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' },
    });
  }

  const isInternal = (url) => (DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(ORIGIN + '/'));

  function openExternal(url) {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  }

  function createWindow() {
    const st = loadState();
    win = new BrowserWindow({
      width: st.width ?? 1280, height: st.height ?? 800, x: st.x, y: st.y,
      minWidth: 640, minHeight: 480,
      title: 'Melanite', icon: path.join(__dirname, 'icon.ico'),
      backgroundColor: '#141114', autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    if (st.maximized) win.maximize();
    win.on('close', saveState);
    win.on('page-title-updated', (e) => e.preventDefault()); // el título queda "Melanite"

    win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => {
      if (!isInternal(url)) { e.preventDefault(); openExternal(url); }
    });

    // Ctrl+W lo usa la app (cerrar pestaña); en producción Ctrl+R / F5 no recargan.
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const k = input.key.toLowerCase();
      const ctrl = input.control || input.meta;
      if (app.isPackaged && ((ctrl && k === 'r') || k === 'f5')) e.preventDefault();
    });

    void win.loadURL(DEV_URL ?? ORIGIN + '/index.html');
  }

  // Menú mínimo (sin barra). Sin menú no hay aceleradores nativos, así Ctrl+W llega a la página.
  Menu.setApplicationMenu(null);

  app.whenReady().then(() => {
    protocol.handle('app', serve);
    require('./folder.cjs').register(() => win);
    createWindow();
    require('./updater.cjs').register(() => win);
  });
  app.on('window-all-closed', () => app.quit());
}
