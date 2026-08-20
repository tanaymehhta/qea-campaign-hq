-- ============================================================
-- A hand-logged meeting knows when it was agreed.
--
-- 20260820174533 established what a date window over meetings means — *booked
-- in this window*, not *the meeting falls in it* — and gave `log_call` the
-- column to answer with. It deliberately left the manual form alone, calling
-- that a separate decision. This is that decision.
--
-- The cost of leaving it, measured on 20 Aug by logging a meeting through the
-- form and then reading the Overview tile:
--
--   logged 20 Aug, for 21 Aug        range=today    0 meetings
--                                    range=7        0 meetings
--                                    range=30       0 meetings
--                                    range=all      1
--
-- Zero on every dated view, under a tile that prints "counted from the day it
-- was booked". `booked_on` was null, so `scope_date` fell back to the meeting's
-- own date — which is in the future, and therefore outside every window that
-- ends today. A rep books September on the phone this afternoon, types it in,
-- and the number the company steers on does not move until September.
--
-- The calls path has been right about this since 20 Aug. This is the same rule
-- through the other door.
--
-- ---------------------------------------------------------------------------
-- Null is refused, not defaulted.
--
-- `p_booked_on` takes a default of null so an old caller gets a sentence rather
-- than "function not found", and then the function raises. It does NOT quietly
-- substitute current_date: silently dating a meeting by something other than
-- what the person meant is exactly the fault being fixed here, and doing it in
-- the other direction would be no better. The form supplies today; a human who
-- disagrees can say so before pressing the button.
--
-- Same shape as log_call's refusal of a booked meeting with no meeting date,
-- which has been in front of reps for a day and reads well.
--
-- ---------------------------------------------------------------------------
-- Nothing already on the board moves. The four rows logged before the column
-- existed keep `booked_on = null` and the `coalesce(booked_on, meeting_date)`
-- fallback in meeting_rows — nobody recorded when they were agreed, and
-- inventing a date from `created_at` is the guess 20260820174533 refused for a
-- good reason: Jeffrey Hohenstein's two rows were both typed on 30 July, one of
-- them for a meeting that had already happened on the 22nd. Null means "not
-- known", which is true.
-- ============================================================

-- Dropped and recreated rather than replaced: a new argument is a new
-- signature, and leaving the eight-argument version in place would give
-- PostgREST two candidates and let an old caller keep writing null.
drop function if exists public.log_meeting(text, text, text, date, uuid, text, text, text);

create or replace function public.log_meeting(
  p_name text, p_email text, p_company text, p_date date,
  p_group uuid, p_evidence text, p_note text, p_logged_by text,
  p_booked_on date default null
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
  -- The rule that stops a meeting being invisible on every dated view. Said as
  -- a sentence, because the rep reads it on the page they were typing on.
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

  -- A duplicate is refused loudly, not deduped silently: the person at the
  -- form should learn the meeting is already on the board. Re-keyed in Phase 4;
  -- unchanged here beyond echoing the stored name rather than the lowered input.
  if exists (
    select 1 from meetings
     where lower(trim(prospect_name)) = lower(v_name)
       and coalesce(lower(prospect_email), '') = coalesce(v_email, '')
       and meeting_date = p_date
  ) then
    raise exception 'a meeting with % on % is already logged', v_name, p_date;
  end if;

  insert into meetings (group_id, prospect_name, prospect_email, company, meeting_date,
                        booked_on, status, evidence, logged_by, note)
  values (p_group, v_name, v_email,
          nullif(trim(coalesce(p_company, '')), ''), p_date,
          p_booked_on, 'booked', v_evidence,
          nullif(trim(coalesce(p_logged_by, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''));
end $$;

grant execute on function public.log_meeting(text, text, text, date, uuid, text, text, text, date)
  to anon, authenticated;
