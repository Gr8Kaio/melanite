-- Melanite: esquema de sincronización.
-- Idempotente: se puede pegar y correr entero en el SQL Editor las veces que haga falta.
--
-- Una fila por archivo o carpeta del vault, con id estable (renombrar = cambiar path).
-- Los borrados son tombstones (deleted = true; la fila queda).
-- Todas las escrituras pasan por push_file (compare-and-swap sobre version); los
-- clientes no pueden escribir la tabla directo. El pull lee seq > último seq visto.

-- ---------------------------------------------------------------- tabla

create sequence if not exists public.files_seq;

-- La clave es (user_id, id) y no solo id: si en un dispositivo se entra con otra
-- cuenta, sus notas (con los mismos ids) se suben también a esa cuenta sin chocar.
create table if not exists public.files (
  id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null check (path <> ''),
  kind text not null check (kind in ('md', 'text', 'binary', 'folder')),
  content text,
  storage_key text,
  hash text,
  version integer not null default 1,
  deleted boolean not null default false,
  seq bigint not null default nextval('public.files_seq'),
  updated_at timestamptz not null default now(), -- solo informativo: el cursor es seq
  device_id text,
  primary key (user_id, id)
);

-- una sola fila viva por ruta y usuario
create unique index if not exists files_user_path_key on public.files (user_id, path) where not deleted;
-- el pull: where user_id = me and seq > x order by seq
create index if not exists files_user_seq_idx on public.files (user_id, seq);

-- ---------------------------------------------------------------- permisos

alter table public.files enable row level security;

drop policy if exists "files_select_own" on public.files;
create policy "files_select_own" on public.files
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.files from anon, authenticated;
grant select on public.files to authenticated;
revoke all on sequence public.files_seq from anon, authenticated;

-- ---------------------------------------------------------------- push_file

-- Escribe una fila si p_base_version coincide con la versión del servidor
-- (0 = el cliente cree que no existe). Devuelve jsonb:
--   { status: 'ok',         row: fila nueva (o null si era la baja de algo que no existía) }
--   { status: 'conflict',   row: la fila del servidor (otra versión) }
--   { status: 'path_taken', row: la fila viva que ya tiene esa ruta }
create or replace function public.push_file(
  p_id uuid,
  p_base_version integer,
  p_path text,
  p_kind text,
  p_content text,
  p_storage_key text,
  p_hash text,
  p_deleted boolean,
  p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.files;
  res public.files;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Un push a la vez por usuario: así seq se asigna en el mismo orden en que se
  -- confirman las transacciones, y un pull "seq > último" nunca saltea una fila
  -- que confirma tarde (con una secuencia sola, una transacción lenta podría
  -- confirmar un seq menor después de que el cliente ya vio uno mayor).
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select * into cur from public.files where user_id = uid and id = p_id for update;
  if found and cur.version <> p_base_version then
    return jsonb_build_object('status', 'conflict', 'row', to_jsonb(cur) - 'user_id');
  end if;
  if not found and p_deleted then
    return jsonb_build_object('status', 'ok', 'row', null);
  end if;

  begin
    if not found then
      insert into public.files (id, user_id, path, kind, content, storage_key, hash, version, deleted, seq, updated_at, device_id)
      values (p_id, uid, p_path, p_kind, p_content, p_storage_key, p_hash, 1, false, nextval('public.files_seq'), now(), p_device_id)
      returning * into res;
    else
      update public.files set
        path = p_path,
        kind = case when p_deleted then cur.kind else p_kind end,
        content = case when p_deleted then null else p_content end,
        storage_key = case when p_deleted then null else p_storage_key end,
        hash = case when p_deleted then null else p_hash end,
        deleted = p_deleted,
        version = cur.version + 1,
        seq = nextval('public.files_seq'),
        updated_at = now(),
        device_id = p_device_id
      where user_id = uid and id = p_id
      returning * into res;
    end if;
  exception when unique_violation then
    select * into cur from public.files where user_id = uid and path = p_path and not deleted;
    return jsonb_build_object('status', 'path_taken', 'row', to_jsonb(cur) - 'user_id');
  end;

  return jsonb_build_object('status', 'ok', 'row', to_jsonb(res) - 'user_id');
end;
$$;

revoke all on function public.push_file(uuid, integer, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.push_file(uuid, integer, text, text, text, text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------- realtime (solo como aviso para hacer pull)

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'files'
  ) then
    alter publication supabase_realtime add table public.files;
  end if;
end $$;

-- ---------------------------------------------------------------- storage: adjuntos

-- Bucket privado. Rutas: {user_id}/{file id}/{hash}. Cada usuario solo toca su carpeta.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "attachments_select_own" on storage.objects;
create policy "attachments_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "attachments_insert_own" on storage.objects;
create policy "attachments_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "attachments_update_own" on storage.objects;
create policy "attachments_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "attachments_delete_own" on storage.objects;
create policy "attachments_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
