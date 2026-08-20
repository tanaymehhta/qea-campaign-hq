-- ============================================================
-- A call belongs to whoever made it.
--
-- The edge the meetings work kept arriving back at. `log_call` took `p_rep`
-- straight from a URL segment and wrote it to `phone_calls.rep`, which
-- `meeting_rows` then resolves a meeting's owner from. Two ways that goes
-- wrong, both measured:
--
--   blank    a call logged with the rep box empty resolved to nobody, so the
--            /meetings rep strip read Mark Vasu 7 · Justin 0 · Mark Dolan 1
--            against an all-reps total of 9. That is the 8-vs-9 that started
--            the whole audit on 20 Aug.
--
--   made up  /calls/all/nyc-ll11-safe is a URL /meetings generates *itself*,
--            for any call whose rep is empty and whose list has no owner. The
--            segment is decodeURIComponent'd and posted as p_rep, so logging a
--            call from that page created a meeting owned by a rep named "all".
--
-- Phase 1 made the totals sum by resolving the rep once. Neither of these
-- breaks that — they make it sum to a name nobody answers to, which is worse
-- than a number that does not add up, because it adds up.
--
-- So: the database refuses a call with no rep, and the two pages under
-- /calls/[rep] check the segment against the roster before they hand it to a
-- form. Both halves are needed. The check alone leaves the function trusting
-- our own UI, and the refusal alone leaves "all" a valid name.
--
-- Nothing live moves: all 11 calls on file carry a rep (checked 21 Aug). The
-- one that did not was a test row from the audit, deleted the same evening.
--
-- ---------------------------------------------------------------------------
-- `edit_call` is deliberately not given the same rule. It already reads
--   rep = coalesce(nullif(trim(p_rep), ''), rep)
-- so a blank there means "leave it alone", which is what an edit form that does
-- not ask about the rep should mean. Refusing would make fixing a typo in a
-- note impossible from any page that does not also know who the caller was.
--
-- `adopt_orphan_call` does not check either, and is left alone here: it exists
-- to give the three 16 July calls a person and a list from somebody's memory,
-- and a rep may honestly be one of the things nobody remembers. Its rows are
-- already visible on /calls/orphans, which is the record that they are
-- incomplete.
-- ============================================================

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text,
  p_callback date, p_meeting_date date default null
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text; v_label text; v_note text; v_email text; v_org text; v_call uuid;
        v_rep text;
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

  -- Said as a sentence about the consequence, because the consequence is the
  -- reason: a call with no rep counts on the Overview and appears in nobody's
  -- column, and so does the meeting it books.
  v_rep := nullif(trim(coalesce(p_rep, '')), '');
  if v_rep is null then
    raise exception 'a call needs the name of whoever made it — a call belonging to nobody still counts on the Overview and shows up in no rep''s column, and so does the meeting it books';
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
          p_contact, v_rep, p_callback)
  returning id into v_call;

  if p_outcome = 'booked_meeting' then
    if not exists (
      select 1 from meetings
       where lower(trim(coalesce(prospect_name, ''))) = lower(trim(coalesce(v_name, '')))
         and lower(trim(coalesce(prospect_email, ''))) = lower(trim(coalesce(v_email, '')))
         and meeting_date = p_meeting_date
         and status <> 'cancelled'
         -- A removed row is not on the board, and a guard that reads one is a
         -- guard that refuses on the authority of something nobody can see.
         and deleted_at is null
    ) then
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            booked_on, status, evidence, logged_by, note,
                            source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_meeting_date,
              p_call_date, 'booked', 'chat', v_rep, v_note,
              v_call, 'call');
    end if;
  end if;

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $function$;

grant execute on function public.log_call(uuid, text, date, text, text, date, date)
  to anon, authenticated;
