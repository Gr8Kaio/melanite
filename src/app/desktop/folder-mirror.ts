import type { App } from '../app';
import { TFile, TFolder, type TAbstractFile } from '../../core/vault';
import { dirname, isTextPath, joinPath, stripExt, extname } from '../../core/path';
import { Notice } from '../ui/modal';
import { registerStrings, t } from '../i18n';

/**
 * Espejo vault ↔ carpeta real (solo en la app de escritorio).
 *
 * La base local sigue siendo la fuente que usa la sync; la carpeta es un espejo
 * en los dos sentidos:
 *  - lo que pasa en Melanite se escribe en el disco al instante;
 *  - lo que cambia en el disco desde afuera entra al vault (y de ahí a la sync).
 *
 * Reglas para no perder texto:
 *  - un cambio del disco cuyo contenido coincide con algo que escribimos nosotros
 *    hace poco es un eco y se ignora (si no, al tipear rápido el eco viejo pisaría lo nuevo);
 *  - si el disco y el vault cambiaron los dos desde la última vez, se guardan los dos
 *    (el del disco como copia "(conflicto …)");
 *  - borrar en el disco manda la nota a la papelera de Melanite, y borrar en Melanite
 *    manda el archivo a la papelera de Windows. Nada se borra en forma definitiva.
 */

export interface DesktopFolderApi {
  get(): Promise<string | null>;
  choose(): Promise<string | null>;
  clear(): Promise<void>;
  reveal(): Promise<void>;
  list(): Promise<{ path: string; dir: boolean; mtime?: number; size?: number }[]>;
  stat(rel: string): Promise<{ exists: boolean; dir?: boolean; mtime?: number; size?: number }>;
  read(rel: string): Promise<Uint8Array>;
  write(rel: string, data: string | Uint8Array): Promise<{ exists: boolean; mtime?: number; size?: number }>;
  mkdir(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  delete(rel: string): Promise<void>;
  onChanged(cb: (rel: string) => void): () => void;
}

export function desktopFolderApi(): DesktopFolderApi | null {
  return (globalThis as { melaniteDesktop?: { folder?: DesktopFolderApi } }).melaniteDesktop?.folder ?? null;
}

registerStrings({
  es: {
    'folder.tab': 'Carpeta del vault',
    'folder.desc': 'Guardá tus notas como archivos .md en una carpeta de Windows. Melanite la mantiene sincronizada en los dos sentidos: lo que cambies desde otros programas entra a Melanite.',
    'folder.current': 'Carpeta actual',
    'folder.none': 'Ninguna: las notas viven solo dentro de la app.',
    'folder.choose': 'Elegir carpeta…',
    'folder.change': 'Cambiar carpeta…',
    'folder.reveal': 'Abrir en el Explorador',
    'folder.stop': 'Dejar de usar la carpeta',
    'folder.stopConfirm': 'Melanite deja de escribir en la carpeta. Los archivos que ya están ahí no se borran.',
    'folder.syncing': 'Sincronizando con la carpeta…',
    'folder.done': 'Carpeta lista: {n} cambios aplicados.',
    'folder.error': 'Error con la carpeta del vault: {msg}',
    'folder.conflictSuffix': 'conflicto',
  },
  en: {
    'folder.tab': 'Vault folder',
    'folder.desc': 'Keep your notes as .md files in a Windows folder. Melanite keeps it in sync both ways: changes made by other programs come into Melanite.',
    'folder.current': 'Current folder',
    'folder.none': 'None: notes live only inside the app.',
    'folder.choose': 'Choose folder…',
    'folder.change': 'Change folder…',
    'folder.reveal': 'Show in Explorer',
    'folder.stop': 'Stop using the folder',
    'folder.stopConfirm': 'Melanite stops writing to the folder. Files already there are not deleted.',
    'folder.syncing': 'Syncing with the folder…',
    'folder.done': 'Folder ready: {n} changes applied.',
    'folder.error': 'Vault folder error: {msg}',
    'folder.conflictSuffix': 'conflict',
  },
});

interface IndexEntry { mtime: number; size: number; at: number }
const ECHO_MS = 10_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

async function digest(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', data as unknown as BufferSource);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export class FolderMirror {
  app: App;
  fs: DesktopFolderApi;
  root: string | null = null;
  private index: Record<string, IndexEntry> = {};
  private queue: Promise<unknown> = Promise.resolve();
  /** contenidos que escribimos al disco hace poco, por ruta (para reconocer ecos) */
  private recent = new Map<string, { hash: string; at: number }[]>();
  /** rutas que estamos aplicando desde el disco (sus eventos del vault no vuelven al disco) */
  private applying = new Set<string>();
  private pendingDeletes: string[] = [];
  private offWatch: (() => void) | null = null;
  private vaultRefs: ReturnType<App['vault']['on']>[] = [];

  constructor(app: App, fs: DesktopFolderApi) {
    this.app = app;
    this.fs = fs;
  }

  async start(): Promise<void> {
    this.root = await this.fs.get();
    if (!this.root) return;
    this.loadIndex();
    this.listen();
    await this.reconcile(false);
  }

  /** Cambia de carpeta (diálogo nativo) y mezcla su contenido con el vault. */
  async choose(): Promise<boolean> {
    const root = await this.fs.choose();
    if (!root) return false;
    this.stopListening();
    this.root = root;
    this.loadIndex();
    this.listen();
    await this.reconcile(true);
    return true;
  }

  async stop(): Promise<void> {
    this.stopListening();
    await this.fs.clear();
    this.root = null;
  }

  // ---------------------------------------------------------------- índice (por carpeta)

  private indexKey() { return `melanite:folder-index:${this.root}`; }
  private loadIndex() {
    try { this.index = JSON.parse(localStorage.getItem(this.indexKey()) ?? '{}'); } catch { this.index = {}; }
  }
  private saveTimer = 0;
  private saveIndex() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(this.indexKey(), JSON.stringify(this.index)); } catch { /* sin storage */ }
    }, 500);
  }

  // ---------------------------------------------------------------- utilidades

  /** Todas las operaciones de disco van en fila, en orden. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(fn);
    this.queue = next.catch((err) => { console.error('[melanite] carpeta', err); new Notice(t('folder.error', { msg: String((err as Error)?.message ?? err) })); });
    return next;
  }

  private async bytesOf(file: TFile): Promise<Uint8Array> {
    return isTextPath(file.path) ? enc.encode(this.app.vault.cachedReadSync(file)) : new Uint8Array(await this.app.vault.readBinary(file));
  }

  private async remember(path: string, data: Uint8Array) {
    const now = Date.now();
    const list = (this.recent.get(path) ?? []).filter((r) => now - r.at < ECHO_MS);
    list.push({ hash: await digest(data), at: now });
    this.recent.set(path, list.slice(-8));
  }

  private async isEcho(path: string, data: Uint8Array): Promise<boolean> {
    const list = this.recent.get(path);
    if (!list?.length) return false;
    const h = await digest(data);
    return list.some((r) => r.hash === h && Date.now() - r.at < ECHO_MS);
  }

  private async writeDisk(path: string, data: Uint8Array) {
    await this.remember(path, data);
    const st = await this.fs.write(path, isTextPath(path) ? dec.decode(data) : data);
    if (st.exists) this.index[path] = { mtime: st.mtime!, size: st.size!, at: Date.now() };
    this.saveIndex();
  }

  private async withApplying<T>(path: string, fn: () => Promise<T>): Promise<T> {
    this.applying.add(path);
    try { return await fn(); } finally { setTimeout(() => this.applying.delete(path), 0); }
  }

  private async importToVault(path: string, data: Uint8Array): Promise<void> {
    const vault = this.app.vault;
    const existing = vault.getFileByPath(path);
    await this.withApplying(path, async () => {
      if (existing) {
        if (isTextPath(path)) await vault.modify(existing, dec.decode(data));
        else await vault.modifyBinary(existing, data.slice().buffer);
      } else if (isTextPath(path)) await vault.create(path, dec.decode(data));
      else await vault.createBinary(path, data.slice().buffer);
    });
  }

  /** Copia "(conflicto AAAA-MM-DD)" en el vault y en el disco. */
  private async saveConflictCopy(path: string, data: Uint8Array): Promise<void> {
    const ext = extname(path);
    const base = `${stripExt(path)} (${t('folder.conflictSuffix')} ${new Date().toISOString().slice(0, 10)})`;
    const copy = this.app.vault.getAvailablePath(base, ext);
    await this.importToVault(copy, data);
    await this.writeDisk(copy, data);
  }

  // ---------------------------------------------------------------- reconciliación completa

  private async reconcile(firstTime: boolean): Promise<void> {
    const notice = new Notice(t('folder.syncing'), 0);
    let changes = 0;
    try {
      await this.enqueue(async () => {
        const vault = this.app.vault;
        const disk = await this.fs.list();
        const onDisk = new Map(disk.map((e) => [e.path, e]));

        // disco → vault (carpetas primero, por orden de profundidad)
        disk.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
        for (const e of disk) {
          if (e.dir) {
            if (!vault.getAbstractFileByPath(e.path)) { await this.withApplying(e.path, () => vault.createFolder(e.path)); changes++; }
            continue;
          }
          const file = vault.getFileByPath(e.path);
          const known = this.index[e.path];
          if (!file) {
            // está en el disco y no en el vault: entra (nunca se borra del disco por esto)
            await this.importToVault(e.path, await this.fs.read(e.path));
            this.index[e.path] = { mtime: e.mtime!, size: e.size!, at: Date.now() };
            changes++;
            continue;
          }
          const diskData = await this.fs.read(e.path);
          const vaultData = await this.bytesOf(file);
          if (sameBytes(diskData, vaultData)) { this.index[e.path] = { mtime: e.mtime!, size: e.size!, at: Date.now() }; continue; }
          const diskChanged = !known || known.mtime !== e.mtime || known.size !== e.size;
          const vaultChanged = !known || file.stat.mtime > known.at;
          if (diskChanged && vaultChanged) {
            // los dos cambiaron (o es la primera vez que se juntan): el vault queda, el disco va como copia
            await this.saveConflictCopy(e.path, diskData);
            await this.writeDisk(e.path, vaultData);
          } else if (diskChanged) {
            await this.importToVault(e.path, diskData);
            this.index[e.path] = { mtime: e.mtime!, size: e.size!, at: Date.now() };
          } else {
            await this.writeDisk(e.path, vaultData);
          }
          changes++;
        }

        // vault → disco
        const all = vault.getAllLoadedFiles().filter((f) => f.path).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
        for (const f of all) {
          if (onDisk.has(f.path) || !vault.getAbstractFileByPath(f.path)) continue;
          if (!firstTime && this.index[f.path] && f instanceof TFile && f.stat.mtime <= this.index[f.path].at) {
            // estaba en el disco y alguien lo borró con la app cerrada: a la papelera de Melanite
            await this.withApplying(f.path, () => vault.trash(f));
            delete this.index[f.path];
          } else if (f instanceof TFolder) {
            await this.fs.mkdir(f.path);
          } else if (f instanceof TFile) {
            await this.writeDisk(f.path, await this.bytesOf(f));
          }
          changes++;
        }
        this.saveIndex();
      });
      new Notice(t('folder.done', { n: changes }));
    } finally {
      notice.hide();
    }
  }

  // ---------------------------------------------------------------- en vivo

  private listen(): void {
    const vault = this.app.vault;
    this.vaultRefs = [
      vault.on('create', (f: TAbstractFile) => this.onVaultWrite(f)),
      vault.on('modify', (f: TAbstractFile) => this.onVaultWrite(f)),
      vault.on('rename', (f: TAbstractFile, oldPath: string) => this.onVaultRename(f, oldPath)),
      vault.on('delete', (f: TAbstractFile) => this.onVaultDelete(f)),
    ];
    this.offWatch = this.fs.onChanged((rel) => void this.onDiskChange(rel));
  }

  private stopListening(): void {
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    this.vaultRefs = [];
    this.offWatch?.();
    this.offWatch = null;
  }

  private onVaultWrite(f: TAbstractFile) {
    if (this.applying.has(f.path)) return;
    const path = f.path;
    void this.enqueue(async () => {
      const cur = this.app.vault.getAbstractFileByPath(path);
      if (cur instanceof TFolder) await this.fs.mkdir(path);
      else if (cur instanceof TFile) await this.writeDisk(path, await this.bytesOf(cur));
    });
  }

  private onVaultRename(f: TAbstractFile, oldPath: string) {
    if (this.applying.has(f.path)) return;
    const newPath = f.path;
    void this.enqueue(async () => {
      await this.fs.rename(oldPath, newPath);
      for (const key of Object.keys(this.index)) {
        if (key === oldPath || key.startsWith(oldPath + '/')) {
          this.index[newPath + key.slice(oldPath.length)] = this.index[key];
          delete this.index[key];
        }
      }
      this.saveIndex();
    });
  }

  /** Los borrados llegan uno por archivo: se agrupan y se manda a la papelera solo lo de más arriba. */
  private onVaultDelete(f: TAbstractFile) {
    if (this.applying.has(f.path)) return;
    this.pendingDeletes.push(f.path);
    queueMicrotask(() => {
      const paths = this.pendingDeletes.splice(0);
      if (!paths.length) return;
      const top = paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(q + '/')));
      void this.enqueue(async () => {
        for (const p of top) await this.fs.delete(p);
        for (const key of Object.keys(this.index)) if (paths.includes(key)) delete this.index[key];
        this.saveIndex();
      });
    });
  }

  private async onDiskChange(rel: string): Promise<void> {
    await this.enqueue(async () => {
      const vault = this.app.vault;
      const st = await this.fs.stat(rel);
      const current = vault.getAbstractFileByPath(rel);
      if (!st.exists) {
        // borrado o movido desde afuera: a la papelera de Melanite (recuperable)
        if (current && !rel.startsWith('.trash/') && this.index[rel]) {
          await this.withApplying(rel, () => vault.trash(current));
        }
        delete this.index[rel];
        this.saveIndex();
        return;
      }
      if (st.dir) {
        if (!current) await this.withApplying(rel, () => vault.createFolder(rel));
        return;
      }
      const data = await this.fs.read(rel);
      if (await this.isEcho(rel, data)) return; // lo escribimos nosotros
      if (current instanceof TFile && sameBytes(data, await this.bytesOf(current))) {
        this.index[rel] = { mtime: st.mtime!, size: st.size!, at: Date.now() };
        this.saveIndex();
        return;
      }
      if (dirname(rel) && !vault.getAbstractFileByPath(dirname(rel))) await this.withApplying(dirname(rel), () => vault.createFolder(dirname(rel)));
      await this.importToVault(rel, data);
      this.index[rel] = { mtime: st.mtime!, size: st.size!, at: Date.now() };
      this.saveIndex();
    });
  }
}

export { joinPath };
