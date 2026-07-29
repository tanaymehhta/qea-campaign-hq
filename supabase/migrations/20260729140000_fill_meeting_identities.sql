-- Fill a hand-logged meeting's email from the person record it belongs to.
--
-- Meetings are typed by hand and the email is the field that gets skipped. Mark
-- Attard's 28 July meeting had a name, a company and a campaign, and no address
-- — while `connect@point6.pro` sat in people, leads, replies and activities on
-- that very campaign. The address was never missing, only unrecorded twice.
--
-- It matters because the person hub is keyed on the address. No email means the
-- name on the meetings page cannot link anywhere, which reads as a broken link
-- when it is really a blank field.
--
-- This mirrors fill_reply_identity(), which already fills a reply's name and
-- company from `people`, and runs in the same direction: whatever the tools
-- know, the hand-kept table should not have to repeat.
--
-- Matched on campaign and name, and only when that name is unambiguous within
-- the campaign. A name is a weaker key than an address, so where two people in
-- one campaign share a name the field is left blank rather than guessed.

create or replace function fill_meeting_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.prospect_email is not null then return new; end if;
  if new.prospect_name is null or btrim(new.prospect_name) = '' then return new; end if;

  select p.email, coalesce(new.company, p.company)
    into new.prospect_email, new.company
    from people p
   where p.campaign_id = new.campaign_id
     and lower(btrim(p.name)) = lower(btrim(new.prospect_name))
     and p.email is not null
   group by p.email, p.company
  having count(*) over () = 1;

  return new;
end $$;

drop trigger if exists meetings_fill_identity on meetings;
create trigger meetings_fill_identity
  before insert or update on meetings
  for each row execute function fill_meeting_identity();

-- The same thing for the rows already sitting there.
create or replace function fill_meeting_identities()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n integer;
begin
  update meetings m
     set prospect_email = p.email,
         company        = coalesce(m.company, p.company)
    from (
      select campaign_id, lower(btrim(name)) as key, min(email) as email, min(company) as company
        from people
       where email is not null and btrim(coalesce(name, '')) <> ''
       group by campaign_id, lower(btrim(name))
      having count(distinct lower(email)) = 1
    ) p
   where p.campaign_id = m.campaign_id
     and p.key = lower(btrim(m.prospect_name))
     and m.prospect_email is null;
  get diagnostics n = row_count;
  return n;
end $$;

select fill_meeting_identities();
