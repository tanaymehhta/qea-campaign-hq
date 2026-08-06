-- ============================================================
-- Contact stages: make phone_calls the one per-contact activity
-- log it already half is, so a contact's journey through the
-- funnel — New → Attempted → Connected → Meeting → Proposal →
-- Closed — can be DERIVED from the touches, never typed in and
-- never able to drift from what actually happened. Same principle
-- booked_meeting already follows: a stage is a fact that falls out
-- of the events logged, not a flag someone sets on the side.
--
--  - channel: what kind of touch a row is. Every existing row is a
--    phone dial, so 'phone' is the default and the backfill is free.
--  - four new activity types the funnel needs and a pure call log
--    could not express: an email SENT (not just a reply received),
--    a proposal sent, and the two ways a deal ends — won / lost.
--
-- No new table: the timeline, the stage strip and the Overview
-- Calls tile all keep reading the one phone_calls table, so there
-- is still nothing to reconcile between the calls world and the
-- rest of the dashboard.
-- ============================================================

alter table phone_calls
  add column channel text not null default 'phone'
    check (channel in ('phone','email','proposal','system'));

alter table phone_calls drop constraint phone_calls_outcome_check;
alter table phone_calls add constraint phone_calls_outcome_check
  check (outcome in ('booked_meeting','follow_up','not_interested','no_answer',
                     'left_voicemail','left_email','other',
                     'email_sent','proposal_sent','won','lost'));

-- log_call gains p_channel (defaulting to phone, so the meaning of every
-- existing caller is unchanged) and the four new outcomes. Body is otherwise
-- the 20260806120000 version verbatim — the one-minute dedup guard and the
-- booked_meeting → meetings insert — with channel threaded through. The old
-- 6-arg signature is dropped so PostgREST resolves the call unambiguously.
drop function if exists public.log_call(uuid, text, date, text, text, date);

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text,
  p_callback date, p_channel text default 'phone'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_label text; v_note text; v_email text; v_org text;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other',
                        'email_sent','proposal_sent','won','lost') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if coalesce(p_channel, 'phone') not in ('phone','email','proposal','system') then
    raise exception 'not a valid channel: %', p_channel;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
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

  -- Double-click, or a browser re-posting the form, must not become two
  -- rows. Same person, same day, same outcome, same channel, same note,
  -- logged seconds apart is one action being submitted twice. Channel is
  -- in the key so an email and a call the same day never collapse together.
  if exists (
    select 1 from phone_calls
     where contact_id = p_contact
       and call_date  = p_call_date
       and outcome    = p_outcome
       and coalesce(channel, 'phone') = coalesce(p_channel, 'phone')
       and coalesce(note, '') = coalesce(v_note, '')
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into phone_calls (campaign_label, prospect_name, call_date, outcome, note,
                           contact_id, rep, callback_date, channel)
  values (v_label, v_name, p_call_date, p_outcome, v_note,
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback,
          coalesce(p_channel, 'phone'));

  -- A booked meeting is the shared KPI: it must also land in the meetings
  -- table so the Overview hero tile and /meetings count it, exactly as a
  -- call-booked meeting has since 20260806120000.
  if p_outcome = 'booked_meeting' then
    if not exists (
      select 1 from meetings
       where prospect_name = v_name
         and coalesce(prospect_email, '') = coalesce(v_email, '')
         and meeting_date = p_call_date
    ) then
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            status, evidence, logged_by, note)
      values (v_name, v_email, v_org, p_call_date,
              'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note);
    end if;
  end if;

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $$;

grant execute on function public.log_call(uuid, text, date, text, text, date, text)
  to anon, authenticated;

-- edit_call must accept the same widened outcome set, or a row logged as
-- proposal_sent / won / lost could never be corrected.
create or replace function public.edit_call(
  p_call uuid, p_rep text, p_call_date date, p_outcome text, p_note text, p_callback date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other',
                        'email_sent','proposal_sent','won','lost') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;

  update phone_calls
     set call_date = p_call_date,
         outcome = p_outcome,
         note = nullif(trim(coalesce(p_note, '')), ''),
         callback_date = p_callback,
         rep = coalesce(nullif(trim(coalesce(p_rep, '')), ''), rep)
   where id = p_call and deleted_at is null;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;
end $$;

grant execute on function public.edit_call(uuid, text, date, text, text, date) to anon, authenticated;
