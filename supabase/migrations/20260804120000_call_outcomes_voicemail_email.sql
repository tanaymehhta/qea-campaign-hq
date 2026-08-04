-- ============================================================
-- Two outcomes reps kept writing into the free-text note because
-- there was nowhere else to put them: "left voicemail" (no answer,
-- but a message went out) and "left email" (reached, but not by
-- phone). Both are legitimate call outcomes, not notes about one.
-- ============================================================

alter table phone_calls drop constraint phone_calls_outcome_check;
alter table phone_calls add constraint phone_calls_outcome_check
  check (outcome in ('booked_meeting','follow_up','not_interested','no_answer',
                      'left_voicemail','left_email','other'));

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text, p_callback date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_label text; v_note text;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;

  select ct.full_name, cc.display_name
    into v_name, v_label
    from call_contacts ct
    join call_campaigns cc on cc.id = ct.call_campaign_id
   where ct.id = p_contact;
  if v_name is null then
    raise exception 'no contact with id %', p_contact;
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');

  -- Double-click, or a browser re-posting the form, must not become two
  -- calls. Same person, same day, same outcome, same note, logged seconds
  -- apart is one call being submitted twice — not a rep who dialled again.
  -- ponytail: a time window, not an idempotency key. Swap it for a token
  -- from the form if genuine same-minute repeat dials ever matter.
  if exists (
    select 1 from phone_calls
     where contact_id = p_contact
       and call_date  = p_call_date
       and outcome    = p_outcome
       and coalesce(note, '') = coalesce(v_note, '')
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into phone_calls (campaign_label, prospect_name, call_date, outcome, note,
                           contact_id, rep, callback_date)
  values (v_label, v_name, p_call_date, p_outcome, v_note,
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback);

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $$;
