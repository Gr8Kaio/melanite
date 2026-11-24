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
}
export interface BlobRow { id: string; data: ArrayBuffer }
export interface KVRow { key: string; value: unknown }

export class MelaniteDB extends Dexie {
  files!: Table<FileRow, string>;
  blobs!: Table<BlobRow, string>;
  kv!: Table<KVRow, string>;

  constructor(name = 'melanite') {
    super(name);
    this.version(1).stores({ files: 'id, &path', blobs: 'id', kv: 'key' });
  }
}
