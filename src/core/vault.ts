import { Events } from './events';
import type { FileRow, MelaniteDB } from './db';
import { basename, dirname, extname, isTextPath, joinPath, normalizePath, stripExt } from './path';

export interface FileStats { ctime: number; mtime: number; size: number }

export abstract class TAbstractFile {
  vault: Vault;
  path: string;
  name: string;
  parent: TFolder | null = null;
  constructor(vault: Vault, path: string) {
    this.vault = vault;
    this.path = path;
    this.name = basename(path);
  }
  /** @internal */ _setPath(path: string) { this.path = path; this.name = basename(path); }
}

export class TFile extends TAbstractFile {
  id: string;
  stat: FileStats;
  constructor(vault: Vault, row: FileRow) {
    super(vault, row.path);
    this.id = row.id;
    this.stat = { ctime: row.ctime, mtime: row.mtime, size: row.size };
  }
  get basename() { return stripExt(this.name); }
  get extension() { return extname(this.name); }
}

export class TFolder extends TAbstractFile {
  id: string;
  children: TAbstractFile[] = [];
  constructor(vault: Vault, path: string, id: string) {
    super(vault, path);
    this.id = id;
  }
  isRoot() { return this.path === ''; }
}

const uuid = () => crypto.randomUUID();
const enc = new TextEncoder();

let lastStamp = 0;
/** Sello creciente de cambio local: `dirty` > 0 = pendiente de subir (sync compara sellos para no perder cambios). */
export const stamp = () => (lastStamp = Math.max(lastStamp + 1, Date.now()));

/** Cambio que llega del servidor (lo arma el motor de sync). */
export interface RemoteChange {
  id: string;
  /** entidad local que pasa a tener el id `id` (unificar con el servidor) */
  fromId?: string;
  path: string;
  folder: boolean;
  deleted: boolean;
  /** texto nuevo; sin definir = no tocar el contenido */
  text?: string;
  /** binario nuevo; sin definir = no tocar */
  data?: ArrayBuffer;
  /** binario que falta bajar; null = ya está */
  blobKey?: string | null;
  /** nueva base (lo que tiene el servidor); sin definir = no tocar */
  base?: { version: number; hash: string; path: string };
  /** true = queda pendiente de subir; sin definir = no tocar */
  dirty?: boolean;
}

/**
 * El vault: árbol de archivos en memoria respaldado por IndexedDB.
 * El texto de los archivos de texto vive en memoria (lo necesitan la búsqueda y
 * la metadata); los binarios se leen bajo demanda.
 *
 * Cada escritura actualiza la memoria en el mismo tick en que lanza la
 * transacción de IndexedDB (y recién después espera): así la memoria siempre
 * refleja las escrituras en el orden en que la base las va a aplicar, y
 * `applyRemote` puede comprobar y escribir sin carreras con el editor.
 * Toda escritura local marca la fila `dirty`; borrar deja un tombstone.
 *
 * Eventos: create(file), modify(file), delete(file), rename(file, oldPath).
 */
export class Vault extends Events {
  readonly db: MelaniteDB;
  private root: TFolder;
  private byPath = new Map<string, TAbstractFile>();
  private texts = new Map<string, string>();

  private constructor(db: MelaniteDB) {
    super();
    this.db = db;
    this.root = new TFolder(this, '', 'root');
    this.root.name = '';
    this.byPath.set('', this.root);
  }

  static async open(db: MelaniteDB): Promise<Vault> {
    const v = new Vault(db);
    const rows = await db.files.toArray();
    rows.sort((a, b) => a.path.length - b.path.length);
    for (const row of rows) {
      if (row.folder) v.attach(new TFolder(v, row.path, row.id));
      else {
        v.attach(new TFile(v, row));
        if (row.text !== undefined) v.texts.set(row.id, row.text);
      }
    }
    return v;
  }

  // ---------- consultas ----------
  getRoot() { return this.root; }
  getName() { return 'Melanite'; }
  getAbstractFileByPath(path: string): TAbstractFile | null { return this.byPath.get(normalizePath(path)) ?? null; }
  getFileByPath(path: string): TFile | null {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }
  getFolderByPath(path: string): TFolder | null {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }
  getAllLoadedFiles(): TAbstractFile[] { return [...this.byPath.values()]; }
  // ponytail: recorre todo el vault (O(n)); un Map por id si la sync de vaults grandes se pone lenta
  /** Archivo o carpeta por id (lo usa la sync). */
  getById(id: string): TAbstractFile | null {
    for (const f of this.byPath.values()) if (f !== this.root && this.idOf(f) === id) return f;
    return null;
  }
  getFiles(): TFile[] { return [...this.byPath.values()].filter((f): f is TFile => f instanceof TFile); }
  getMarkdownFiles(): TFile[] { return this.getFiles().filter((f) => f.extension === 'md'); }

  async read(file: TFile): Promise<string> { return this.cachedReadSync(file); }
  async cachedRead(file: TFile): Promise<string> { return this.cachedReadSync(file); }
  /** Lectura sincrónica del texto en memoria (extensión de Melanite). */
  cachedReadSync(file: TFile): string { return this.texts.get(file.id) ?? ''; }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    if (isTextPath(file.path)) return enc.encode(this.cachedReadSync(file)).buffer as ArrayBuffer;
    return (await this.db.blobs.get(file.id))?.data ?? new ArrayBuffer(0);
  }

  /** Primera ruta libre: "Sin título.md", "Sin título 1.md", … */
  getAvailablePath(base: string, ext: string): string {
    base = normalizePath(base);
    const suffix = ext ? `.${ext}` : '';
    let p = base + suffix;
    for (let i = 1; this.byPath.has(p); i++) p = `${base} ${i}${suffix}`;
    return p;
  }

  // ---------- escritura ----------
  async create(path: string, data: string): Promise<TFile> {
    return this.createRow(path, { text: data, size: enc.encode(data).length });
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    if (isTextPath(path)) return this.create(path, new TextDecoder().decode(data));
    return this.createRow(path, { size: data.byteLength }, data);
  }

  async createFolder(path: string): Promise<TFolder> {
    path = normalizePath(path);
    const existing = this.byPath.get(path);
    if (existing instanceof TFolder) return existing;
    if (existing) throw new Error(`Ya existe un archivo en ${path}`);
    if (dirname(path)) await this.createFolder(dirname(path));
    const again = this.byPath.get(path); // pudo aparecer mientras esperábamos (sync)
    if (again instanceof TFolder) return again;
    if (again) throw new Error(`Ya existe un archivo en ${path}`);
    const now = Date.now();
    const row: FileRow = { id: uuid(), path, folder: 1, mtime: now, ctime: now, size: 0, dirty: stamp() };
    const folder = new TFolder(this, path, row.id);
    this.attach(folder);
    const saved = this.db.files.add(row);
    this.trigger('create', folder);
    await saved;
    return folder;
  }

  async modify(file: TFile, data: string): Promise<void> {
    if (this.texts.get(file.id) === data) return;
    const mtime = Date.now();
    const size = enc.encode(data).length;
    this.texts.set(file.id, data);
    file.stat = { ...file.stat, mtime, size };
    const saved = this.db.files.update(file.id, { text: data, mtime, size, dirty: stamp() });
    this.trigger('modify', file);
    await saved;
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    if (isTextPath(file.path)) return this.modify(file, new TextDecoder().decode(data));
    const mtime = Date.now();
    file.stat = { ...file.stat, mtime, size: data.byteLength };
    const saved = this.db.transaction('rw', this.db.files, this.db.blobs, async () => {
      await this.db.files.update(file.id, { mtime, size: data.byteLength, dirty: stamp(), blobKey: undefined });
      await this.db.blobs.put({ id: file.id, data });
    });
    this.trigger('modify', file);
    await saved;
  }

  async append(file: TFile, data: string): Promise<void> { await this.modify(file, this.cachedReadSync(file) + data); }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const out = fn(this.cachedReadSync(file));
    await this.modify(file, out);
    return out;
  }

  /** Renombra o mueve un archivo o carpeta (con todo su contenido). */
  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    newPath = normalizePath(newPath);
    const oldPath = file.path;
    if (newPath === oldPath) return;
    if (file === this.root) throw new Error('No se puede renombrar la raíz');
    if (this.byPath.has(newPath) && this.byPath.get(newPath) !== file) throw new Error(`Ya existe ${newPath}`);
    if (file instanceof TFolder && (newPath + '/').startsWith(oldPath + '/')) throw new Error('No se puede mover una carpeta dentro de sí misma');
    if (dirname(newPath)) await this.createFolder(dirname(newPath));
    if (file.path !== oldPath || (this.byPath.has(newPath) && this.byPath.get(newPath) !== file)) throw new Error(`Ya existe ${newPath}`);

    const moved = this.move(file, newPath);
    const s = stamp();
    const saved = this.db.transaction('rw', this.db.files, async () => {
      for (const [id, path] of moved) await this.db.files.update(id, { path, dirty: s });
    });
    this.trigger('rename', file, oldPath);
    await saved;
  }

  /** Borrado definitivo (deja un tombstone para que la sync lo borre también en el servidor). */
  async delete(file: TAbstractFile): Promise<void> {
    if (file === this.root) return;
    const gone = [...(file instanceof TFolder ? this.descendants(file) : []), file];
    const ids = gone.map((f) => this.idOf(f));
    this.detach(file);
    for (const f of gone) {
      this.byPath.delete(f.path);
      if (f instanceof TFile) this.texts.delete(f.id);
    }
    const saved = this.db.transaction('rw', this.db.files, this.db.blobs, this.db.tombstones, async () => {
      const rows = (await this.db.files.bulkGet(ids)).filter((r): r is FileRow => !!r);
      await this.db.tombstones.bulkPut(rows.map((r) => ({
        id: r.id, path: r.path, folder: r.folder, binary: r.folder || r.text !== undefined ? 0 : 1, baseVersion: r.baseVersion, baseHash: r.baseHash,
      })));
      await this.db.files.bulkDelete(ids);
      await this.db.blobs.bulkDelete(ids);
    });
    for (const f of gone) this.trigger('delete', f);
    await saved;
  }

  /** Mueve a la papelera del vault (.trash/), que se sincroniza como cualquier carpeta. */
  async trash(file: TAbstractFile): Promise<void> {
    if (file.path.startsWith('.trash/')) return this.delete(file);
    const name = file instanceof TFile ? file.basename : file.name;
    const ext = file instanceof TFile ? file.extension : '';
    await this.rename(file, this.getAvailablePath(joinPath('.trash', name), ext));
  }

  // ---------- sync ----------
  /**
   * Aplica un cambio del servidor sin marcarlo como local (dirty según `c.dirty`)
   * y emite los mismos eventos que una escritura local. Antes de tocar nada llama
   * a `guard` (sincrónico): si devuelve false, o si la ruta está ocupada por otro,
   * no hace nada y devuelve false (la sync reintenta). Entre el guard y la
   * actualización de memoria no se cede el control.
   */
  async applyRemote(c: RemoteChange, guard?: () => boolean): Promise<boolean> {
    const path = normalizePath(c.path);
    if (!c.deleted && dirname(path)) await this.createFolder(dirname(path));
    if (guard && !guard()) return false;
    const cur = this.getById(c.fromId ?? c.id);
    if (c.fromId && c.fromId !== c.id && this.getById(c.id)) return false;
    const at = this.byPath.get(path);
    if (!c.deleted && at && at !== cur) return false;

    const fields: Partial<FileRow> = {};
    if (c.base) Object.assign(fields, { baseVersion: c.base.version, baseHash: c.base.hash, basePath: c.base.path });
    if (c.dirty !== undefined) fields.dirty = c.dirty ? stamp() : 0;
    if (c.blobKey !== undefined) fields.blobKey = c.blobKey ?? undefined;
    const { files, blobs, tombstones } = this.db;
    let saved: Promise<unknown>;
    const events: [string, ...unknown[]][] = [];

    if (c.deleted) {
      if (!cur) saved = tombstones.delete(c.id);
      else {
        if (cur instanceof TFolder && cur.children.length) return false;
        this.detach(cur);
        this.byPath.delete(cur.path);
        this.texts.delete(c.id);
        saved = this.db.transaction('rw', files, blobs, tombstones, async () => {
          await files.delete(c.id);
          await blobs.delete(c.id);
          await tombstones.delete(c.id);
        });
        events.push(['delete', cur]);
      }
    } else if (!cur) {
      const now = Date.now();
      const row: FileRow = { id: c.id, path, folder: c.folder ? 1 : 0, mtime: now, ctime: now, size: 0, dirty: 0, ...fields };
      if (!c.folder && c.text !== undefined) { row.text = c.text; row.size = enc.encode(c.text).length; }
      if (!c.folder && c.data) row.size = c.data.byteLength;
      const f = c.folder ? new TFolder(this, path, c.id) : new TFile(this, row);
      if (row.text !== undefined) this.texts.set(c.id, row.text);
      this.attach(f);
      saved = this.db.transaction('rw', files, blobs, tombstones, async () => {
        await files.put(row);
        if (c.data) await blobs.put({ id: c.id, data: c.data });
        await tombstones.delete(c.id);
      });
      events.push(['create', f]);
    } else {
      const oldId = this.idOf(cur);
      if (oldId !== c.id) {
        (cur as TFile | TFolder).id = c.id;
        const text = this.texts.get(oldId);
        this.texts.delete(oldId);
        if (text !== undefined) this.texts.set(c.id, text);
      }
      const oldPath = cur.path;
      const moved = path !== oldPath ? this.move(cur, path) : [];
      let changed = false;
      if (cur instanceof TFile) {
        if (c.text !== undefined && c.text !== this.texts.get(c.id)) {
          this.texts.set(c.id, c.text);
          Object.assign(fields, { text: c.text, size: enc.encode(c.text).length });
          changed = true;
        }
        if (c.data) { fields.size = c.data.byteLength; changed = true; }
        if (changed) { fields.mtime = Date.now(); cur.stat = { ...cur.stat, mtime: fields.mtime, size: fields.size ?? cur.stat.size }; }
      }
      saved = this.db.transaction('rw', files, blobs, tombstones, async () => {
        if (oldId !== c.id) {
          const old = await files.get(oldId);
          const blob = await blobs.get(oldId);
          await files.delete(oldId);
          await blobs.delete(oldId);
          if (old) await files.add({ ...old, id: c.id });
          if (blob) await blobs.put({ id: c.id, data: blob.data });
        }
        for (const [id, p] of moved) if (id !== c.id) await files.update(id, { path: p });
        await files.update(c.id, { ...fields, path });
        if (c.data) await blobs.put({ id: c.id, data: c.data });
        await tombstones.delete(c.id);
      });
      if (moved.length) events.push(['rename', cur, oldPath]);
      if (changed) events.push(['modify', cur]);
    }
    for (const [name, ...args] of events) this.trigger(name, ...args);
    await saved;
    return true;
  }

  // ---------- interno ----------
  private idOf(f: TAbstractFile): string { return (f as TFile | TFolder).id; }

  /** Mueve en memoria (con todo el contenido si es carpeta). Devuelve [id, ruta nueva] de cada uno. */
  private move(file: TAbstractFile, newPath: string): [string, string][] {
    const oldPath = file.path;
    const moved = [file, ...(file instanceof TFolder ? this.descendants(file) : [])];
    this.detach(file);
    for (const f of moved) {
      this.byPath.delete(f.path);
      f._setPath(newPath + f.path.slice(oldPath.length));
      this.byPath.set(f.path, f);
    }
    this.attach(file, false);
    return moved.map((f) => [this.idOf(f), f.path]);
  }

  private descendants(folder: TFolder): TAbstractFile[] {
    const out: TAbstractFile[] = [];
    for (const c of folder.children) {
      out.push(c);
      if (c instanceof TFolder) out.push(...this.descendants(c));
    }
    return out;
  }

  private async createRow(path: string, fields: Partial<FileRow>, blob?: ArrayBuffer): Promise<TFile> {
    path = normalizePath(path);
    if (!path) throw new Error('Ruta vacía');
    if (this.byPath.has(path)) throw new Error(`Ya existe ${path}`);
    if (dirname(path)) await this.createFolder(dirname(path));
    if (this.byPath.has(path)) throw new Error(`Ya existe ${path}`);
    const now = Date.now();
    const row: FileRow = { id: uuid(), path, folder: 0, mtime: now, ctime: now, size: 0, ...fields, dirty: stamp() };
    const file = new TFile(this, row);
    if (row.text !== undefined) this.texts.set(file.id, row.text);
    this.attach(file);
    const saved = this.db.transaction('rw', this.db.files, this.db.blobs, async () => {
      await this.db.files.add(row);
      if (blob) await this.db.blobs.put({ id: row.id, data: blob });
    });
    this.trigger('create', file);
    await saved;
    return file;
  }

  /** Cuelga el archivo de su carpeta padre (creándola en memoria si falta). */
  private attach(f: TAbstractFile, register = true) {
    if (register) this.byPath.set(f.path, f);
    const parentPath = dirname(f.path);
    let parent = this.byPath.get(parentPath);
    if (!(parent instanceof TFolder)) {
      // fila huérfana (no debería pasar): reconstruimos la carpeta en memoria
      parent = new TFolder(this, parentPath, uuid());
      this.attach(parent);
      void this.db.files.put({ id: (parent as TFolder).id, path: parentPath, folder: 1, mtime: Date.now(), ctime: Date.now(), size: 0, dirty: stamp() });
    }
    f.parent = parent as TFolder;
    (parent as TFolder).children.push(f);
  }

  private detach(f: TAbstractFile) {
    if (f.parent) f.parent.children = f.parent.children.filter((c) => c !== f);
    f.parent = null;
  }
}
