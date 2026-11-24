import type { SupabaseClient } from '@supabase/supabase-js';

export type Kind = 'md' | 'text' | 'binary' | 'folder';

/** Fila de `files` como la devuelve el servidor (sin user_id). */
export interface RemoteRow {
  id: string;
  path: string;
  kind: Kind;
  content: string | null;
  storage_key: string | null;
  hash: string | null;
  version: number;
  deleted: boolean;
  seq: number;
  device_id: string | null;
}

export interface PushArgs {
  id: string;
  base_version: number;
  path: string;
  kind: Kind;
  content: string | null;
  storage_key: string | null;
  hash: string;
  deleted: boolean;
  device_id: string;
}

/** ok: escrito (row = fila nueva; null si era la baja de algo que el servidor no tenía). conflict: la versión no coincide (row = la remota). path_taken: otra fila viva tiene esa ruta (row = esa). */
export interface PushResult { status: 'ok' | 'conflict' | 'path_taken'; row: RemoteRow | null }

/** Lo que la sync necesita del servidor. Implementaciones: Supabase (abajo) y el servidor falso de los tests. */
export interface Remote {
  userId: string;
  pull(afterSeq: number, limit: number): Promise<RemoteRow[]>;
  push(args: PushArgs): Promise<PushResult>;
  upload(key: string, data: ArrayBuffer): Promise<void>;
  /** null = el objeto no existe */
  download(key: string): Promise<ArrayBuffer | null>;
  remove(keys: string[]): Promise<void>;
  /** aviso de que algo cambió en el servidor (dispara un pull); devuelve cómo desuscribirse */
  subscribe(onChange: () => void): () => void;
}

const COLS = 'id,path,kind,content,storage_key,hash,version,deleted,seq,device_id';
const BUCKET = 'attachments';

function fail(err: { message?: string; code?: string } | unknown): never {
  const e = err as { message?: string; code?: string };
  throw Object.assign(new Error(e?.message ?? String(err)), { code: e?.code });
}

export async function supabaseRemote(client: SupabaseClient): Promise<Remote> {
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error('Sync: no Supabase session');
  const storage = () => client.storage.from(BUCKET);

  return {
    userId,
    async pull(afterSeq, limit) {
      const { data, error } = await client.from('files').select(COLS).gt('seq', afterSeq).order('seq').limit(limit);
      if (error) fail(error);
      return data as RemoteRow[];
    },
    async push(a) {
      const { data, error } = await client.rpc('push_file', {
        p_id: a.id, p_base_version: a.base_version, p_path: a.path, p_kind: a.kind, p_content: a.content,
        p_storage_key: a.storage_key, p_hash: a.hash, p_deleted: a.deleted, p_device_id: a.device_id,
      });
      if (error) fail(error);
      return data as PushResult;
    },
    async upload(key, bytes) {
      const { error } = await storage().upload(key, bytes, { upsert: true, contentType: 'application/octet-stream' });
      if (error) fail(error);
    },
    async download(key) {
      const { data, error } = await storage().download(key);
      if (error) {
        const e = error as { status?: number; statusCode?: string; message?: string };
        if (e.status === 404 || e.statusCode === '404' || /not.?found/i.test(e.message ?? '')) return null;
        fail(error);
      }
      return data.arrayBuffer();
    },
    async remove(keys) {
      const { error } = await storage().remove(keys);
      if (error) fail(error);
    },
    subscribe(onChange) {
      const channel = client
        .channel(`melanite-files-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'files', filter: `user_id=eq.${userId}` }, () => onChange())
        // al (re)conectar también: lo que pasó mientras estaba caído
        .subscribe((status) => { if (status === 'SUBSCRIBED') onChange(); });
      return () => void client.removeChannel(channel);
    },
  };
}
