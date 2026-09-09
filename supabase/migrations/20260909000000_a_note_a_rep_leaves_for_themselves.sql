-- A place for a rep to write down what the pipeline cannot know.
--
-- Asked for after Gardant: the company on file is one of several names the
-- same account trades under, and the person who noticed has nowhere to leave
-- that for the next rep who opens the page. One column, replaced rather than
-- accumulated, same shape as reached_out_by/at — it is one reminder per
-- account, not a log.
alter table public.inbound_companies
  add column if not exists notes text;

comment on column public.inbound_companies.notes is
  'A free-text reminder a rep leaves on the account — a different name to contact, how it relates to another company on file. Set by hand from the inbound company page; no pipeline stage writes or reads it.';

-- Same shape as inbound_set_reached_out: the anon key cannot UPDATE this
-- table, so the write goes through a function that validates its own
-- arguments and a hostile POST meets the same rules the UI does.
create or replace function inbound_set_company_notes(p_company uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'that note is too long';
  end if;

  update inbound_companies set
    -- An empty textarea clears the reminder rather than saving a blank line.
    notes = nullif(btrim(p_note), ''),
    updated_at = now()
  where id = p_company;

  if not found then raise exception 'no such company'; end if;
end $$;

revoke all on function inbound_set_company_notes(uuid, text) from public;
grant execute on function inbound_set_company_notes(uuid, text) to anon;
