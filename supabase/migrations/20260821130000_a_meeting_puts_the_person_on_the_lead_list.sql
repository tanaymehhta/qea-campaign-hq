-- ============================================================
-- A meeting with somebody nobody has heard of puts them on the lead list.
--
-- Tanay, 21 August 2026: "sometimes I do a meeting with someone that I meet
-- through a campaign and he forwards the name to someone else and then I meet
-- them. Technically they are also from the campaign but they are not on any
-- list." He logs the meeting, the KPI moves, and the man he met is invisible on
-- /leads — the page whose entire job is to be the thing you check before you
-- contact somebody. The next rep chases him cold.
--
-- ---------------------------------------------------------------------------
-- Which table, and why it is not `people`
--
-- /leads reads `v_lead_people` <- `v_leads`, which is a union of two tables that
-- are not interchangeable:
--
--   `people`  the VENDOR copy. Instantly and lemlist sync into it every 30
--             minutes. A row typed in by hand here is a foreign body: the sync
--             owns the key (campaign_id, email) and nothing in this repository
--             writes to it.
--
--   `leads`   the HUMAN copy. 1,950 rows, imported from spreadsheets, and — as
--             of this migration — no writer anywhere in the repository. It
--             already means exactly "a person somebody put on a list, from a
--             named source". That is what this is.
--
-- So the row goes in `leads`, with source_list = 'hand'. Its unique key is
-- (source_list, email), which does the deduplicating for free: a second meeting
-- with the same man cannot make a second lead.
--
-- ---------------------------------------------------------------------------
-- Three deliberate limits
--
-- 1. NO EMAIL, NO ROW. `v_lead_people` builds its email side from
--    `where vl.email is not null`. A lead with no address would be written and
--    then never appear on the page it was written for. The meeting is still
--    logged — the address is optional there and stays optional.
--
-- 2. ONLY SOMEBODY GENUINELY NEW. If the address is already in `people`, they
--    are already on /leads and there is nothing to add. Writing anyway would
--    not duplicate the row — the union's second arm excludes addresses `people`
--    holds — but `lead_one` would attach this row's status to an existing
--    human, and 'prospect' would appear against people whose status has always
--    been an em dash. That is a visible number moving as a side effect of an
--    unrelated write, which is the thing this codebase keeps undoing.
--
-- 3. STATUS IS 'prospect', NOT 'met'. `leads.status` is a five-value check
--    constraint describing a pipeline, and "we have met" is already a row in
--    `meetings`. A status saying so would be a second answer to a question that
--    already has one, free to disagree with it. The lead is a prospect; the
--    meeting is the meeting.
--
-- The insert is in the same transaction as the meeting, so the two cannot
-- half-happen.
-- ============================================================

create or replace function public.log_meeting(
  p_name text, p_email text, p_company text, p_date date,
  p_group uuid, p_evidence text, p_note text, p_logged_by text,
  p_booked_on date default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_email text; v_evidence text; v_clash text; v_campaign uuid;
begin
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'the prospect''s name is required'; end if;
  if p_date is null then raise exception 'the meeting date is required'; end if;
  if p_booked_on is null then
    raise exception 'a meeting needs the date it was agreed — the day it was booked, which is what every date window on the dashboard counts by, not the day it happens';
  end if;
  if p_booked_on > p_date then
    raise exception 'a meeting cannot be agreed on % and happen earlier, on %', p_booked_on, p_date;
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

  -- The address is identity. A name is not, so a name-only match is inserted
  -- and surfaced as a duplicate rather than refused.
  v_clash := meeting_clash(p_date, v_email);
  if v_clash is not null then
    raise exception 'a meeting with % on % is already logged — the same email address, so this is the same meeting. Change that one instead, or use a different date',
      v_clash, to_char(p_date, 'DD Mon');
  end if;

  -- Decision 0.6. The address resolves the person, the person carries a
  -- campaign, and the meeting lands on the sub-campaign as well as the group.
  -- The rep's own choice of group wins.
  if v_email is not null then
    select p.campaign_id into v_campaign
      from people p
     where p.email = v_email
       and p.campaign_id is not null
       and (p_group is null or exists (
             select 1 from campaign_group_members mm
              where mm.campaign_id = p.campaign_id and mm.group_id = p_group))
     order by p.last_contacted_at desc nulls last
     limit 1;
  end if;

  insert into meetings (campaign_id, group_id, prospect_name, prospect_email, company,
                        meeting_date, booked_on, status, evidence, logged_by, note)
  values (v_campaign, p_group, v_name, v_email,
          nullif(trim(coalesce(p_company, '')), ''), p_date,
          p_booked_on, 'booked', v_evidence,
          nullif(trim(coalesce(p_logged_by, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''));

  -- ---------------------------------------------------------------------
  -- New here: the person lands on the lead list. See the header for why this
  -- is `leads` and not `people`, and for each of the three conditions below.
  -- ---------------------------------------------------------------------
  if v_email is not null
     and not exists (select 1 from people p where lower(p.email) = v_email)
  then
    insert into leads (source_list, source_file, group_id, campaign_id,
                       name, email, company, status)
    values ('hand',
            nullif(trim(coalesce(p_logged_by, '')), ''),
            p_group, v_campaign, v_name, v_email,
            nullif(trim(coalesce(p_company, '')), ''),
            'prospect')
    -- Idempotent by the table's own key. A second meeting with the same man
    -- keeps the first row rather than raising at him mid-form.
    on conflict (source_list, email) do nothing;
  end if;
end $$;

grant execute on function public.log_meeting(text, text, text, date, uuid, text, text, text, date)
  to anon, authenticated;
