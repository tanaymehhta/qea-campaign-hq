-- ============================================================
-- fill_meeting_identity() has been broken since it shipped:
-- `having count(*) over () = 1` is invalid SQL (window functions are
-- not allowed in HAVING), so every INSERT or UPDATE on meetings where
-- prospect_email was null and prospect_name was set raised 42P20 and
-- rolled back. It went unnoticed because hand-entered rows carried an
-- email; log_call() inserting meetings for phone contacts (who often
-- have no email yet) hit it immediately.
--
-- Rewritten the way the batch backfill fill_meeting_identities()
-- already does it: plain aggregates, one candidate only when exactly
-- one distinct email matches the name within the campaign. A meeting
-- with no campaign_id (the phone world) matches nothing and passes
-- through untouched.
-- ============================================================

create or replace function fill_meeting_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text; v_company text;
begin
  if new.prospect_email is not null then return new; end if;
  if new.prospect_name is null or btrim(new.prospect_name) = '' then return new; end if;

  select min(p.email), min(p.company)
    into v_email, v_company
    from people p
   where p.campaign_id = new.campaign_id
     and lower(btrim(p.name)) = lower(btrim(new.prospect_name))
     and p.email is not null
  having count(distinct lower(p.email)) = 1;

  if v_email is not null then
    new.prospect_email := v_email;
    new.company := coalesce(new.company, v_company);
  end if;

  return new;
end $$;
