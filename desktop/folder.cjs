// Carpeta real del vault (solo escritorio): el proceso principal es el único que toca el disco,
// y solo adentro de la carpeta que eligió el usuario con el diálogo nativo.
const { app, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const configFile = () => path.join(app.getPath('userData'), 'vault-folder.json');
let root = null;
let watcher = null;
let getWin = () => null;
const pending = new Map(); // ruta relativa → timer (debounce de eventos del watcher)

function loadRoot() {
  try {
    const r = JSON.parse(fs.readFileSync(configFile(), 'utf8')).root;
    return r && fs.existsSync(r) && fs.statSync(r).isDirectory() ? r : null;
  } catch { return null; }
}

function saveRoot(r) {
  try { fs.writeFileSync(configFile(), JSON.stringify({ root: r })); } catch { /* no crítico */ }
}

/** Ruta relativa del vault ("a/b.md") → ruta absoluta, siempre dentro de root. */
function resolve(rel) {
  if (!root) throw new Error('No hay carpeta elegida');
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('Ruta inválida');
  const abs = path.resolve(root, ...rel.split('/'));
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Ruta fuera de la carpeta del vault');
  return abs;
}

const toRel = (abs) => path.relative(root, abs).split(path.sep).join('/');
const IGNORED = /(^|\/)(\.git|\.obsidian|node_modules|\.DS_Store|desktop\.ini|Thumbs\.db)(\/|$)|\.melanite-tmp$/;

async function walk(dir, out) {
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = toRel(abs);
    if (IGNORED.test(rel) || ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) { out.push({ path: rel, dir: true }); await walk(abs, out); }
    else if (ent.isFile()) {
      const st = await fsp.stat(abs);
      out.push({ path: rel, dir: false, mtime: st.mtimeMs, size: st.size });
    }
  }
  return out;
}

function startWatch() {
  stopWatch();
  if (!root) return;
  try {
    // Windows y macOS soportan recursive; los eventos se agrupan por archivo
    watcher = fs.watch(root, { recursive: true }, (_type, name) => {
      if (!name) return;
      const rel = String(name).split(path.sep).join('/');
      if (IGNORED.test(rel)) return;
      clearTimeout(pending.get(rel));
      pending.set(rel, setTimeout(() => {
        pending.delete(rel);
        getWin()?.webContents.send('folder:changed', rel);
      }, 250));
    });
    watcher.on('error', () => stopWatch());
  } catch { watcher = null; }
}

function stopWatch() {
  watcher?.close();
  watcher = null;
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}

async function statRel(rel) {
  try {
    const st = await fsp.stat(resolve(rel));
    return { exists: true, dir: st.isDirectory(), mtime: st.mtimeMs, size: st.size };
  } catch { return { exists: false }; }
}

function register(winGetter) {
  getWin = winGetter;
  // MELANITE_VAULT_DIR: fija la carpeta sin el diálogo (lo usan los tests de escritorio)
  const fromEnv = process.env.MELANITE_VAULT_DIR;
  if (fromEnv && fs.existsSync(fromEnv)) saveRoot(fromEnv);
  root = loadRoot();
  startWatch();

  ipcMain.handle('folder:get', () => root);
  ipcMain.handle('folder:choose', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'], title: 'Melanite' });
    if (r.canceled || !r.filePaths[0]) return null;
    root = r.filePaths[0];
    saveRoot(root);
    startWatch();
    return root;
  });
  ipcMain.handle('folder:clear', () => { root = null; saveRoot(null); stopWatch(); });
  ipcMain.handle('folder:reveal', () => { if (root) void shell.openPath(root); });
  ipcMain.handle('folder:list', async () => (root ? walk(root, []) : []));
  ipcMain.handle('folder:stat', (_e, rel) => statRel(rel));
  ipcMain.handle('folder:read', async (_e, rel) => new Uint8Array(await fsp.readFile(resolve(rel))));
  ipcMain.handle('folder:write', async (_e, rel, data) => {
    const abs = resolve(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    // escritura atómica: un corte a mitad nunca deja la nota truncada
    const tmp = `${abs}.melanite-tmp`;
    await fsp.writeFile(tmp, typeof data === 'string' ? data : Buffer.from(data));
    await fsp.rename(tmp, abs);
    return statRel(rel);
  });
  ipcMain.handle('folder:mkdir', async (_e, rel) => { await fsp.mkdir(resolve(rel), { recursive: true }); });
  ipcMain.handle('folder:rename', async (_e, from, to) => {
    const a = resolve(from), b = resolve(to);
    if (!fs.existsSync(a)) return;
    await fsp.mkdir(path.dirname(b), { recursive: true });
    await fsp.rename(a, b);
  });
  // borrar = papelera de Windows (recuperable), nunca borrado definitivo
  ipcMain.handle('folder:delete', async (_e, rel) => {
    const abs = resolve(rel);
    if (fs.existsSync(abs)) await shell.trashItem(abs);
  });
}

module.exports = { register };
