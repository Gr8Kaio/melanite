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

/**
 * El vault: árbol de archivos en memoria respaldado por IndexedDB.
 * El texto de los archivos de texto vive en memoria (lo necesitan la búsqueda y
 * la metadata); los binarios se leen bajo demanda.
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
    const now = Date.now();
    const row: FileRow = { id: uuid(), path, folder: 1, mtime: now, ctime: now, size: 0 };
    await this.db.files.add(row);
    const folder = new TFolder(this, path, row.id);
    this.attach(folder);
    this.trigger('create', folder);
    return folder;
  }

  async modify(file: TFile, data: string): Promise<void> {
    if (this.texts.get(file.id) === data) return;
    const mtime = Date.now();
    const size = enc.encode(data).length;
    await this.db.files.update(file.id, { text: data, mtime, size });
    this.texts.set(file.id, data);
    file.stat = { ...file.stat, mtime, size };
    this.trigger('modify', file);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    if (isTextPath(file.path)) return this.modify(file, new TextDecoder().decode(data));
    const mtime = Date.now();
    await this.db.transaction('rw', this.db.files, this.db.blobs, async () => {
      await this.db.files.update(file.id, { mtime, size: data.byteLength });
      await this.db.blobs.put({ id: file.id, data });
    });
    file.stat = { ...file.stat, mtime, size: data.byteLength };
    this.trigger('modify', file);
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

    const moved = [file, ...(file instanceof TFolder ? this.descendants(file) : [])];
    const mapPath = (p: string) => newPath + p.slice(oldPath.length);
    await this.db.transaction('rw', this.db.files, async () => {
      for (const f of moved) await this.db.files.update(this.idOf(f), { path: mapPath(f.path) });
    });

    this.detach(file);
    for (const f of moved) {
      this.byPath.delete(f.path);
      f._setPath(mapPath(f.path));
      this.byPath.set(f.path, f);
    }
    this.attach(file, false);
    this.trigger('rename', file, oldPath);
  }

  /** Borrado definitivo. */
  async delete(file: TAbstractFile): Promise<void> {
    if (file === this.root) return;
    const gone = [...(file instanceof TFolder ? this.descendants(file) : []), file];
    const ids = gone.map((f) => this.idOf(f));
    await this.db.transaction('rw', this.db.files, this.db.blobs, async () => {
      await this.db.files.bulkDelete(ids);
      await this.db.blobs.bulkDelete(ids);
    });
    this.detach(file);
    for (const f of gone) {
      this.byPath.delete(f.path);
      if (f instanceof TFile) this.texts.delete(f.id);
    }
    for (const f of gone) this.trigger('delete', f);
  }

  /** Mueve a la papelera del vault (.trash/), que se sincroniza como cualquier carpeta. */
  async trash(file: TAbstractFile): Promise<void> {
    if (file.path.startsWith('.trash/')) return this.delete(file);
    const name = file instanceof TFile ? file.basename : file.name;
    const ext = file instanceof TFile ? file.extension : '';
    await this.rename(file, this.getAvailablePath(joinPath('.trash', name), ext));
  }

  // ---------- interno ----------
  private idOf(f: TAbstractFile): string { return (f as TFile | TFolder).id; }

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
    const now = Date.now();
    const row: FileRow = { id: uuid(), path, folder: 0, mtime: now, ctime: now, size: 0, ...fields };
    await this.db.transaction('rw', this.db.files, this.db.blobs, async () => {
      await this.db.files.add(row);
      if (blob) await this.db.blobs.put({ id: row.id, data: blob });
    });
    const file = new TFile(this, row);
    if (row.text !== undefined) this.texts.set(file.id, row.text);
    this.attach(file);
    this.trigger('create', file);
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
      void this.db.files.put({ id: (parent as TFolder).id, path: parentPath, folder: 1, mtime: Date.now(), ctime: Date.now(), size: 0 });
    }
    f.parent = parent as TFolder;
    (parent as TFolder).children.push(f);
  }

  private detach(f: TAbstractFile) {
    if (f.parent) f.parent.children = f.parent.children.filter((c) => c !== f);
    f.parent = null;
  }
}
