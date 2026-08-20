-- ============================================================
-- Four outcomes, and one row per call.
--
-- Decided by Tanay on 20 August 2026, after reading the seven-outcome version
-- back: "We have way too overcomplicated it."
--
-- The rule, in his words: pick a person, mark one of four, press Add. That is
-- one phone call, whatever the outcome. It moves exactly two numbers on the
-- Overview — Calls logged always, Meetings booked when the answer is a meeting.
--
-- Two things change to make that true.
--
-- 1. SEVEN OUTCOMES BECOME FOUR.
--
--      booked_meeting   they agreed to a meeting
--      follow_up        you spoke to someone, ring them back
--      not_interested   you spoke to someone, they said no
--      not_reached      you did not get them
--
--    `no_answer`, `left_voicemail`, `left_email` and `other` were four names
--    for the same fact — you did not talk to them — and the tile built on top
--    of them was called "No answer" while counting all four. It read 6 when no
--    call in this database has ever had that outcome. Whether a voicemail was
--    left is a sentence in the note, not a category the dashboard counts.
--
--    `other` folds in here rather than into a live conversation. Its one row —
--    Ruslan Solovyev, "sent email, no phone available" — is a person nobody
--    spoke to, and it was being counted in "Spoke to someone".
--
-- 2. ONE ADD BECOMES ONE ROW.
--
--    The form posted one insert per ticked checkbox, so one dial that ended
--    "left a voicemail and an email" became two rows and counted as two calls.
--    16 rows were 11 calls. Five pairs are collapsed below — every one of them
--    is the same person, the same day and the same note, written twice — and
--    they are soft-deleted rather than removed, because `deleted_at` is the
--    rule every call reader already honours and a row is evidence.
--
--    A genuine second dial to the same person on the same day is still two
--    rows and still two calls. Only the duplicate halves of one dial go.
-- ============================================================

-- The column's own check constraint is the real guard — the function's `if` is
-- there to raise a sentence a rep can read, not to be the only thing stopping a
-- bad value. Both list the same four.
alter table phone_calls drop constraint if exists phone_calls_outcome_check;

-- Four names, applied before the dedup below so the pairs can see each other.
update phone_calls
   set outcome = 'not_reached'
 where outcome in ('no_answer', 'left_voicemail', 'left_email', 'other');

-- The same dial written twice. Keyed on (contact, day, outcome, note) so two
-- real calls on one day — different notes, or one reached and one not — both
-- survive. The earliest row of each pair is the one that stays.
with dupes as (
  select id,
         row_number() over (
           partition by contact_id, call_date, outcome, coalesce(note, '')
           order by created_at, id
         ) as n
    from phone_calls
   where deleted_at is null
     and contact_id is not null
)
update phone_calls p
   set deleted_at = now()
  from dupes d
 where p.id = d.id and d.n > 1;

alter table phone_calls add constraint phone_calls_outcome_check
  check (outcome in ('booked_meeting', 'follow_up', 'not_interested', 'not_reached'));

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text,
  p_note text, p_callback date, p_meeting_date date default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_label text; v_note text; v_email text; v_org text; v_call uuid;
begin
  if p_outcome not in ('booked_meeting', 'follow_up', 'not_interested', 'not_reached') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;
  if p_outcome = 'booked_meeting' and p_meeting_date is null then
    raise exception 'a booked meeting needs the date of the meeting — the date it is actually happening, not the date of this call';
  end if;

  select ct.full_name, cc.display_name, ct.email, ct.org_name
    into v_name, v_label, v_email, v_org
    from call_contacts ct
    join call_campaigns cc on cc.id = ct.call_campaign_id
   where ct.id = p_contact;
  if v_name is null then
    raise exception 'no contact with id %', p_contact;
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');

  -- A double-submit guard, not a rule about how often you may ring someone.
  -- One minute, so the same Add pressed twice is one call and a second dial an
  -- hour later is two.
  if exists (
    select 1 from phone_calls
     where contact_id = p_contact
       and call_date  = p_call_date
       and outcome    = p_outcome
       and coalesce(note, '') = coalesce(v_note, '')
       and deleted_at is null
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into phone_calls (campaign_label, prospect_name, call_date, outcome, note,
                           contact_id, rep, callback_date)
  values (v_label, v_name, p_call_date, p_outcome, v_note,
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback)
  returning id into v_call;

  -- The second number this can move. Same person, same day the meeting
  -- happens, already on the board = the same meeting, so a confirming call
  -- does not book a second one. A different date is a different meeting.
  if p_outcome = 'booked_meeting' then
    if not exists (
      select 1 from meetings
       where lower(trim(coalesce(prospect_name, ''))) = lower(trim(coalesce(v_name, '')))
         and lower(trim(coalesce(prospect_email, ''))) = lower(trim(coalesce(v_email, '')))
         and meeting_date = p_meeting_date
         and status <> 'cancelled'
    ) then
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            booked_on, status, evidence, logged_by, note,
                            source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_meeting_date,
              p_call_date, 'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note,
              v_call, 'call');
    end if;
  end if;

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $function$;

create or replace function public.edit_call(
  p_call uuid, p_rep text, p_call_date date, p_outcome text,
  p_note text, p_callback date, p_meeting_date date default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_email text; v_org text; v_note text; v_contact uuid;
begin
  if p_outcome not in ('booked_meeting', 'follow_up', 'not_interested', 'not_reached') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;
  if p_outcome = 'booked_meeting' and p_meeting_date is null then
    raise exception 'a booked meeting needs the date of the meeting — the date it is actually happening, not the date of this call';
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');

  update phone_calls
     set call_date = p_call_date,
         outcome = p_outcome,
         note = v_note,
         callback_date = p_callback,
         rep = coalesce(nullif(trim(coalesce(p_rep, '')), ''), rep)
   where id = p_call and deleted_at is null
  returning contact_id into v_contact;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;

  -- Changing a call to "booked a meeting" books one; changing it away from
  -- that cancels the one it made. The meeting follows the call that made it,
  -- which is why moving a meeting is editing that call.
  if p_outcome = 'booked_meeting' then
    if exists (select 1 from meetings where source_call_id = p_call) then
      update meetings
         set meeting_date = p_meeting_date,
             booked_on = p_call_date,
             note = v_note,
             status = case when status = 'cancelled' then 'booked' else status end
       where source_call_id = p_call;
    else
      select ct.full_name, ct.email, ct.org_name into v_name, v_email, v_org
        from call_contacts ct where ct.id = v_contact;
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            booked_on, status, evidence, logged_by, note,
                            source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_meeting_date,
              p_call_date, 'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note,
              p_call, 'call');
    end if;
  end if;

  if p_outcome <> 'booked_meeting' then
    update meetings set status = 'cancelled'
     where source_call_id = p_call and status <> 'cancelled';
  end if;
end $function$;
