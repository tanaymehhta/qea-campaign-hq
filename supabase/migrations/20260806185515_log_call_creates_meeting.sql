-- ============================================================
-- "Booked a meeting" in the Calls workspace wrote a phone_calls row
-- and nothing else, so the primary KPI (the meetings table, feeding
-- the Overview hero tile and /meetings) never heard about it. Two
-- tiles labelled "Meetings booked" disagreed forever. From here, a
-- booked_meeting outcome also inserts the meeting.
--
-- Notes:
-- - campaign_id / group_id stay null: call campaigns are not email
--   campaigns and there is no FK between the two worlds. /list's
--   meetings branch scopes on either column, so a null-campaign
--   meeting still shows in the unscoped list.
-- - edit_call / delete_call do NOT retro-update or remove the
--   meeting row. Accepted limitation: fixing a wrongly logged
--   meeting stays a Conflicts/manual job.
-- - Body copied from 20260804120000 (7-outcome enum + one-minute
--   dedup guard); only the meeting insert is new.
-- ============================================================

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text, p_callback date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_label text; v_note text; v_email text; v_org text;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other') then
    raise exception 'not a valid outcome: %', p_outcome;
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

  -- The dedup guard above returns before this point on a double submit; the
  -- exists-check below additionally stops the same meeting being logged
  -- twice hours apart, which would inflate the KPI even though the second
  -- phone_calls row is a legitimate separate dial.
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

grant execute on function public.log_call(uuid, text, date, text, text, date)
  to anon, authenticated;
