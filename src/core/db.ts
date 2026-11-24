import Dexie, { type Table } from 'dexie';

export interface FileRow {
  id: string;
  path: string;
  folder: 0 | 1;
  /** contenido de archivos de texto; los binarios van en la tabla blobs */
  text?: string;
  mtime: number;
  ctime: number;
  size: number;
  // ---- sync (v2). Solo los escribe el vault (dirty) y el motor de sync (el resto).
  /** 0 = igual al servidor; >0 = sello del último cambio local sin subir */
  dirty?: number;
  /** lo que tenía el servidor la última vez que coincidimos (sin definir = nunca se subió) */
  baseVersion?: number;
  baseHash?: string;
  basePath?: string;
  /** binario remoto que todavía no se bajó (storage_key) */
  blobKey?: string;
}
export interface BlobRow { id: string; data: ArrayBuffer }
export interface KVRow { key: string; value: unknown }
/** Archivo borrado del vault cuya baja todavía no confirmó el servidor. */
export interface TombstoneRow {
  id: string;
  path: string;
  folder: 0 | 1;
  binary: 0 | 1;
  baseVersion?: number;
  baseHash?: string;
}

export class MelaniteDB extends Dexie {
  files!: Table<FileRow, string>;
  blobs!: Table<BlobRow, string>;
  kv!: Table<KVRow, string>;
  tombstones!: Table<TombstoneRow, string>;

  constructor(name = 'melanite') {
    super(name);
    this.version(1).stores({ files: 'id, &path', blobs: 'id', kv: 'key' });
    // v2 (sync): índices de pendientes y de binarios sin bajar, y tombstones. Lo que había en v1 nunca se subió: queda pendiente.
    this.version(2)
      .stores({ files: 'id, &path, dirty, blobKey', tombstones: 'id' })
      .upgrade((tx) => tx.table('files').toCollection().modify((r: FileRow) => { r.dirty = 1; }));
  }
}
