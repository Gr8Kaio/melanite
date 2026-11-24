import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { MelaniteDB } from '../../src/core/db';
import { TFile, TFolder, Vault } from '../../src/core/vault';
import { SyncEngine, type SyncHooks } from '../../src/core/sync/engine';
import { conflictPath, decide, decideCollision, localDate, type LocalView, type RemoteView } from '../../src/core/sync/decide';
import { sha256 } from '../../src/core/sync/hash';
import type { PushArgs, PushResult, Remote, RemoteRow } from '../../src/core/sync/remote';

// ---------------------------------------------------------------- servidor falso (misma semántica que supabase/schema.sql)

interface Row extends RemoteRow { user_id: string }

class FakeServer {
  rows = new Map<string, Row>();
  blobs = new Map<string, ArrayBuffer>();
  private seq = 0;
  offline = false;
  /** el próximo push se escribe en el servidor pero la respuesta se pierde */
  loseNextResponse = false;

  private nextSeq() { this.seq += 3; return this.seq; } // la secuencia es global (otros usuarios): siempre con saltos

  pushFile(uid: string, a: PushArgs): PushResult {
    const strip = (r: Row | undefined): RemoteRow | null => { if (!r) return null; const { user_id: _u, ...rest } = r; return { ...rest }; };
    const cur = this.get(a.id, uid);
    if (cur && cur.version !== a.base_version) return { status: 'conflict', row: strip(cur) };
    if (!cur && a.deleted) return { status: 'ok', row: null };
    if (!a.deleted) {
      const holder = [...this.rows.values()].find((r) => r.user_id === uid && !r.deleted && r.path === a.path && r.id !== a.id);
      if (holder) return { status: 'path_taken', row: strip(holder) };
    }
    const row: Row = cur
      ? {
        ...cur, path: a.path, kind: a.deleted ? cur.kind : a.kind, content: a.deleted ? null : a.content,
        storage_key: a.deleted ? null : a.storage_key, hash: a.deleted ? null : a.hash, deleted: a.deleted,
        version: cur.version + 1, seq: this.nextSeq(), device_id: a.device_id,
      }
      : { id: a.id, user_id: uid, path: a.path, kind: a.kind, content: a.content, storage_key: a.storage_key, hash: a.hash, version: 1, deleted: false, seq: this.nextSeq(), device_id: a.device_id };
    this.rows.set(`${uid}:${a.id}`, row);
    return { status: 'ok', row: strip(row) };
  }

  remote(uid = 'user-1'): Remote {
    const net = () => { if (this.offline) throw new TypeError('Failed to fetch'); };
    return {
      userId: uid,
      pull: async (after, limit) => {
        net();
        return [...this.rows.values()].filter((r) => r.user_id === uid && r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit)
          .map(({ user_id: _u, ...r }) => ({ ...r }));
      },
      push: async (a) => {
        net();
        const res = this.pushFile(uid, a);
        if (this.loseNextResponse) { this.loseNextResponse = false; throw new TypeError('Failed to fetch'); }
        return res;
      },
      upload: async (key, data) => { net(); this.blobs.set(key, data.slice(0)); },
      download: async (key) => { net(); return this.blobs.get(key)?.slice(0) ?? null; },
      remove: async (keys) => { net(); for (const k of keys) this.blobs.delete(k); },
      subscribe: () => () => {},
    };
  }

  get(id: string, uid = 'user-1') { return this.rows.get(`${uid}:${id}`); }
  alive() { return [...this.rows.values()].filter((r) => !r.deleted); }
  byPath(path: string) { return this.alive().find((r) => r.path === path); }
}

// ---------------------------------------------------------------- dispositivos

let n = 0;
interface Device { name: string; vault: Vault; sync: SyncEngine; db: MelaniteDB }
const opened: Device[] = [];

async function device(server: FakeServer, name: string, opts: { hooks?: SyncHooks; db?: MelaniteDB; uid?: string; connect?: boolean } = {}): Promise<Device> {
  const db = opts.db ?? new MelaniteDB(`sync-${name}-${++n}`);
  const vault = await Vault.open(db);
  const sync = new SyncEngine(vault, opts.hooks);
  if (opts.connect !== false) await sync.connect(server.remote(opts.uid), false);
  const d = { name, vault, sync, db };
  opened.push(d);
  return d;
}

/** Sincroniza todos varias veces (como pasaría con el tiempo). */
async function converge(...devs: Device[]) {
  for (let i = 0; i < 3; i++) for (const d of devs) await d.sync.syncNow();
}

const text = (d: Device, path: string) => {
  const f = d.vault.getFileByPath(path);
  return f ? d.vault.cachedReadSync(f) : undefined;
};
const mdPaths = (d: Device) => d.vault.getFiles().map((f) => f.path).sort();
const conflictName = (base: string, ext = 'md') => `${base} (conflicto ${localDate()}).${ext}`;
const pending = async (d: Device) => (await d.db.files.where('dirty').above(0).count()) + (await d.db.tombstones.count());

afterEach(async () => {
  for (const d of opened.splice(0)) { await d.sync.stop(); d.db.close(); }
  SyncEngine.pageSize = 500;
});

// ---------------------------------------------------------------- decisiones (puras)

describe('decide (tabla)', () => {
  const base = { version: 3, hash: 'H0', path: 'a.md' };
  const L = (o: Partial<LocalView> = {}): LocalView => ({ state: 'alive', path: 'a.md', hash: 'H0', folder: false, dirty: false, base, ...o });
  const R = (o: Partial<RemoteView> = {}): RemoteView => ({ path: 'a.md', hash: 'H0', version: 4, deleted: false, folder: false, own: false, ...o });

  const cases: [string, LocalView, RemoteView, ReturnType<typeof decide>][] = [
    ['nuevo remoto', L({ state: 'none', base: null }), R(), { action: 'take' }],
    ['nuevo remoto ya borrado', L({ state: 'none', base: null }), R({ deleted: true }), { action: 'nothing' }],
    ['misma versión (eco)', L({ dirty: true, hash: 'H1' }), R({ version: 3, hash: 'H1' }), { action: 'nothing' }],
    ['solo cambió remoto', L(), R({ hash: 'H2' }), { action: 'take' }],
    ['solo cambió local (carrera)', L({ dirty: true, hash: 'H1' }), R({ path: 'a.md' }), { action: 'keep', path: 'a.md', content: 'local' }],
    ['los dos, distinto: copia', L({ dirty: true, hash: 'H1' }), R({ hash: 'H2' }), { action: 'take', copy: true }],
    ['los dos, igual: sin conflicto', L({ dirty: true, hash: 'H2' }), R({ hash: 'H2' }), { action: 'take' }],
    ['config, los dos: gana remoto sin copia', L({ dirty: true, hash: 'H1' }), R({ hash: 'H2' }), { action: 'take' }],
    ['renombrado local, editado remoto', L({ dirty: true, path: 'b.md' }), R({ hash: 'H2' }), { action: 'keep', path: 'b.md', content: 'remote' }],
    ['editado local, renombrado remoto', L({ dirty: true, hash: 'H1' }), R({ path: 'c.md' }), { action: 'keep', path: 'c.md', content: 'local' }],
    ['renombrado en los dos', L({ dirty: true, path: 'b.md' }), R({ path: 'c.md' }), { action: 'take', renamed: true }],
    ['renombrado igual en los dos', L({ dirty: true, path: 'c.md' }), R({ path: 'c.md' }), { action: 'take' }],
    ['borrado remoto, local limpio', L(), R({ deleted: true }), { action: 'take' }],
    ['borrado remoto, editado local: resucita', L({ dirty: true, hash: 'H1' }), R({ deleted: true }), { action: 'keep', path: 'a.md', content: 'local' }],
    ['borrado remoto de carpeta con algo adentro', L({ folder: true, hash: '', nonEmpty: true }), R({ deleted: true, folder: true }), { action: 'keep', path: 'a.md', content: 'local' }],
    ['borrado local, editado remoto: resucita', L({ state: 'tombstone' }), R({ hash: 'H2' }), { action: 'take' }],
    ['borrado en los dos', L({ state: 'tombstone' }), R({ deleted: true }), { action: 'drop' }],
    ['borrado local, eco propio', L({ state: 'tombstone' }), R({ own: true }), { action: 'keep' }],
    ['eco propio sin respuesta, igual', L({ dirty: true, hash: 'H1' }), R({ own: true, hash: 'H1' }), { action: 'take' }],
    ['eco propio sin respuesta, más cambios', L({ dirty: true, hash: 'H9' }), R({ own: true, hash: 'H1' }), { action: 'keep', path: 'a.md', content: 'local' }],
  ];
  for (const [name, l, r, want] of cases) {
    it(name, () => expect(decide(l, r, name.startsWith('config'))).toEqual(want));
  }

  it('colisiones de ruta', () => {
    const occ = (o: Partial<LocalView>): LocalView => ({ state: 'alive', path: 'x', hash: 'H', folder: false, dirty: true, base: null, ...o });
    expect(decideCollision(occ({ folder: true, hash: '' }), R({ folder: true }))).toBe('adopt');
    expect(decideCollision(occ({ hash: 'H0' }), R())).toBe('adopt');
    expect(decideCollision(occ({ hash: 'H1' }), R())).toBe('aside');
    expect(decideCollision(occ({ hash: 'H1' }), R(), true)).toBe('adopt');
    expect(decideCollision(occ({ hash: 'H0', base }), R())).toBe('aside');
    expect(decideCollision(occ({ folder: true }), R())).toBe('aside');
  });

  it('nombre de la copia de conflicto, numerado', async () => {
    const v = await Vault.open(new MelaniteDB(`cp-${++n}`));
    expect(conflictPath(v, 'dir/Nota.md', false, '2026-11-24')).toBe('dir/Nota (conflicto 2026-11-24).md');
    await v.create('dir/Nota (conflicto 2026-11-24).md', '');
    expect(conflictPath(v, 'dir/Nota.md', false, '2026-11-24')).toBe('dir/Nota (conflicto 2026-11-24) 1.md');
    expect(conflictPath(v, 'v1.2', true, '2026-11-24')).toBe('v1.2 (conflicto 2026-11-24)');
    v.db.close();
  });
});

// ---------------------------------------------------------------- dos y tres dispositivos

describe('sync entre dispositivos', () => {
  it('lo creado en uno aparece en el otro con el mismo id', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    const f = await a.vault.create('notas/hola.md', 'hola');
    await a.vault.createFolder('vacía');
    await converge(a, b);
    const g = b.vault.getFileByPath('notas/hola.md')!;
    expect(g.id).toBe(f.id);
    expect(text(b, 'notas/hola.md')).toBe('hola');
    expect(b.vault.getFolderByPath('vacía')).toBeInstanceOf(TFolder);
    expect(await pending(a)).toBe(0);
    expect(await pending(b)).toBe(0);
    expect(a.sync.state).toMatchObject({ status: 'idle', pending: 0, lastError: null });
  });

  it('edición offline en los dos lados: copia de conflicto con los dos textos', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('n.md', 'base');
    await converge(a, b);
    await a.vault.modify(a.vault.getFileByPath('n.md')!, 'base + A');
    await b.vault.modify(b.vault.getFileByPath('n.md')!, 'base + B');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await converge(a, b);
    for (const d of [a, b]) {
      expect(text(d, 'n.md')).toBe('base + A');
      expect(text(d, conflictName('n'))).toBe('base + B');
    }
    expect(b.sync.conflicts).toMatchObject([{ kind: 'edit', path: 'n.md', copyPath: conflictName('n') }]);
    expect(a.sync.conflicts).toEqual([]);
  });

  it('conflicto detectado en el push (otro subió entre nuestro pull y nuestro push)', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a');
    await a.vault.create('n.md', 'base');
    await a.sync.syncNow();
    const remote = s.remote();
    let raced = false;
    const racy: Remote = {
      ...remote,
      pull: async (after, limit) => {
        const rows = await remote.pull(after, limit);
        if (!raced && rows.length === 0) { raced = true; await a.sync.syncNow(); } // A sube justo después de nuestro pull
        return rows;
      },
    };
    const bvault = await Vault.open(new MelaniteDB(`sync-race-${++n}`));
    const b: Device = { name: 'b', vault: bvault, sync: new SyncEngine(bvault), db: bvault.db };
    opened.push(b);
    await b.sync.connect(racy, false);
    await b.sync.syncNow();
    await a.vault.modify(a.vault.getFileByPath('n.md')!, 'base + A');
    await b.vault.modify(b.vault.getFileByPath('n.md')!, 'base + B');
    raced = false;
    await b.sync.syncNow();
    expect(raced).toBe(true);
    await converge(a, b);
    for (const d of [a, b]) {
      expect(text(d, 'n.md')).toBe('base + A');
      expect(text(d, conflictName('n'))).toBe('base + B');
    }
  });

  it('mismo texto editado en los dos lados no es conflicto', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('n.md', 'x');
    await converge(a, b);
    await a.vault.modify(a.vault.getFileByPath('n.md')!, 'igual');
    await b.vault.modify(b.vault.getFileByPath('n.md')!, 'igual');
    await converge(a, b);
    expect(mdPaths(b)).toEqual(['n.md']);
    expect(b.sync.conflicts).toEqual([]);
    expect(await pending(b)).toBe(0);
  });

  it('borrado contra edición: gana la edición (en los dos órdenes)', async () => {
    for (const deleterFirst of [true, false]) {
      const s = new FakeServer();
      const a = await device(s, 'a'), b = await device(s, 'b');
      await a.vault.create('n.md', 'v1');
      await converge(a, b);
      await a.vault.delete(a.vault.getFileByPath('n.md')!); // vaciar la papelera = borrado definitivo
      await b.vault.modify(b.vault.getFileByPath('n.md')!, 'v2 editada');
      if (deleterFirst) { await a.sync.syncNow(); await b.sync.syncNow(); } else { await b.sync.syncNow(); await a.sync.syncNow(); }
      await converge(a, b);
      for (const d of [a, b]) expect(text(d, 'n.md')).toBe('v2 editada');
      expect(s.byPath('n.md')?.content).toBe('v2 editada');
      expect(await pending(a)).toBe(0);
    }
  });

  it('borrado sin conflicto llega como tombstone (la fila queda)', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    const f = await a.vault.create('n.md', 'x');
    await converge(a, b);
    await a.vault.trash(f);
    await converge(a, b);
    expect(b.vault.getFileByPath('.trash/n.md')).toBeTruthy();
    await a.vault.trash(a.vault.getFileByPath('.trash/n.md')!); // vaciar
    await converge(a, b);
    expect(b.vault.getFileByPath('.trash/n.md')).toBeNull();
    expect(s.get(f.id)).toMatchObject({ deleted: true });
    expect(await b.db.tombstones.count()).toBe(0);
  });

  it('renombrado contra edición: se aplican los dos', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('viejo.md', 'texto');
    await converge(a, b);
    await a.vault.rename(a.vault.getFileByPath('viejo.md')!, 'carpeta/nuevo.md');
    await b.vault.modify(b.vault.getFileByPath('viejo.md')!, 'texto editado');
    await converge(a, b);
    for (const d of [a, b]) {
      expect(mdPaths(d)).toEqual(['carpeta/nuevo.md']);
      expect(text(d, 'carpeta/nuevo.md')).toBe('texto editado');
    }
    expect(b.sync.conflicts).toEqual([]);
  });

  it('renombrado en los dos lados: gana el remoto y se avisa', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('n.md', 'x');
    await converge(a, b);
    await a.vault.rename(a.vault.getFileByPath('n.md')!, 'de A.md');
    await b.vault.rename(b.vault.getFileByPath('n.md')!, 'de B.md');
    await a.sync.syncNow();
    await converge(b, a);
    for (const d of [a, b]) expect(mdPaths(d)).toEqual(['de A.md']);
    expect(b.sync.conflicts).toMatchObject([{ kind: 'rename', path: 'de A.md', localPath: 'de B.md' }]);
  });

  it('misma ruta creada en dos dispositivos: el segundo se renombra con sufijo', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('Ideas.md', 'de A');
    await b.vault.create('Ideas.md', 'de B');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await converge(a, b);
    for (const d of [a, b]) {
      expect(text(d, 'Ideas.md')).toBe('de A');
      expect(text(d, conflictName('Ideas'))).toBe('de B');
    }
    expect(b.sync.conflicts).toMatchObject([{ kind: 'path', path: 'Ideas.md', copyPath: conflictName('Ideas') }]);
  });

  it('misma ruta, push en carrera (path_taken del servidor)', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await b.vault.create('Ideas.md', 'de B');
    // B ya hizo pull (nada) y recién ahora A sube: B se entera por el path_taken del push
    await b.sync.syncNow();
    await a.vault.create('Ideas.md', 'de A');
    await a.sync.syncNow();
    await converge(a, b);
    for (const d of [a, b]) {
      expect(text(d, 'Ideas.md')).toBe('de B');
      expect(text(d, conflictName('Ideas'))).toBe('de A');
    }
  });

  it('carpeta movida con contenido (y una edición sin subir adentro)', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('proj/uno.md', '1');
    await a.vault.create('proj/sub/dos.md', '2');
    await converge(a, b);
    const ids = b.vault.getFiles().map((f) => f.id).sort();
    await a.vault.rename(a.vault.getFolderByPath('proj')!, 'archivo/proj');
    await b.vault.modify(b.vault.getFileByPath('proj/sub/dos.md')!, '2 editado en B');
    await converge(a, b);
    for (const d of [a, b]) {
      expect(mdPaths(d)).toEqual(['archivo/proj/sub/dos.md', 'archivo/proj/uno.md']);
      expect(text(d, 'archivo/proj/sub/dos.md')).toBe('2 editado en B');
      expect(d.vault.getFolderByPath('proj')).toBeNull();
    }
    expect(b.vault.getFiles().map((f) => f.id).sort()).toEqual(ids);
    expect(b.sync.conflicts).toEqual([]);
  });

  it('borrar una carpeta en remoto no borra lo que acá no se subió', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    await a.vault.create('dir/viejo.md', 'v');
    await converge(a, b);
    await b.vault.create('dir/nuevo.md', 'sin subir'); // B offline
    await b.vault.modify(b.vault.getFileByPath('dir/viejo.md')!, 'editado sin subir');
    await a.vault.delete(a.vault.getFolderByPath('dir')!);
    await a.sync.syncNow();
    await b.sync.syncNow();
    await converge(a, b);
    for (const d of [a, b]) {
      expect(text(d, 'dir/nuevo.md')).toBe('sin subir');
      expect(text(d, 'dir/viejo.md')).toBe('editado sin subir');
    }
  });

  it('adjuntos: van a Storage y bajan al otro dispositivo; uno que falta no rompe nada', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer;
    const img = await a.vault.createBinary('adjuntos/foto.png', bytes);
    await converge(a, b);
    const hash = await sha256(bytes);
    expect(s.get(img.id)).toMatchObject({ kind: 'binary', storage_key: `user-1/${img.id}/${hash}`, hash, content: null });
    expect(new Uint8Array(await b.vault.readBinary(b.vault.getFileByPath('adjuntos/foto.png')!))).toEqual(new Uint8Array(bytes));

    // se reemplaza: la versión vieja se borra de Storage
    const bytes2 = new Uint8Array([9, 9]).buffer;
    await a.vault.modifyBinary(img, bytes2);
    await converge(a, b);
    expect(new Uint8Array(await b.vault.readBinary(b.vault.getFileByPath('adjuntos/foto.png')!))).toEqual(new Uint8Array(bytes2));
    expect([...s.blobs.keys()]).toEqual([`user-1/${img.id}/${await sha256(bytes2)}`]);

    // un binario cuyo contenido no está en Storage: el archivo existe vacío y la sync sigue
    await a.vault.createBinary('adjuntos/roto.png', new Uint8Array([5]).buffer);
    await a.sync.syncNow();
    s.blobs.clear();
    await b.vault.create('otra.md', 'sigue andando');
    await converge(a, b);
    const roto = b.vault.getFileByPath('adjuntos/roto.png')!;
    expect(roto).toBeInstanceOf(TFile);
    expect((await b.vault.readBinary(roto)).byteLength).toBe(0);
    expect(text(a, 'otra.md')).toBe('sigue andando');
    expect(b.sync.state.status).toBe('idle');
  });

  it('push interrumpido a mitad: el reintento es idempotente', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    const f = await a.vault.create('n.md', 'uno');
    s.loseNextResponse = true;
    await a.sync.syncNow();
    expect(a.sync.state.status).toBe('offline');
    expect(s.get(f.id)?.version).toBe(1); // llegó al servidor
    expect(await pending(a)).toBe(1); // pero acá sigue pendiente
    await a.sync.syncNow();
    expect(s.get(f.id)?.version).toBe(1); // no se reescribió
    expect(await pending(a)).toBe(0);
    expect(a.sync.conflicts).toEqual([]);

    // perdida la respuesta y con más cambios encima: sin copia de conflicto
    s.loseNextResponse = true;
    await a.vault.modify(f, 'dos');
    await a.sync.syncNow();
    await a.vault.modify(f, 'tres');
    await converge(a, b);
    expect(s.get(f.id)?.content).toBe('tres');
    expect(mdPaths(a)).toEqual(['n.md']);
    expect(text(b, 'n.md')).toBe('tres');

    // la baja también
    s.loseNextResponse = true;
    await a.vault.delete(f);
    await a.sync.syncNow();
    await converge(a, b);
    expect(s.get(f.id)?.deleted).toBe(true);
    expect(await pending(a)).toBe(0);
    expect(b.vault.getFileByPath('n.md')).toBeNull();
  });

  it('cerrar la app sin conexión no pierde nada: lo pendiente sobrevive y sube después', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a');
    s.offline = true;
    await a.vault.create('offline.md', 'escrito sin red');
    await a.sync.syncNow();
    expect(a.sync.state).toMatchObject({ status: 'offline', pending: 1 });
    await a.sync.stop();
    // "reabrir": vault y motor nuevos sobre la misma base
    s.offline = false;
    const again = await device(s, 'a2', { db: a.db });
    await again.sync.syncNow();
    expect(s.byPath('offline.md')?.content).toBe('escrito sin red');
    expect(await pending(again)).toBe(0);
  });

  it('primer login con datos en los dos lados: mezcla sin perder nada', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a');
    await a.vault.create('Welcome.md', 'bienvenida');
    await a.vault.create('Ideas.md', 'ideas de A');
    await a.vault.create('proj/a.md', 'a');
    await a.vault.create('.melanite/app.json', '{"theme":"dark"}');
    await a.sync.syncNow();

    const b = await device(s, 'b', { connect: false });
    await b.vault.create('Welcome.md', 'bienvenida');
    await b.vault.create('Ideas.md', 'ideas de B');
    await b.vault.create('proj/b.md', 'b');
    await b.vault.create('solo B.md', 'local');
    await b.vault.create('.melanite/app.json', '{"theme":"light"}');
    await b.sync.connect(s.remote(), false);
    await converge(a, b);

    for (const d of [a, b]) {
      expect(mdPaths(d)).toEqual(['.melanite/app.json', conflictName('Ideas'), 'Ideas.md', 'Welcome.md', 'proj/a.md', 'proj/b.md', 'solo B.md']);
      expect(text(d, 'Ideas.md')).toBe('ideas de A');
      expect(text(d, conflictName('Ideas'))).toBe('ideas de B');
      expect(text(d, '.melanite/app.json')).toBe('{"theme":"dark"}'); // config: gana la nube, sin copia
    }
    // Welcome unificado: un solo id en los dos; la carpeta proj también
    expect(b.vault.getFileByPath('Welcome.md')!.id).toBe(a.vault.getFileByPath('Welcome.md')!.id);
    expect(b.vault.getFolderByPath('proj')!.id).toBe(a.vault.getFolderByPath('proj')!.id);
    expect(s.alive().filter((r) => r.path === 'proj')).toHaveLength(1);
    expect(await pending(b)).toBe(0);
  });

  it('data.json de plugins guardado en los dos lados: sin copias de conflicto', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a'), b = await device(s, 'b');
    const path = '.melanite/plugins/pomodoro/data.json';
    await a.vault.create(path, '{"n":0}');
    await converge(a, b);
    for (let i = 1; i <= 3; i++) {
      await a.vault.modify(a.vault.getFileByPath(path)!, `{"n":${i},"d":"a"}`);
      await b.vault.modify(b.vault.getFileByPath(path)!, `{"n":${i},"d":"b"}`);
      await a.sync.syncNow();
      await b.sync.syncNow();
    }
    await converge(a, b);
    expect(text(a, path)).toBe(text(b, path));
    expect(b.vault.getFiles().filter((f) => f.path.startsWith('.melanite/'))).toHaveLength(1);
    expect(a.sync.conflicts.concat(b.sync.conflicts)).toEqual([]);
  });

  it('pull con seq salteados, desordenados y paginados', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a');
    // A renombra y después crea otra nota con el nombre viejo: B tiene que aplicarlo en orden de seq
    const x = await a.vault.create('a.md', 'X');
    await a.sync.syncNow();
    await a.vault.rename(x, 'b.md');
    await a.sync.syncNow();
    await a.vault.create('a.md', 'nueva');
    for (let i = 0; i < 5; i++) await a.vault.create(`m${i}.md`, String(i));
    await a.sync.syncNow();

    SyncEngine.pageSize = 2;
    const remote = s.remote();
    const shuffled: Remote = { ...remote, pull: async (after, limit) => (await remote.pull(after, limit)).reverse() };
    const bvault = await Vault.open(new MelaniteDB(`sync-shuf-${++n}`));
    const bsync = new SyncEngine(bvault);
    opened.push({ name: 'b', vault: bvault, sync: bsync, db: bvault.db });
    await bsync.connect(shuffled, false);
    await bsync.syncNow();
    expect(bvault.cachedReadSync(bvault.getFileByPath('b.md')!)).toBe('X');
    expect(bvault.cachedReadSync(bvault.getFileByPath('a.md')!)).toBe('nueva');
    expect(bvault.getFileByPath('b.md')!.id).toBe(x.id);
    expect(bvault.getFiles()).toHaveLength(7);
    expect(bsync.conflicts).toEqual([]);
    const maxSeq = Math.max(...[...s.rows.values()].map((r) => r.seq));
    expect((await bvault.db.kv.get('sync.lastSeq'))?.value).toBe(maxSeq);
  });

  it('el editor abierto con texto sin guardar: se guarda primero y va a la copia', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a');
    await a.vault.create('n.md', 'base');
    await a.sync.syncNow();

    // B tiene la nota abierta en un "editor" que todavía no guardó
    const editor = { file: null as TFile | null, text: '', busy: 0 };
    let bv: Vault;
    const hooks: SyncHooks = {
      flush: async (f) => { if (editor.file === f && editor.text !== bv.cachedReadSync(f)) await bv.modify(f, editor.text); },
      editorsClean: (f) => { if (editor.busy > 0) { editor.busy--; return false; } return editor.file !== f || editor.text === bv.cachedReadSync(f); },
    };
    const b = await device(s, 'b', { hooks });
    bv = b.vault;
    await b.sync.syncNow();
    const f = bv.getFileByPath('n.md')!;
    editor.file = f;
    editor.text = 'base';
    bv.on('modify', (m: TFile) => { if (m === editor.file) editor.text = bv.cachedReadSync(m); }); // como replaceDoc

    await a.vault.modify(a.vault.getFileByPath('n.md')!, 'base + A');
    await a.sync.syncNow();
    editor.text = 'base + B sin guardar';
    // el usuario sigue escribiendo justo cuando llega lo remoto (dos veces): no se aplica, se reintenta sin duplicar la copia
    editor.busy = 2;
    await b.sync.syncNow();
    expect(editor.busy).toBe(0);
    expect(editor.text).toBe('base + A');
    expect(text(b, 'n.md')).toBe('base + A');
    expect(text(b, conflictName('n'))).toBe('base + B sin guardar');
    expect(b.vault.getFiles().filter((x) => x.path.includes('conflicto'))).toHaveLength(1);
  });

  it('tres dispositivos convergen', async () => {
    const s = new FakeServer();
    const [a, b, c] = [await device(s, 'a'), await device(s, 'b'), await device(s, 'c')];
    await a.vault.create('n.md', '0');
    await converge(a, b, c);
    await a.vault.modify(a.vault.getFileByPath('n.md')!, 'A');
    await b.vault.modify(b.vault.getFileByPath('n.md')!, 'B');
    await c.vault.rename(c.vault.getFileByPath('n.md')!, 'renombrada.md');
    await converge(a, b, c);
    const all = (d: Device) => d.vault.getFiles().map((f) => `${f.path}=${d.vault.cachedReadSync(f)}`).sort();
    expect(all(b)).toEqual(all(a));
    expect(all(c)).toEqual(all(a));
    const texts = a.vault.getFiles().map((f) => a.vault.cachedReadSync(f)).sort();
    expect(texts).toEqual(['A', 'B']);
    expect(a.vault.getFiles().some((f) => f.path === 'renombrada.md')).toBe(true);
  });

  it('otro usuario en el mismo dispositivo: lo local se sube a su cuenta', async () => {
    const s = new FakeServer();
    const a = await device(s, 'a', { uid: 'u1' });
    await a.vault.create('n.md', 'x');
    await a.sync.syncNow();
    await a.sync.connect(s.remote('u2'), false);
    await a.sync.syncNow();
    expect(s.alive().filter((r) => r.user_id === 'u2').map((r) => r.path)).toEqual(['n.md']);
  });
});

// ---------------------------------------------------------------- migración

describe('Dexie v1 → v2', () => {
  it('conserva las notas y las deja pendientes de subir', async () => {
    const name = `mig-${++n}`;
    const old = new Dexie(name);
    old.version(1).stores({ files: 'id, &path', blobs: 'id', kv: 'key' });
    await old.table('files').bulkAdd([
      { id: 'f1', path: 'dir', folder: 1, mtime: 1, ctime: 1, size: 0 },
      { id: 'n1', path: 'dir/nota.md', folder: 0, text: 'hola v1', mtime: 1, ctime: 1, size: 7 },
      { id: 'b1', path: 'img.png', folder: 0, mtime: 1, ctime: 1, size: 2 },
    ]);
    await old.table('blobs').put({ id: 'b1', data: new Uint8Array([1, 2]).buffer });
    await old.table('kv').put({ key: 'welcomed', value: true });
    old.close();

    const db = new MelaniteDB(name);
    const v = await Vault.open(db);
    expect(v.cachedReadSync(v.getFileByPath('dir/nota.md')!)).toBe('hola v1');
    expect(new Uint8Array(await v.readBinary(v.getFileByPath('img.png')!))).toEqual(new Uint8Array([1, 2]));
    expect((await db.kv.get('welcomed'))?.value).toBe(true);
    expect(await db.files.where('dirty').above(0).count()).toBe(3);

    const s = new FakeServer();
    const sync = new SyncEngine(v);
    opened.push({ name: 'mig', vault: v, sync, db });
    await sync.connect(s.remote(), false);
    await sync.syncNow();
    expect(s.get('n1')).toMatchObject({ path: 'dir/nota.md', content: 'hola v1', version: 1 });
    expect(s.get('b1')).toMatchObject({ kind: 'binary' });
    expect(await db.files.where('dirty').above(0).count()).toBe(0);
  });
});

// ---------------------------------------------------------------- integración (opcional) contra el Supabase real

const env = (k: string) => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];
const SB = { url: env('VITE_SUPABASE_URL'), key: env('VITE_SUPABASE_ANON_KEY'), email: env('MELANITE_TEST_EMAIL'), password: env('MELANITE_TEST_PASSWORD') };

describe.skipIf(!SB.url || !SB.key || !SB.email || !SB.password)('Supabase real', () => {
  it('dos dispositivos con la misma cuenta', { timeout: 60_000 }, async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { supabaseRemote } = await import('../../src/core/sync/remote');
    const login = async () => {
      const c = createClient(SB.url!, SB.key!, { auth: { persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email: SB.email!, password: SB.password! });
      if (error) throw error;
      return c;
    };
    const mk = async (name: string) => {
      const vault = await Vault.open(new MelaniteDB(`real-${name}-${++n}`));
      const sync = new SyncEngine(vault);
      await sync.connect(await supabaseRemote(await login()), false);
      opened.push({ name, vault, sync, db: vault.db });
      return { vault, sync };
    };
    const dir = `__melanite-test-${Date.now()}`;
    const a = await mk('a'), b = await mk('b');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.vault.create(`${dir}/n.md`, 'desde A');
    await a.vault.createBinary(`${dir}/x.png`, new Uint8Array([1, 2, 3]).buffer);
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.vault.cachedReadSync(b.vault.getFileByPath(`${dir}/n.md`)!)).toBe('desde A');
    expect(new Uint8Array(await b.vault.readBinary(b.vault.getFileByPath(`${dir}/x.png`)!))).toEqual(new Uint8Array([1, 2, 3]));
    await a.vault.modify(a.vault.getFileByPath(`${dir}/n.md`)!, 'A2');
    await b.vault.modify(b.vault.getFileByPath(`${dir}/n.md`)!, 'B2');
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.vault.getFiles().filter((f) => f.path.startsWith(dir + '/n (')).length).toBe(1);
    expect(a.sync.state.lastError).toBeNull();
    // limpieza: todo lo de la prueba queda como tombstone
    await b.vault.delete(b.vault.getFolderByPath(dir)!);
    await b.sync.syncNow();
    expect(b.sync.state).toMatchObject({ status: 'idle', pending: 0 });
  });
});
