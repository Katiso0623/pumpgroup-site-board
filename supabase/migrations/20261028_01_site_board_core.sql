-- Pump Group site board (Mashaeng WWTW, contract TS004-2026): data and access rules.
-- Lives beside the Tender Desk in the same Supabase project and touches none of its tables. Everything here is
-- prefixed sb_. Every table has row level security on and no policies, and the website's roles have no table
-- rights at all: the website reaches the data only through the sb_* functions below, which check the caller's
-- place on the site board team (sb_members) on every call.
--
-- Roles and levels: owner 4 (Katiso), editor 3, contributor 2 (logs the day), viewer 1 (reads only).
-- Access rules (the same as the board had before):
--   ipc, certs              read: viewer      write: editor
--   costs, budget           read: editor      write: editor
--   workers, attend, training read: contributor write: contributor
--   workers_id              read: editor      write: editor; each person also reads and writes workers_id/<own id>
--   anything else           read: viewer      write: contributor

-- ---------- tables ----------
create table if not exists public.sb_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null check (role in ('owner', 'editor', 'contributor', 'viewer')),
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  last_seen timestamptz
);

create sequence if not exists public.sb_rev_seq;

create table if not exists public.sb_docs (
  path text primary key,
  coll text not null,
  doc_id text not null,
  data jsonb not null,
  rev bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists sb_docs_coll_idx on public.sb_docs (coll, doc_id);
create index if not exists sb_docs_updated_idx on public.sb_docs (updated_at);

-- deleted documents, so that every open board drops them on its next refresh
create table if not exists public.sb_gone (
  path text primary key,
  coll text not null,
  rev bigint not null,
  at timestamptz not null default now(),
  by uuid
);
create index if not exists sb_gone_at_idx on public.sb_gone (at);

-- photos and documents uploaded through the board (stored in the site-board bucket at a/<id>)
create table if not exists public.sb_assets (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  level int not null default 1 check (level between 1 and 3),
  content_type text not null,
  size_bytes bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists sb_assets_by_idx on public.sb_assets (created_by, created_at);

-- the project documents library (stored in the site-board bucket at d/<path>)
create table if not exists public.sb_files (
  path text primary key,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  level int not null default 3 check (level between 1 and 3),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- the board's reference data (programme, BoQ, site model, certified figures): read after sign-in, never in the page
create table if not exists public.sb_app (
  key text primary key,
  value jsonb not null,
  level int not null default 1 check (level between 1 and 4),
  updated_at timestamptz not null default now()
);

-- what the GitHub sync workflow has already brought in (so a file is never applied twice)
create table if not exists public.sb_sync_log (
  sha256 text primary key,
  name text not null,
  kind text,
  result jsonb,
  at timestamptz not null default now()
);

-- each library document is stored under its own fixed name d/<obj>; a newer copy gets a new name and the old one is
-- removed, so a link made for one copy never opens a later or more restricted one
alter table public.sb_files add column if not exists obj text;
create unique index if not exists sb_files_obj_idx on public.sb_files (obj);

-- project documents on their way up: the file goes to d/<obj>, then sb_file_commit puts it in the library
create table if not exists public.sb_file_up (
  obj text primary key check (obj ~ '^[0-9a-f]{32}$'),
  path text not null,
  content_type text not null,
  size_bytes bigint not null default 0,
  level int not null default 3 check (level between 1 and 3),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- how much each person saved to the records each day, so one login (or a lost phone) cannot fill the shared database
create table if not exists public.sb_usage (
  user_id uuid not null,
  day date not null,
  bytes bigint not null default 0,
  writes int not null default 0,
  primary key (user_id, day)
);

alter table public.sb_members enable row level security;
alter table public.sb_docs enable row level security;
alter table public.sb_gone enable row level security;
alter table public.sb_assets enable row level security;
alter table public.sb_files enable row level security;
alter table public.sb_file_up enable row level security;
alter table public.sb_usage enable row level security;
alter table public.sb_app enable row level security;
alter table public.sb_sync_log enable row level security;
revoke all on public.sb_members, public.sb_docs, public.sb_gone, public.sb_assets, public.sb_files, public.sb_file_up, public.sb_usage,
  public.sb_app, public.sb_sync_log from anon, authenticated;
revoke all on sequence public.sb_rev_seq from anon, authenticated;

-- Limits. The project is on Supabase's free plan (500 MB database, 1 GB of files) and the Tender Desk shares it:
--   files: 600 MB for the whole site board, 200 MB a day for each person, 20 MB a file
--   records: 150 MB for the whole site board, 50 MB and 20 000 saves a day for each person
create or replace function public.sb_storage_used(p_uid uuid default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint from storage.objects o
   where o.bucket_id = 'site-board' and (p_uid is null or (o.owner_id = p_uid::text and o.created_at > now() - interval '1 day'))
$$;

-- counts a save against the person's daily allowance and the site board's total (raises when either is used up)
create or replace function public.sb_note_write(p_uid uuid, p_bytes bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  insert into public.sb_usage as s (user_id, day, bytes, writes) values (p_uid, current_date, greatest(coalesce(p_bytes, 0), 0), 1)
  on conflict (user_id, day) do update set bytes = s.bytes + excluded.bytes, writes = s.writes + 1
  returning s.bytes, s.writes into u;
  if u.bytes > 50 * 1024 * 1024 or u.writes > 20000 then
    raise exception 'rate_limited: you have saved the most allowed for one day. Try again tomorrow, or tell Katiso.' using errcode = 'P0001'; end if;
  if pg_total_relation_size('public.sb_docs') > 150 * 1024 * 1024 then
    raise exception 'quota_exceeded: the site board''s records are full. Tell Katiso.' using errcode = 'P0001'; end if;
end $$;

-- ---------- helpers ----------
-- the caller's level: 0 when they are not (or no longer) on the site board team
create or replace function public.sb_lvl() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case m.role when 'owner' then 4 when 'editor' then 3 when 'contributor' then 2 when 'viewer' then 1 else 0 end
                   from public.sb_members m where m.user_id = auth.uid() and m.active), 0);
$$;

-- document and collection paths: the same grammar as before (even segment count = document)
create or replace function public.sb_path_ok(p text, p_doc boolean) returns boolean
language sql immutable set search_path = public as $$
  select p is not null and octet_length(p) <= 1000
     and p ~ '^[A-Za-z0-9_.~:@+-]{1,200}(/[A-Za-z0-9_.~:@+-]{1,200}){0,15}$'
     and ('/' || p || '/') !~ '/[.][.]?/'
     and ((array_length(string_to_array(p, '/'), 1) % 2 = 0) = p_doc);
$$;

-- may a caller at level p_lvl with id p_uid read (or write) the document at p_path?
create or replace function public.sb_can(p_lvl int, p_uid uuid, p_path text, p_write boolean) returns boolean
language plpgsql immutable set search_path = public as $$
declare s text[] := string_to_array(p_path, '/'); top text := s[1];
begin
  if coalesce(p_lvl, 0) < 1 or p_uid is null then return false; end if;
  if top = 'data' and s[2] = 'users' then          -- each person's own subtree, private to them
    return coalesce(s[3] = p_uid::text, false) and (not p_write or p_lvl >= 2);
  end if;
  if top = 'workers_id' and coalesce(s[2] = p_uid::text, false) then   -- workers_id/<own id>: read and write from contributor
    return p_lvl >= 2;
  end if;
  return p_lvl >= case
    when top in ('ipc', 'certs') then case when p_write then 3 else 1 end
    when top in ('costs', 'budget', 'workers_id') then 3
    when top in ('workers', 'attend', 'training') then 2
    when p_write then 2 else 1 end;
end $$;

-- update(): nested objects merge, anything else (arrays, null) replaces the field
create or replace function public.sb_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb := case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end;
begin
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(r -> k) = 'object' then
      r := jsonb_set(r, array[k], public.sb_merge(r -> k, v));
    else
      r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.sb_parent(p text) returns text language sql immutable set search_path = public as $$ select regexp_replace(p, '/[^/]+$', '') $$;
create or replace function public.sb_leaf(p text) returns text language sql immutable set search_path = public as $$ select regexp_replace(p, '^.*/', '') $$;

-- stops the call when the caller is not on the team (the website then shows the "not on the team" screen)
create or replace function public.sb_need_member() returns int
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_lvl();
begin
  -- no sign-in at all (an expired session that could not be renewed on a weak signal) is not the same as being removed
  if auth.uid() is null then raise exception 'unauthenticated: sign in again' using errcode = 'P0001'; end if;
  if l = 0 then raise exception 'revoked: this login is not on the site board team' using errcode = 'P0001'; end if;
  return l;
end $$;

create or replace function public.sb_check_body(p jsonb) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid_argument: a document body must be a JSON object' using errcode = 'P0001'; end if;
  if octet_length(p::text) > 262144 then raise exception 'invalid_argument: the document is over 256 KiB' using errcode = 'P0001'; end if;
end $$;

-- ---------- who am I, and the team's names ----------
create or replace function public.sb_whoami() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('member', false); end if;
  select * into m from public.sb_members where user_id = uid;
  if not found or not m.active then
    return jsonb_build_object('member', false, 'email', (select email from auth.users where id = uid));
  end if;
  if m.last_seen is null or m.last_seen < now() - interval '2 minutes' then
    update public.sb_members set last_seen = now() where user_id = uid;
  end if;
  return jsonb_build_object('member', true, 'id', m.user_id, 'email', m.email, 'name', m.full_name, 'role', m.role,
    'level', public.sb_lvl(), 'mustChange', m.must_change_password);
end $$;

create or replace function public.sb_password_changed() returns jsonb
language sql security definer set search_path = public as $$
  update public.sb_members set must_change_password = false where user_id = auth.uid() returning jsonb_build_object('ok', true);
$$;

-- names for everyone on the team (current and past), so entries show who wrote them
create or replace function public.sb_people() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'name', full_name, 'role', role, 'active', active) order by full_name)
                   from public.sb_members), '[]'::jsonb);
end $$;

-- the Team page (editors): who has access, when they were last on, and whether they still use a temporary password
create or replace function public.sb_team() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member();
begin
  if l < 3 then raise exception 'invalid_argument: only editors can see the team list' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'email', m.email, 'name', m.full_name, 'role', m.role,
      'active', m.active, 'mustChange', m.must_change_password, 'lastSeen', m.last_seen, 'added', m.created_at,
      'tenderDesk', exists (select 1 from public.staff s where s.user_id = m.user_id and s.active))
    order by m.active desc, case m.role when 'owner' then 0 when 'editor' then 1 when 'contributor' then 2 else 3 end, m.full_name)
    from public.sb_members m), '[]'::jsonb);
end $$;

-- change someone's role, name or access (editors). Only the owner changes editors; nobody changes the owner or themselves.
create or replace function public.sb_team_set(p_user uuid, p_role text default null, p_active boolean default null, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); t record;
begin
  if l < 3 then raise exception 'invalid_argument: only editors can change the team' using errcode = 'P0001'; end if;
  select * into t from public.sb_members where user_id = p_user;
  if not found then raise exception 'invalid_argument: that person is not on the team' using errcode = 'P0001'; end if;
  if p_user = auth.uid() and (p_role is not null or p_active is not null) then
    raise exception 'invalid_argument: you cannot change your own role or access' using errcode = 'P0001'; end if;
  if t.role = 'owner' and (p_role is not null or p_active is not null) then
    raise exception 'invalid_argument: the owner''s access cannot be changed here' using errcode = 'P0001'; end if;
  if p_role is not null and p_role not in ('editor', 'contributor', 'viewer') then
    raise exception 'invalid_argument: the role must be editor, contributor or viewer' using errcode = 'P0001'; end if;
  if l < 4 and (t.role = 'editor' or p_role = 'editor') then
    raise exception 'invalid_argument: only the owner can add or change editors' using errcode = 'P0001'; end if;
  update public.sb_members set role = coalesce(p_role, role), active = coalesce(p_active, active),
    full_name = coalesce(nullif(btrim(p_name), ''), full_name) where user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- documents ----------
create or replace function public.sb_get(p_path text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member(); r record;
begin
  if not public.sb_path_ok(p_path, true) then raise exception 'invalid_argument: not a document path' using errcode = 'P0001'; end if;
  if not public.sb_can(l, auth.uid(), p_path, false) then return jsonb_build_object('exists', false); end if;
  select data, rev, updated_at into r from public.sb_docs where path = p_path;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'data', r.data, 'rev', r.rev, 'at', r.updated_at);
end $$;

create or replace function public.sb_list(p_coll text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid();
begin
  if not public.sb_path_ok(p_coll, false) then raise exception 'invalid_argument: not a collection path' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', doc_id, 'data', data, 'rev', rev, 'at', updated_at) order by doc_id collate "C")
                   from public.sb_docs where coll = p_coll and public.sb_can(l, uid, path, false)), '[]'::jsonb);
end $$;

create or replace function public.sb_set(p_path text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid(); r record;
begin
  if not public.sb_path_ok(p_path, true) then raise exception 'invalid_argument: not a document path' using errcode = 'P0001'; end if;
  perform public.sb_check_body(p_data);
  if not public.sb_can(l, uid, p_path, true) then raise exception 'invalid_argument: you cannot write here' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.sb_docs where path = p_path) and (select count(*) from public.sb_docs) >= 50000 then
    raise exception 'quota_exceeded: the site board holds its maximum number of records' using errcode = 'P0001'; end if;
  perform public.sb_note_write(uid, octet_length(p_data::text));
  -- on a second save of the same record the number is taken after the row is locked, so it always goes up
  insert into public.sb_docs (path, coll, doc_id, data, rev, created_by, updated_by)
    values (p_path, public.sb_parent(p_path), public.sb_leaf(p_path), p_data, nextval('public.sb_rev_seq'), uid, uid)
  on conflict (path) do update set data = excluded.data, rev = nextval('public.sb_rev_seq'), updated_at = now(), updated_by = uid
  returning rev, updated_at into r;
  delete from public.sb_gone where path = p_path;
  return jsonb_build_object('rev', r.rev, 'at', r.updated_at);
end $$;

create or replace function public.sb_update(p_path text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid(); cur jsonb; nd jsonb; r record;
begin
  if not public.sb_path_ok(p_path, true) then raise exception 'invalid_argument: not a document path' using errcode = 'P0001'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_argument: an update must be a JSON object' using errcode = 'P0001'; end if;
  if not public.sb_can(l, uid, p_path, true) then raise exception 'invalid_argument: you cannot write here' using errcode = 'P0001'; end if;
  select data into cur from public.sb_docs where path = p_path for update;
  if not found then raise exception 'invalid_argument: the document does not exist' using errcode = 'P0001'; end if;
  nd := public.sb_merge(cur, p_patch);
  perform public.sb_check_body(nd);
  perform public.sb_note_write(uid, octet_length(nd::text));
  update public.sb_docs set data = nd, rev = nextval('public.sb_rev_seq'), updated_at = now(), updated_by = uid
   where path = p_path returning rev, updated_at into r;
  return jsonb_build_object('rev', r.rev, 'at', r.updated_at, 'data', nd);
end $$;

create or replace function public.sb_delete(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid(); c text;
begin
  if not public.sb_path_ok(p_path, true) then raise exception 'invalid_argument: not a document path' using errcode = 'P0001'; end if;
  if not public.sb_can(l, uid, p_path, true) then raise exception 'invalid_argument: you cannot write here' using errcode = 'P0001'; end if;
  perform public.sb_note_write(uid, 100);
  delete from public.sb_docs where path = p_path returning coll into c;
  if found then
    insert into public.sb_gone (path, coll, rev, at, by) values (p_path, c, nextval('public.sb_rev_seq'), now(), uid)
    on conflict (path) do update set rev = excluded.rev, at = excluded.at, by = excluded.by;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- everything this person may read that changed after p_since (all of it when p_since is null). The board asks every
-- few seconds with the time of its previous answer less a minute, so a slow write is never missed.
create or replace function public.sb_changes(p_since timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid(); t timestamptz := now();
begin
  update public.sb_members set last_seen = t where user_id = uid and (last_seen is null or last_seen < t - interval '2 minutes');
  return jsonb_build_object('now', t, 'level', l, 'uid', uid,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('p', path, 'c', coll, 'i', doc_id, 'd', data, 'r', rev))
                      from public.sb_docs where (p_since is null or updated_at > p_since) and public.sb_can(l, uid, path, false)), '[]'::jsonb),
    'gone', coalesce((select jsonb_agg(jsonb_build_object('p', path, 'c', coll, 'r', rev))
                      from public.sb_gone where p_since is not null and at > p_since and public.sb_can(l, uid, path, false)), '[]'::jsonb));
end $$;

-- ---------- uploads ----------
-- reserve an id for an upload; the file then goes to the bucket at a/<id> (the bucket only accepts reserved ids)
create or replace function public.sb_asset_new(p_type text, p_size bigint, p_level int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid(); nid text := replace(gen_random_uuid()::text, '-', '');
  t text := lower(btrim(coalesce(p_type, '')));
begin
  if l < 2 then raise exception 'not_uploader: viewers cannot upload' using errcode = 'P0001'; end if;
  if coalesce(p_size, 0) <= 0 then raise exception 'invalid_request: the file is empty' using errcode = 'P0001'; end if;
  if p_size > 20 * 1024 * 1024 then raise exception 'too_large: files are limited to 20 MB' using errcode = 'P0001'; end if;
  if t !~ ('^(image/(jpeg|png|webp|gif)|application/pdf|video/(mp4|quicktime|webm)|text/(csv|plain)|application/json|application/zip'
       || '|application/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)'
       || '|application/msword|application/vnd\.ms-excel)$') then
    raise exception 'unsupported_type: this kind of file cannot be uploaded (%)', t using errcode = 'P0001'; end if;
  if (select count(*) from public.sb_assets where created_by = uid and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited: too many uploads this hour' using errcode = 'P0001'; end if;
  if (select count(*) from public.sb_assets a where a.created_by = uid and a.created_at > now() - interval '1 hour'
        and not exists (select 1 from storage.objects o where o.bucket_id = 'site-board' and o.name = 'a/' || a.id)) >= 20 then
    raise exception 'rate_limited: finish the uploads already started, then try again' using errcode = 'P0001'; end if;
  if (select count(*) from public.sb_assets) >= 20000 then
    raise exception 'quota_exceeded: the site board holds its maximum number of files. Tell Katiso.' using errcode = 'P0001'; end if;
  if public.sb_storage_used(null) + p_size > 600 * 1024 * 1024 then
    raise exception 'quota_exceeded: the site board''s file store is full. Tell Katiso.' using errcode = 'P0001'; end if;
  if public.sb_storage_used(uid) + p_size > 200 * 1024 * 1024 then
    raise exception 'rate_limited: you have uploaded the most allowed for one day. Try again tomorrow, or tell Katiso.' using errcode = 'P0001'; end if;
  insert into public.sb_assets (id, level, content_type, size_bytes, created_by)
    values (nid, greatest(1, least(coalesce(p_level, 1), 3)), t, p_size, uid);
  return jsonb_build_object('id', nid, 'contentType', t, 'sizeBytes', p_size);
end $$;

create or replace function public.sb_assets_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid();
begin
  return jsonb_build_object('assets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'contentType', content_type, 'sizeBytes', size_bytes, 'createdAt', created_at) order by created_at)
      from public.sb_assets where level <= l and (l >= 3 or created_by = uid)), '[]'::jsonb),
    'usage', jsonb_build_object('files', (select count(*) from public.sb_assets), 'bytes', public.sb_storage_used(null),
      'maxFiles', 20000, 'maxBytes', 600 * 1024 * 1024));
end $$;

-- forgets an upload's record once its file is gone (the board removes the file first). Until then nothing is
-- forgotten, so a file that others rely on cannot be swapped by removing it and uploading again under the same id.
create or replace function public.sb_asset_forget(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); uid uuid := auth.uid(); n int;
begin
  delete from public.sb_assets a where a.id = p_id and (l >= 3 or a.created_by = uid)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'site-board' and o.name = 'a/' || a.id);
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n > 0);
end $$;

-- ---------- project documents library ----------
create or replace function public.sb_files_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('path', path, 'obj', obj, 'size', size_bytes, 'createdAt', created_at, 'type', content_type, 'level', level) order by path collate "C")
                   from public.sb_files where level <= l), '[]'::jsonb);
end $$;

-- adding a project document (editors), in three steps: sb_file_new gives the file its own new name d/<obj>; the board
-- uploads it there; sb_file_commit then puts it in the library under its folder and name, and hands back the name of
-- the copy it replaces so that copy can be removed. If the upload fails, the document already in the library stays.
create or replace function public.sb_file_new(p_path text, p_type text, p_size bigint, p_level int default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); nid text := replace(gen_random_uuid()::text, '-', '');
begin
  if l < 3 then raise exception 'invalid_argument: only editors can add project documents' using errcode = 'P0001'; end if;
  if p_path is null or octet_length(p_path) > 600 or p_path !~ '^[A-Za-z0-9 _.,()&+~-]+(/[A-Za-z0-9 _.,()&+~-]+)*$' or ('/' || p_path) ~ '/[.]' then
    raise exception 'invalid_argument: use letters, digits, spaces and - _ . , ( ) in document and folder names' using errcode = 'P0001'; end if;
  if coalesce(p_size, 0) <= 0 then raise exception 'invalid_request: the file is empty' using errcode = 'P0001'; end if;
  if p_size > 20 * 1024 * 1024 then raise exception 'too_large: documents are limited to 20 MB' using errcode = 'P0001'; end if;
  if public.sb_storage_used(null) + p_size > 600 * 1024 * 1024 then
    raise exception 'quota_exceeded: the site board''s file store is full. Tell Katiso.' using errcode = 'P0001'; end if;
  delete from public.sb_file_up where created_at < now() - interval '1 day';
  if (select count(*) from public.sb_file_up where created_by = auth.uid()) >= 50 then
    raise exception 'rate_limited: finish the uploads already started, then try again' using errcode = 'P0001'; end if;
  insert into public.sb_file_up (obj, path, content_type, size_bytes, level, created_by)
    values (nid, p_path, coalesce(nullif(lower(btrim(p_type)), ''), 'application/octet-stream'), p_size, greatest(1, least(coalesce(p_level, 3), 3)), auth.uid());
  return jsonb_build_object('ok', true, 'path', p_path, 'obj', nid);
end $$;

create or replace function public.sb_file_commit(p_obj text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); u record; real_size bigint; old text;
begin
  if l < 3 then raise exception 'invalid_argument: only editors can add project documents' using errcode = 'P0001'; end if;
  select * into u from public.sb_file_up where obj = p_obj and created_by = auth.uid();
  if not found then raise exception 'invalid_argument: this upload was not started here, or it is too old' using errcode = 'P0001'; end if;
  select (o.metadata ->> 'size')::bigint into real_size from storage.objects o where o.bucket_id = 'site-board' and o.name = 'd/' || p_obj;
  if not found then raise exception 'invalid_request: the file did not arrive. Upload it again.' using errcode = 'P0001'; end if;
  select obj into old from public.sb_files where path = u.path for update;
  insert into public.sb_files (path, obj, content_type, size_bytes, level, created_by)
    values (u.path, p_obj, u.content_type, coalesce(real_size, u.size_bytes), u.level, auth.uid())
  on conflict (path) do update set obj = excluded.obj, content_type = excluded.content_type, size_bytes = excluded.size_bytes,
    level = excluded.level, created_by = excluded.created_by, created_at = now();
  delete from public.sb_file_up where obj = p_obj;
  return jsonb_build_object('ok', true, 'path', u.path, 'old', case when old is distinct from p_obj then old end);
end $$;

-- takes a document out of the library and hands back its stored name, so the board removes the file itself
create or replace function public.sb_file_forget(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l int := public.sb_need_member(); o text; n int;
begin
  if l < 3 then raise exception 'invalid_argument: only editors can remove project documents' using errcode = 'P0001'; end if;
  delete from public.sb_files where path = p_path returning obj into o; get diagnostics n = row_count;
  return jsonb_build_object('deleted', n > 0, 'obj', o);
end $$;

-- library files no longer in use (an older copy, a failed upload): the board of an editor removes them when it opens
create or replace function public.sb_files_orphans() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member();
begin
  if l < 3 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x.name) from (
      select o.name from storage.objects o
       where o.bucket_id = 'site-board' and o.name like 'd/%'
         and not exists (select 1 from public.sb_files f where 'd/' || coalesce(f.obj, f.path) = o.name)
         and not exists (select 1 from public.sb_file_up p where 'd/' || p.obj = o.name and p.created_at > now() - interval '1 hour')
       limit 200) x), '[]'::jsonb);
end $$;

-- ---------- reference data ----------
create or replace function public.sb_app_get(p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member();
begin
  return coalesce((select jsonb_object_agg(key, value) from public.sb_app where key = any (p_keys) and level <= l), '{}'::jsonb);
end $$;

-- when each of these was last changed, so a phone downloads the board's screens and data again only when they change
create or replace function public.sb_app_stamp(p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_need_member();
begin
  return coalesce((select jsonb_object_agg(key, to_char(updated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'))
                   from public.sb_app where key = any (p_keys) and level <= l), '{}'::jsonb);
end $$;

-- ---------- storage rules (used by the policies on the site-board bucket) ----------
create or replace function public.sb_obj_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_lvl();
begin
  if l = 0 or p_name is null then return false; end if;
  if p_name like 'a/%' then return exists (select 1 from public.sb_assets where id = substr(p_name, 3) and level <= l); end if;
  -- editors see every library file (so they can remove old copies); others only the current copy at their level
  if p_name like 'd/%' then return l >= 3 or exists (select 1 from public.sb_files where 'd/' || coalesce(obj, path) = p_name and level <= l); end if;
  return false;
end $$;

-- a new file goes up only to a name reserved by the same person in the last hour, while the file store has room
create or replace function public.sb_obj_insert(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_lvl();
begin
  if l < 2 or p_name is null then return false; end if;
  if p_name like 'a/%' then
    return exists (select 1 from public.sb_assets where id = substr(p_name, 3) and created_by = auth.uid() and created_at > now() - interval '1 hour')
       and public.sb_storage_used(null) < 600 * 1024 * 1024 and public.sb_storage_used(auth.uid()) < 200 * 1024 * 1024;
  end if;
  if p_name like 'd/%' then
    return l >= 3 and exists (select 1 from public.sb_file_up where obj = substr(p_name, 3) and created_by = auth.uid() and created_at > now() - interval '1 hour')
       and public.sb_storage_used(null) < 600 * 1024 * 1024;
  end if;
  return false;
end $$;

-- nothing in the bucket is ever overwritten in place: a newer copy of a document gets a new name
create or replace function public.sb_obj_replace(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return false;
end $$;

-- editors remove files; the person who uploaded a file may take it back within the hour
create or replace function public.sb_obj_delete(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare l int := public.sb_lvl();
begin
  if l < 2 or p_name is null then return false; end if;
  if p_name like 'a/%' then
    return l >= 3 or exists (select 1 from public.sb_assets where id = substr(p_name, 3) and created_by = auth.uid() and created_at > now() - interval '1 hour');
  end if;
  if p_name like 'd/%' then return l >= 3; end if;
  return false;
end $$;

-- ---------- service-role helpers for the sync workflow and set-up ----------
-- the private key that opens sealed sync files, kept in the project vault (entry site_board_sync_key)
create or replace function public.sb_admin_sync_key() returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'site_board_sync_key' limit 1
$$;

create or replace function public.sb_admin_put_docs(p_docs jsonb, p_replace boolean default false, p_by uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; n_new int := 0; n_kept int := 0; n_rep int := 0;
begin
  for d in select * from jsonb_array_elements(p_docs) loop
    if not public.sb_path_ok(d ->> 'path', true) or jsonb_typeof(d -> 'data') <> 'object' then
      raise exception 'bad document %', d ->> 'path'; end if;
    if exists (select 1 from public.sb_docs where path = d ->> 'path') then
      if p_replace then
        update public.sb_docs set data = d -> 'data', rev = nextval('public.sb_rev_seq'), updated_at = now(), updated_by = p_by where path = d ->> 'path';
        n_rep := n_rep + 1;
      else n_kept := n_kept + 1; end if;
    else
      insert into public.sb_docs (path, coll, doc_id, data, rev, created_by, updated_by)
        values (d ->> 'path', public.sb_parent(d ->> 'path'), public.sb_leaf(d ->> 'path'), d -> 'data', nextval('public.sb_rev_seq'), p_by, p_by);
      delete from public.sb_gone where path = d ->> 'path';
      n_new := n_new + 1;
    end if;
  end loop;
  return jsonb_build_object('added', n_new, 'kept', n_kept, 'replaced', n_rep);
end $$;

-- is this login also a Tender Desk login (a staff row for it, active or not, by id or by email)?
create or replace function public.sb_admin_is_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.user_id = p_user
                    or lower(s.email) = (select lower(u.email) from auth.users u where u.id = p_user))
$$;

-- the Team page's server-side checks (called by the site-board-api function with the service role)
create or replace function public.sb_admin_member_check(p_caller uuid, p_role text default null, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; t record;
begin
  select * into c from public.sb_members where user_id = p_caller and active;
  if not found or c.role not in ('owner', 'editor') then raise exception 'Only editors can manage the site board team.'; end if;
  if p_role is not null then
    if p_role not in ('editor', 'contributor', 'viewer') then raise exception 'The role must be editor, contributor or viewer.'; end if;
    if p_role = 'editor' and c.role <> 'owner' then raise exception 'Only the owner can add editors.'; end if;
  end if;
  if p_target is not null then
    select * into t from public.sb_members where user_id = p_target;
    if not found then raise exception 'That person is not on the site board team.'; end if;
    if p_target = p_caller then raise exception 'Change your own password from your account menu.'; end if;
    if t.role = 'owner' then raise exception 'The owner''s password cannot be reset here.'; end if;
    if t.role = 'editor' and c.role <> 'owner' then raise exception 'Only the owner can give an editor a new password.'; end if;
    -- a login shared with the Tender Desk (now or in the past) is reset from here only by a Tender Desk administrator
    if public.sb_admin_is_staff(p_target)
       and not exists (select 1 from public.staff s where s.user_id = p_caller and s.active and s.role = 'admin') then
      raise exception 'This person also uses the Tender Desk with this login. Ask a Tender Desk administrator for their new password.'; end if;
    return jsonb_build_object('ok', true, 'email', t.email, 'name', t.full_name, 'role', t.role);
  end if;
  return jsonb_build_object('ok', true, 'role', c.role);
end $$;

-- may this editor add this login with this role? (raises with the reason if not; called before any password is set)
create or replace function public.sb_admin_member_can_add(p_caller uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  perform public.sb_admin_member_check(p_caller, p_role);
  select * into t from public.sb_members where user_id = p_user;
  if found and t.active then raise exception '% is already on the site board team.', coalesce(nullif(t.full_name, ''), t.email); end if;
  -- the same rule as the Team page: only the owner gives a former editor (or the owner) access again
  if found and t.role in ('owner', 'editor') and not exists (select 1 from public.sb_members c where c.user_id = p_caller and c.active and c.role = 'owner') then
    raise exception 'Only the owner can give a former editor access again.'; end if;
  return jsonb_build_object('ok', true, 'returning', found);
end $$;

create or replace function public.sb_admin_member_add(p_caller uuid, p_user uuid, p_email text, p_name text, p_role text, p_temp boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  perform public.sb_admin_member_can_add(p_caller, p_user, p_role);
  select * into t from public.sb_members where user_id = p_user;
  if found then
    update public.sb_members set role = p_role, active = true, email = lower(btrim(p_email)), full_name = coalesce(nullif(btrim(p_name), ''), full_name),
      must_change_password = must_change_password or p_temp where user_id = p_user;
  else
    insert into public.sb_members (user_id, email, full_name, role, active, must_change_password, created_by)
      values (p_user, lower(btrim(p_email)), coalesce(btrim(p_name), ''), p_role, true, p_temp, p_caller);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sb_admin_mark_temp(p_user uuid) returns void
language sql security definer set search_path = public as $$ update public.sb_members set must_change_password = true where user_id = p_user $$;

create or replace function public.sb_admin_set_owner(p_user uuid, p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sb_members (user_id, email, full_name, role, active, must_change_password)
    values (p_user, lower(btrim(p_email)), coalesce(p_name, ''), 'owner', true, false)
  on conflict (user_id) do update set role = 'owner', active = true, email = excluded.email, full_name = coalesce(nullif(excluded.full_name, ''), public.sb_members.full_name);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sb_admin_put_app(p_key text, p_value jsonb, p_level int default 1) returns jsonb
language sql security definer set search_path = public as $$
  insert into public.sb_app (key, value, level, updated_at) values (p_key, p_value, greatest(1, least(coalesce(p_level, 1), 4)), now())
  on conflict (key) do update set value = excluded.value, level = excluded.level, updated_at = now()
  returning jsonb_build_object('ok', true, 'key', key, 'bytes', octet_length(value::text));
$$;

create or replace function public.sb_admin_put_asset(p_id text, p_type text, p_size bigint, p_level int default 1, p_by uuid default null) returns jsonb
language sql security definer set search_path = public as $$
  insert into public.sb_assets (id, level, content_type, size_bytes, created_by) values (lower(p_id), greatest(1, least(coalesce(p_level, 1), 3)), p_type, p_size, p_by)
  on conflict (id) do update set level = excluded.level, content_type = excluded.content_type, size_bytes = excluded.size_bytes
  returning jsonb_build_object('ok', true, 'id', id);
$$;

-- puts a library document in place (the sync workflow uploads it first to d/<obj>); hands back the copy it replaces
drop function if exists public.sb_admin_put_file(text, text, bigint, int);
create or replace function public.sb_admin_put_file(p_path text, p_type text, p_size bigint, p_level int, p_obj text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old text;
begin
  if p_obj !~ '^[0-9a-f]{32}$' then raise exception 'bad file name %', p_obj; end if;
  if p_path is null or octet_length(p_path) > 600 or p_path !~ '^[A-Za-z0-9 _.,()&+~-]+(/[A-Za-z0-9 _.,()&+~-]+)*$' or ('/' || p_path) ~ '/[.]' then
    raise exception 'bad document name'; end if;
  select obj into old from public.sb_files where path = p_path for update;
  insert into public.sb_files (path, obj, content_type, size_bytes, level) values (p_path, p_obj, p_type, p_size, greatest(1, least(coalesce(p_level, 3), 3)))
  on conflict (path) do update set obj = excluded.obj, content_type = excluded.content_type, size_bytes = excluded.size_bytes, level = excluded.level, created_at = now();
  return jsonb_build_object('ok', true, 'path', p_path, 'old', case when old is distinct from p_obj then old end);
end $$;

-- the key pair for sealed sync files is made by the site-board-api function itself, the first time the sync workflow
-- runs: the private key goes straight into the project vault and only the public key comes out, so no person ever
-- holds the private key. Only the function (service role) can call this, and only once.
create or replace function public.sb_admin_sync_key_init(p_private text, p_public text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from vault.secrets where name = 'site_board_sync_key') then return false; end if;
  perform vault.create_secret(p_private, 'site_board_sync_key', 'Opens the site board sync files (made by the site-board-api function)');
  insert into public.sb_app (key, value, level) values ('sync_public_key', to_jsonb(p_public), 4)
  on conflict (key) do update set value = excluded.value, level = 4, updated_at = now();
  return true;
end $$;

create or replace function public.sb_admin_sync_public() returns text
language sql stable security definer set search_path = public as $$ select value #>> '{}' from public.sb_app where key = 'sync_public_key' $$;

create or replace function public.sb_admin_sync_seen(p_sha text) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.sb_sync_log where sha256 = p_sha) $$;

create or replace function public.sb_admin_sync_done(p_sha text, p_name text, p_kind text, p_result jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.sb_sync_log (sha256, name, kind, result) values (p_sha, p_name, p_kind, p_result)
  on conflict (sha256) do update set result = excluded.result, at = now()
$$;

-- ---------- who may call what ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sb\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.sb_whoami(), public.sb_password_changed(), public.sb_people(), public.sb_team(),
  public.sb_team_set(uuid, text, boolean, text), public.sb_get(text), public.sb_list(text), public.sb_set(text, jsonb),
  public.sb_update(text, jsonb), public.sb_delete(text), public.sb_changes(timestamptz), public.sb_asset_new(text, bigint, int),
  public.sb_assets_list(), public.sb_asset_forget(text), public.sb_files_list(), public.sb_file_new(text, text, bigint, int),
  public.sb_file_commit(text), public.sb_file_forget(text), public.sb_files_orphans(), public.sb_app_get(text[]), public.sb_app_stamp(text[]),
  public.sb_obj_read(text), public.sb_obj_insert(text), public.sb_obj_delete(text), public.sb_obj_replace(text) to authenticated;
grant execute on function public.sb_admin_put_docs(jsonb, boolean, uuid), public.sb_admin_member_check(uuid, text, uuid),
  public.sb_admin_member_add(uuid, uuid, text, text, text, boolean), public.sb_admin_mark_temp(uuid), public.sb_admin_set_owner(uuid, text, text),
  public.sb_admin_put_app(text, jsonb, int), public.sb_admin_put_asset(text, text, bigint, int, uuid), public.sb_admin_put_file(text, text, bigint, int, text),
  public.sb_admin_sync_seen(text), public.sb_admin_sync_done(text, text, text, jsonb), public.sb_admin_sync_key(),
  public.sb_admin_sync_key_init(text, text), public.sb_admin_sync_public(), public.sb_admin_is_staff(uuid),
  public.sb_admin_member_can_add(uuid, uuid, text) to service_role;
