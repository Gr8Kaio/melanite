import type { SupabaseClient } from '@supabase/supabase-js';
import { Events } from '../events';
import { TFile, TFolder, stamp, type RemoteChange, type TAbstractFile, type Vault } from '../vault';
import type { FileRow, TombstoneRow } from '../db';
import { extname } from '../path';
import { conflictPath, decide, decideCollision, isConfigPath, type Decision, type LocalView, type RemoteView } from './decide';
import { sha256 } from './hash';
import { supabaseRemote, type Kind, type PushResult, type Remote, type RemoteRow } from './remote';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncState {
  /** hay una sesión conectada (start/connect) */
  enabled: boolean;
  status: SyncStatus;
  /** archivos con cambios locales sin confirmar por el servidor (incluye bajas) */
  pending: number;
  /** fin de la última ronda exitosa (ms) */
  lastSync: number | null;
  lastError: string | null;
}
export interface SyncConflict {
  /** edit: los dos editaron (copyPath = copia con lo local). rename: los dos renombraron (ganó path, se perdió localPath). path: otra entidad ya tenía la ruta (lo local se movió a copyPath). */
  kind: 'edit' | 'rename' | 'path';
  path: string;
  copyPath?: string;
  localPath?: string;
  time: number;
}
/** Ganchos hacia la UI (los pone src/core/sync/index.ts; en los tests se simulan). */
export interface SyncHooks {
  /** guardar lo que el editor tenga sin guardar de ese archivo */
  flush?(file: TFile): Promise<void>;
  /** ningún editor tiene texto sin guardar de ese archivo (sincrónico) */
  editorsClean?(file: TFile): boolean;
}

const LOCAL_DELAY = 1500;
const REMOTE_DELAY = 300;
const RETRY_DELAY = 1000;
const INTERVAL = 60_000;
const KEY_SEQ = 'sync.lastSeq';
const KEY_DEVICE = 'sync.deviceId';
const KEY_USER = 'sync.userId';

const depth = (p: string) => p.split('/').length;
const idOf = (f: TAbstractFile) => (f as TFile | TFolder).id;
const textKind = (path: string): Kind => (extname(path) === 'md' ? 'md' : 'text');

/** Estado local en el momento de decidir: si cambia antes de aplicar, no se aplica (se reintenta). */
interface Snap { id: string; file: TAbstractFile | null; path: string; text?: string; mtime?: number }

/**
 * Motor de sincronización con un servidor (`Remote`). Una ronda = pull (todo lo
 * que tenga seq > lastSeq, en orden) → push (pendientes; ante un conflicto,
 * pull y reintento) → bajar binarios pendientes. Las rondas no se pisan.
 *
 * Eventos: status(SyncState), conflict(SyncConflict).
 */
export class SyncEngine extends Events {
  /** filas por página del pull (los tests la achican) */
  static pageSize = 500;
  state: SyncState = { enabled: false, status: 'idle', pending: 0, lastSync: null, lastError: null };
  /** conflictos de esta sesión (las copias quedan en el vault) */
  conflicts: SyncConflict[] = [];

  private remote: Remote | null = null;
  private auto = false;
  private deviceId = '';
  private lastSeq = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private retry = false;
  private applying = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private due = 0;
  private cleanup: (() => void)[] = [];
  /** binarios que el servidor no tiene (no se reintentan en esta sesión) */
  private missing = new Set<string>();
  /** copias de conflicto ya hechas (id:hash), para no duplicarlas si se reintenta */
  private copied = new Set<string>();

  constructor(readonly vault: Vault, private hooks: SyncHooks = {}) { super(); }
  private get db() { return this.vault.db; }

  // ---------------------------------------------------------------- API

  /** Empieza a sincronizar con un cliente de Supabase ya autenticado. */
  async start(client: SupabaseClient): Promise<void> {
    await this.connect(await supabaseRemote(client));
  }

  /** Igual que start pero con cualquier `Remote`. auto = false: sin timers ni eventos (tests). */
  async connect(remote: Remote, auto = true): Promise<void> {
    await this.stop();
    const kv = this.db.kv;
    this.deviceId = ((await kv.get(KEY_DEVICE))?.value as string | undefined) ?? '';
    if (!this.deviceId) {
      this.deviceId = crypto.randomUUID();
      await kv.put({ key: KEY_DEVICE, value: this.deviceId });
    }
    const prevUser = (await kv.get(KEY_USER))?.value;
    if (prevUser && prevUser !== remote.userId) await this.resetBase();
    await kv.put({ key: KEY_USER, value: remote.userId });
    this.lastSeq = Number((await kv.get(KEY_SEQ))?.value ?? 0);
    this.remote = remote;
    this.auto = auto;
    this.setState({ enabled: true, status: 'idle', lastError: null, pending: await this.countPending() });
    if (auto) {
      this.watch(remote);
      void this.syncNow();
    }
  }

  /** Deja de sincronizar (espera a que termine la ronda en curso). Lo pendiente queda guardado. */
  async stop(): Promise<void> {
    this.remote = null;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const fn of this.cleanup.splice(0)) fn();
    await this.running;
    if (this.state.enabled) this.setState({ enabled: false, status: 'idle' });
  }

  /** Una ronda completa ya (si hay una en curso, otra más al terminar). Nunca rechaza: los errores van al estado. */
  syncNow(): Promise<void> {
    if (!this.remote) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        do { this.again = false; await this.round(); } while (this.again && this.remote);
      } finally { this.running = null; }
    })();
    return this.running;
  }

  // ---------------------------------------------------------------- ronda

  private async round(): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    this.retry = false;
    this.setState({ status: 'syncing' });
    try {
      await this.pull(remote);
      await this.push(remote);
      await this.fetchBlobs(remote);
      this.setState({ status: 'idle', lastSync: Date.now(), lastError: null, pending: await this.countPending() });
    } catch (err) {
      const offline = isNetworkError(err);
      if (!offline) console.warn('[melanite] sync:', err);
      this.setState({ status: offline ? 'offline' : 'error', lastError: String((err as Error)?.message ?? err), pending: await this.countPending() });
    }
    if (this.retry) this.schedule(RETRY_DELAY);
  }

  private watch(remote: Remote): void {
    const onLocal = () => {
      if (this.applying) return;
      this.schedule(LOCAL_DELAY);
      void this.countPending().then((pending) => { if (pending !== this.state.pending) this.setState({ pending }); });
    };
    const refs = (['create', 'modify', 'rename', 'delete'] as const).map((e) => this.vault.on(e, onLocal));
    this.cleanup.push(() => refs.forEach((r) => this.vault.offref(r)));
    this.cleanup.push(remote.subscribe(() => this.schedule(REMOTE_DELAY)));
    const iv = setInterval(() => void this.syncNow(), INTERVAL);
    this.cleanup.push(() => clearInterval(iv));
    if (typeof window === 'undefined') return;
    // al volver la red, al volver a la app y al irse (iOS puede matarla en segundo plano)
    const now = () => void this.syncNow();
    const offline = () => this.setState({ status: 'offline' });
    window.addEventListener('online', now);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', now);
    this.cleanup.push(() => {
      window.removeEventListener('online', now);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', now);
    });
  }

  /** Programa una ronda en `ms` (si ya hay una programada antes, queda esa: así escribir sin parar no la posterga). */
  private schedule(ms: number): void {
    if (!this.auto || !this.remote) return;
    const at = Date.now() + ms;
    if (this.timer !== undefined && this.due <= at) return;
    clearTimeout(this.timer);
    this.due = at;
    this.timer = setTimeout(() => { this.timer = undefined; void this.syncNow(); }, ms);
  }

  // ---------------------------------------------------------------- pull

  /** Trae y aplica en orden de seq. Si una fila no se puede aplicar todavía, corta ahí (lastSeq no la pasa). Devuelve cuántas aplicó. */
  private async pull(remote: Remote): Promise<number> {
    let applied = 0;
    for (;;) {
      const rows = (await remote.pull(this.lastSeq, SyncEngine.pageSize)).sort((a, b) => a.seq - b.seq);
      let seq = this.lastSeq;
      let stopped = false;
      try {
        for (const r of rows) {
          if (r.seq <= seq) continue;
          if (!(await this.applyRow(r))) { this.retry = true; stopped = true; break; }
          seq = r.seq;
          applied++;
        }
      } finally {
        if (seq !== this.lastSeq) {
          this.lastSeq = seq;
          await this.db.kv.put({ key: KEY_SEQ, value: seq });
        }
      }
      if (stopped || rows.length < SyncEngine.pageSize) return applied;
    }
  }

  /** Decide y aplica una fila remota. false = el estado local cambió en el medio (reintentar). */
  private async applyRow(r: RemoteRow): Promise<boolean> {
    const rv: RemoteView = {
      path: r.path, hash: r.hash ?? '', version: r.version, deleted: r.deleted,
      folder: r.kind === 'folder', own: !!r.device_id && r.device_id === this.deviceId,
    };
    const before = this.vault.getById(r.id);
    if (before instanceof TFile) await this.hooks.flush?.(before);
    const file = this.vault.getById(r.id);
    const snap = this.snapshot(r.id, file);
    const local = await this.localView(r.id, file);
    const d = decide(local, rv, isConfigPath(r.path));
    if (d.action === 'nothing') return true;
    if (d.action === 'drop') { await this.db.tombstones.delete(r.id); return true; }
    if (local.state === 'tombstone' && d.action === 'keep') {
      await this.db.tombstones.update(r.id, { baseVersion: r.version, baseHash: rv.hash });
      return true;
    }

    const path = d.action === 'keep' ? d.path! : r.path;
    let subject = snap;
    let fromId: string | undefined;
    let known = local.state === 'alive' ? local.hash : null;
    if (!(d.action === 'take' && r.deleted)) {
      await this.clearAncestors(path);
      const occ = this.vault.getAbstractFileByPath(path);
      if (occ && occ !== file) {
        if (occ instanceof TFile) await this.hooks.flush?.(occ);
        const occSnap = this.snapshot(idOf(occ), occ);
        const ov = await this.localView(idOf(occ), occ);
        if (local.state !== 'alive' && decideCollision(ov, rv, isConfigPath(path)) === 'adopt') {
          fromId = idOf(occ);
          subject = occSnap;
          known = ov.hash;
        } else await this.moveAside(occ);
      }
    }
    // la copia va antes de aplicar: si la app se cierra en el medio, sobra una copia pero no falta texto
    if (d.copy && file instanceof TFile) await this.saveCopy(file, snap.text, local.hash, path);

    this.applying = true;
    let ok: boolean;
    try {
      ok = await this.vault.applyRemote(this.change(r, rv, d, path, fromId, known), () => this.matches(subject));
    } finally { this.applying = false; }
    if (ok && d.renamed) this.addConflict({ kind: 'rename', path, localPath: local.path });
    return ok;
  }

  private change(r: RemoteRow, rv: RemoteView, d: Decision, path: string, fromId: string | undefined, known: string | null): RemoteChange {
    const base = { version: r.version, hash: rv.hash, path: r.path };
    if (d.action === 'take' && r.deleted) return { id: r.id, path: r.path, folder: rv.folder, deleted: true, base, dirty: false };
    const c: RemoteChange = { id: r.id, fromId, path, folder: rv.folder, deleted: false, base, dirty: d.action === 'keep' };
    if (d.action === 'take' || d.content === 'remote') {
      if (r.kind === 'md' || r.kind === 'text') c.text = r.content ?? '';
      // binario: se baja después (fetchBlobs); hasta entonces queda el contenido que había
      else if (r.kind === 'binary' && known !== rv.hash) c.blobKey = r.storage_key;
    }
    return c;
  }

  private async localView(id: string, file: TAbstractFile | null): Promise<LocalView> {
    const row = file ? await this.db.files.get(id) : undefined;
    if (file && row) {
      const base = row.baseVersion === undefined ? null : { version: row.baseVersion, hash: row.baseHash ?? '', path: row.basePath ?? '' };
      const dirty = !!row.dirty;
      const folder = file instanceof TFolder;
      const hash = folder ? '' : !dirty && base ? base.hash : await this.hashOf(file as TFile, row);
      return { state: 'alive', path: file.path, hash, folder, dirty, base, nonEmpty: folder && (file as TFolder).children.length > 0 };
    }
    const t = await this.db.tombstones.get(id);
    if (t) {
      const base = t.baseVersion === undefined ? null : { version: t.baseVersion, hash: t.baseHash ?? '', path: t.path };
      return { state: 'tombstone', path: t.path, hash: '', folder: !!t.folder, dirty: true, base };
    }
    return { state: 'none', path: '', hash: '', folder: false, dirty: false, base: null };
  }

  private async hashOf(file: TFile, row: FileRow): Promise<string> {
    if (row.text !== undefined) return sha256(this.vault.cachedReadSync(file));
    if (row.blobKey && row.baseHash !== undefined) return row.baseHash; // contenido todavía sin bajar
    return sha256(await this.vault.readBinary(file));
  }

  private snapshot(id: string, file: TAbstractFile | null): Snap {
    if (!(file instanceof TFile)) return { id, file, path: file?.path ?? '' };
    return { id, file, path: file.path, text: this.vault.cachedReadSync(file), mtime: file.stat.mtime };
  }

  /** Sincrónico: nada cambió desde el snapshot y ningún editor tiene texto sin guardar. */
  private matches(s: Snap): boolean {
    if (!s.file) return !this.vault.getById(s.id);
    if (this.vault.getAbstractFileByPath(s.path) !== s.file) return false;
    if (s.file instanceof TFile) {
      if (this.vault.cachedReadSync(s.file) !== s.text || s.file.stat.mtime !== s.mtime) return false;
      if (this.hooks.editorsClean && !this.hooks.editorsClean(s.file)) return false;
    }
    return true;
  }

  /** Si un archivo ocupa el lugar de una carpeta de `path`, se aparta. */
  private async clearAncestors(path: string): Promise<void> {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const f = this.vault.getAbstractFileByPath(parts.slice(0, i).join('/'));
      if (!f) return;
      if (f instanceof TFile) await this.moveAside(f);
    }
  }

  private async moveAside(f: TAbstractFile): Promise<void> {
    const from = f.path;
    const to = conflictPath(this.vault, from, f instanceof TFolder);
    await this.vault.rename(f, to);
    this.addConflict({ kind: 'path', path: from, copyPath: to });
  }

  private async saveCopy(file: TFile, text: string | undefined, hash: string, path: string): Promise<void> {
    const key = `${file.id}:${hash}`;
    if (this.copied.has(key)) return;
    const to = conflictPath(this.vault, file.path, false);
    if (text !== undefined && (await this.db.files.get(file.id))?.text !== undefined) await this.vault.create(to, text);
    else await this.vault.createBinary(to, await this.vault.readBinary(file));
    this.copied.add(key);
    this.addConflict({ kind: 'edit', path, copyPath: to });
  }

  // ---------------------------------------------------------------- push

  private async push(remote: Remote): Promise<void> {
    for (let pass = 0; pass < 4; pass++) {
      const rows = (await this.db.files.where('dirty').above(0).toArray()).sort((a, b) => depth(a.path) - depth(b.path));
      const tombs = (await this.db.tombstones.toArray()).sort((a, b) => depth(b.path) - depth(a.path));
      if (!rows.length && !tombs.length) return;
      const blocked: string[] = [];
      let progress = 0;
      let conflicts = 0;
      for (const row of rows) {
        const s = await this.pushRow(remote, row);
        if (s === 'ok') progress++;
        else if (s === 'path_taken') blocked.push(row.id);
        else if (s === 'conflict') conflicts++;
      }
      for (const t of tombs) {
        const s = await this.pushTombstone(remote, t);
        if (s === 'ok') progress++;
        else if (s === 'conflict') conflicts++;
      }
      if (!blocked.length && !conflicts) return;
      // el servidor tiene algo que no vimos: traerlo (ahí se resuelve el conflicto) y reintentar
      const pulled = await this.pull(remote);
      if (!progress && !pulled && blocked.length) {
        // nadie va a liberar esas rutas (p. ej. dos notas que intercambiaron nombres): se aparta la nuestra
        for (const id of blocked) {
          const f = this.vault.getById(id);
          if (f) await this.moveAside(f);
        }
      }
    }
  }

  private async pushRow(remote: Remote, row: FileRow): Promise<PushResult['status'] | 'skip'> {
    const file = this.vault.getById(row.id);
    if (!file) return 'skip';
    let kind: Kind = 'folder';
    let content: string | null = null;
    let hash = '';
    let key: string | null = null;
    if (file instanceof TFile) {
      if (row.text !== undefined) {
        kind = textKind(file.path);
        content = this.vault.cachedReadSync(file);
        hash = await sha256(content);
      } else if (row.blobKey) {
        // el contenido todavía no bajó: solo se sube la ruta (sin base no hay qué subir)
        if (row.baseHash === undefined) return 'skip';
        kind = 'binary';
        hash = row.baseHash;
        key = row.blobKey;
      } else {
        kind = 'binary';
        const data = await this.vault.readBinary(file);
        hash = await sha256(data);
        key = `${remote.userId}/${row.id}/${hash}`;
        if (hash !== row.baseHash) await remote.upload(key, data);
      }
    }
    const path = file.path;
    const res = await remote.push({ id: row.id, base_version: row.baseVersion ?? 0, path, kind, content, storage_key: key, hash, deleted: false, device_id: this.deviceId });
    if (res.status !== 'ok') return res.status;
    if (!res.row) return 'skip';
    const version = res.row.version;
    await this.db.transaction('rw', this.db.files, this.db.tombstones, async () => {
      const cur = await this.db.files.get(row.id);
      // dirty se limpia solo si no hubo otra escritura local mientras subíamos
      if (cur) await this.db.files.update(row.id, { baseVersion: version, baseHash: hash, basePath: path, ...(cur.dirty === row.dirty ? { dirty: 0 } : {}) });
      else await this.db.tombstones.update(row.id, { baseVersion: version, baseHash: hash });
    });
    if (kind === 'binary' && !row.blobKey && row.baseHash && row.baseHash !== hash) this.removeBlob(remote, row.id, row.baseHash);
    return 'ok';
  }

  private async pushTombstone(remote: Remote, t: TombstoneRow): Promise<PushResult['status']> {
    const kind: Kind = t.folder ? 'folder' : t.binary ? 'binary' : textKind(t.path);
    const res = await remote.push({ id: t.id, base_version: t.baseVersion ?? 0, path: t.path, kind, content: null, storage_key: null, hash: '', deleted: true, device_id: this.deviceId });
    if (res.status !== 'ok') return res.status;
    await this.db.tombstones.delete(t.id);
    if (t.binary && t.baseHash) this.removeBlob(remote, t.id, t.baseHash);
    return 'ok';
  }

  /** Versión vieja de un adjunto (las claves son por contenido: {user}/{id}/{hash}). Si falla, queda basura. */
  private removeBlob(remote: Remote, id: string, hash: string): void {
    void remote.remove([`${remote.userId}/${id}/${hash}`]).catch(() => {});
  }

  // ---------------------------------------------------------------- binarios

  private async fetchBlobs(remote: Remote): Promise<void> {
    const rows = await this.db.files.where('blobKey').above('').toArray();
    for (const row of rows) {
      const key = row.blobKey!;
      const file = this.vault.getById(row.id);
      if (this.missing.has(key) || !(file instanceof TFile)) continue;
      const snap = this.snapshot(row.id, file);
      const data = await remote.download(key);
      if (!data) { this.missing.add(key); continue; }
      if ((await this.db.files.get(row.id))?.blobKey !== key) continue;
      this.applying = true;
      try {
        await this.vault.applyRemote({ id: row.id, path: file.path, folder: false, deleted: false, data, blobKey: null }, () => this.matches(snap));
      } finally { this.applying = false; }
    }
  }

  // ---------------------------------------------------------------- varios

  private countPending(): Promise<number> {
    return Promise.all([this.db.files.where('dirty').above(0).count(), this.db.tombstones.count()]).then(([a, b]) => a + b);
  }

  /** Otro usuario en este dispositivo: lo local se mezcla con su cuenta como en un primer login. */
  private async resetBase(): Promise<void> {
    await this.db.transaction('rw', this.db.files, this.db.tombstones, this.db.kv, async () => {
      await this.db.files.toCollection().modify((r: FileRow) => {
        delete r.baseVersion;
        delete r.baseHash;
        delete r.basePath;
        r.dirty = stamp();
      });
      await this.db.tombstones.clear();
      await this.db.kv.delete(KEY_SEQ);
    });
  }

  private addConflict(c: Omit<SyncConflict, 'time'>): void {
    const entry: SyncConflict = { ...c, time: Date.now() };
    this.conflicts.push(entry);
    this.trigger('conflict', entry);
  }

  private setState(patch: Partial<SyncState>): void {
    Object.assign(this.state, patch);
    this.trigger('status', { ...this.state });
  }
}

function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|internet connection/i.test(String((err as Error)?.message ?? err));
}
