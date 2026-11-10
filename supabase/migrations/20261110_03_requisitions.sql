-- Pump Group requisitions app (Mashaeng WWTW, contract TS004-2026): access rule for its records.
-- The requisitions app keeps its records in the site board's document store (sb_docs), in two groups of its own:
--   rq          requisitions, orders, deliveries and messages   read: contributor   write: contributor
--   rq_office   approvals and close-outs                         read: contributor   write: editor
--   rq_cfg      what the app prints on (the letterhead)          read: contributor   write: editor
-- Order values, invoices and payments stay in the existing costs ledger (editors only).
-- Viewers (for instance the Engineer on the site board) can read none of these groups, and a site login cannot
-- write an approval. Everything else is exactly as in 20261028_01_site_board_core.sql. Safe to run more than once.
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
    when top in ('workers', 'attend', 'training', 'rq') then 2
    when top in ('rq_office', 'rq_cfg') then case when p_write then 3 else 2 end
    when p_write then 2 else 1 end;
end $$;

-- lets the requisitions app see that this rule is in place (read by the Pump Group team, not by viewers)
insert into public.sb_app (key, value, level) values ('rq_setup', '{"v": 1}'::jsonb, 2)
on conflict (key) do update set value = excluded.value, level = excluded.level, updated_at = now();
