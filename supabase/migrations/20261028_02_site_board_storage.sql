-- Pump Group site board: private file bucket. a/<id> holds uploads from the board (photos, scans, invoices),
-- d/<obj> the project documents library (each copy of a document under its own fixed name). Who may read each file
-- is decided by sb_obj_read (see the core migration): uploads by their level, library documents by the level set
-- when they were added. 20 MB a file, which the file store itself enforces on the bytes that arrive.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-board', 'site-board', false, 20971520, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'video/quicktime', 'video/webm',
  'text/csv', 'text/plain', 'application/json', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-project', 'application/xml', 'text/xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site board read" on storage.objects;
drop policy if exists "site board add" on storage.objects;
drop policy if exists "site board remove" on storage.objects;
drop policy if exists "site board replace" on storage.objects;
create policy "site board read" on storage.objects for select to authenticated
  using (bucket_id = 'site-board' and public.sb_obj_read(name));
create policy "site board add" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-board' and public.sb_obj_insert(name));
create policy "site board remove" on storage.objects for delete to authenticated
  using (bucket_id = 'site-board' and public.sb_obj_delete(name));
create policy "site board replace" on storage.objects for update to authenticated
  using (bucket_id = 'site-board' and public.sb_obj_replace(name))
  with check (bucket_id = 'site-board' and public.sb_obj_replace(name));
