-- ============================================================
-- The last missing write: meetings were "logged by hand", which in
-- practice meant someone with SQL access. STATE.md open item 4, and
-- the reason the Conflicts page had to say "hand-written row in the
-- meetings table". Same shape as every other write: security definer,
-- validates its own arguments, granted to anon.
--
-- Always inserts status 'booked' — a meeting is logged when it is
-- booked; held/no_show/cancelled are later state changes and stay a
-- manual job for now. The group is optional and scopes the meeting to
-- a rep's view; campaign_id stays null (hand-logged meetings rarely
-- know their exact sub-campaign, and the group is what scoping uses).
-- ============================================================

create or replace function public.log_meeting(
  p_name text, p_email text, p_company text, p_date date,
  p_group uuid, p_evidence text, p_note text, p_logged_by text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_email text; v_evidence text;
begin
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'the prospect''s name is required';
  end if;
  if p_date is null then
    raise exception 'the meeting date is required';
  end if;

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" does not look like an email address', v_email;
  end if;

  v_evidence := coalesce(nullif(trim(coalesce(p_evidence, '')), ''), 'chat');
  if v_evidence not in ('tool', 'calendar', 'crm', 'chat') then
    raise exception 'evidence must be tool, calendar, crm or chat — not "%"', v_evidence;
  end if;

  if p_group is not null and not exists (select 1 from campaign_groups where id = p_group) then
    raise exception 'no campaign group with that id';
  end if;

  -- A duplicate is refused loudly, not deduped silently: the person at the
  -- form should learn the meeting is already on the board.
  if exists (
    select 1 from meetings
     where lower(trim(prospect_name)) = lower(v_name)
       and coalesce(lower(prospect_email), '') = coalesce(v_email, '')
       and meeting_date = p_date
  ) then
    raise exception 'a meeting with % on % is already logged', v_name, p_date;
  end if;

  insert into meetings (group_id, prospect_name, prospect_email, company, meeting_date,
                        status, evidence, logged_by, note)
  values (p_group, v_name, v_email,
          nullif(trim(coalesce(p_company, '')), ''), p_date,
          'booked', v_evidence,
          nullif(trim(coalesce(p_logged_by, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''));
end $$;

grant execute on function public.log_meeting(text, text, text, date, uuid, text, text, text)
  to anon, authenticated;
