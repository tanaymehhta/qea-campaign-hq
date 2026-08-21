-- Who has already reached out to an account, and when.
--
-- The one fact on the inbound pages that no pipeline stage can produce:
-- reaching out happens in a mailbox, not in a graph run. Two columns on the
-- company rather than a table of its own — it is one answer per account, it is
-- replaced rather than accumulated, and every page that shows it is already
-- reading this row.
--
-- Deliberately not `assigned_to`: that column is the sender the drafting stage
-- signs mail as, and a NULL there blocks drafting. Overloading it would make
-- ticking a checkbox change what the pipeline writes.
alter table public.inbound_companies
  add column if not exists reached_out_by text,
  add column if not exists reached_out_at timestamptz;

comment on column public.inbound_companies.reached_out_by is
  'Rep who has contacted this account, as a rep id from lib/inbound/routing.js (e.g. mark-vasu). NULL = nobody has, which is the state every row starts in. Set by hand from the inbound queue; no pipeline stage writes it.';
comment on column public.inbound_companies.reached_out_at is
  'When reached_out_by was set. Cleared together with it when a rep unticks.';

-- Same shape as the other three hand controls: the anon key cannot UPDATE this
-- table, so the write goes through a function that validates its own arguments
-- and a hostile POST meets the same rules the UI does.
create or replace function inbound_set_reached_out(p_company uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- An empty string is not a name. It would render as a blank on every card
  -- that showed it, which reads as ticked by nobody.
  if p_by is not null and (btrim(p_by) = '' or length(p_by) > 60) then
    raise exception 'that is not a name we can record';
  end if;

  update inbound_companies set
    reached_out_by = btrim(p_by),
    -- Untick clears both halves: a timestamp with nobody attached to it is a
    -- worse record than no record.
    reached_out_at = case when p_by is null then null else now() end,
    updated_at = now()
  where id = p_company;

  if not found then raise exception 'no such company'; end if;
end $$;

revoke all on function inbound_set_reached_out(uuid, text) from public;
grant execute on function inbound_set_reached_out(uuid, text) to anon;
