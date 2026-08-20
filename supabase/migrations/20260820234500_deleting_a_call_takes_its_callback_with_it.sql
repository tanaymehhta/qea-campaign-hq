-- ============================================================
-- Deleting a call takes its callback with it.
--
-- Tanay, 20 Aug 2026: "There is a new flag and a small CB at the end near the
-- date for Nicholas Ferrara. This was the guy I added and then removed."
--
-- He logged a call with a callback of 20 Aug at 19:06:06 and deleted it 35
-- seconds later. The call went (`deleted_at`), the meeting it booked was
-- cancelled — and the flag stayed, because a callback lives in two places:
--
--   phone_calls.callback_date     what this call said to do
--   call_contacts.callback_date   what the person's row shows, and what
--                                 "Follow-ups due" and the ⚑ read
--
-- `log_call` writes both. `delete_call` only ever wrote the first, so the
-- person kept an instruction from a call that no longer exists. `edit_call`
-- had the same hole from the other side: changing a call's callback date left
-- the person on the old one.
--
-- The rule now: when a call's callback changes or the call goes away, the
-- person falls back to the latest callback across their remaining live calls,
-- and to nothing when there are none.
--
-- Guarded on `callback_date = v_old`, which is what keeps the Callback box on
-- the workspace ("ring this person in September", set by hand, tied to no
-- call) from being wiped by deleting an unrelated call. A hand-set date that
-- differs from the call's is left exactly where it is.
-- ============================================================

create or replace function public.delete_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_contact uuid; v_old date;
begin
  update phone_calls set deleted_at = now()
   where id = p_call and deleted_at is null
  returning contact_id, callback_date into v_contact, v_old;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;

  -- The meeting outlived the call forever, with no route to it from any screen.
  update meetings set status = 'cancelled'
   where source_call_id = p_call and status <> 'cancelled';

  -- And so did the callback. Only when the person is still showing this call's
  -- date — a different one was set by hand and is not this call's to remove.
  if v_contact is not null and v_old is not null then
    update call_contacts
       set callback_date = (
             select max(pc.callback_date) from phone_calls pc
              where pc.contact_id = v_contact and pc.deleted_at is null
           ),
           updated_at = now()
     where id = v_contact and callback_date = v_old;
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
declare v_name text; v_email text; v_org text; v_note text;
        v_contact uuid; v_old date;
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

  -- Read before the write: the person is fixed up below by comparing what they
  -- are showing against what this call used to say.
  select contact_id, callback_date into v_contact, v_old
    from phone_calls where id = p_call and deleted_at is null;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;

  update phone_calls
     set call_date = p_call_date,
         outcome = p_outcome,
         note = v_note,
         callback_date = p_callback,
         rep = coalesce(nullif(trim(coalesce(p_rep, '')), ''), rep)
   where id = p_call;

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

  -- The callback moved, so the person moves with it. The update above is
  -- already in, so max() sees the new date when there is one.
  if v_contact is not null and v_old is distinct from p_callback then
    update call_contacts
       set callback_date = (
             select max(pc.callback_date) from phone_calls pc
              where pc.contact_id = v_contact and pc.deleted_at is null
           ),
           updated_at = now()
     where id = v_contact and callback_date is not distinct from v_old;
  end if;
end $function$;

-- Nicholas Ferrara, the one row this bug reached. Scoped to a callback that
-- came from a call that was then deleted — not to "any callback with no live
-- call behind it", which would also wipe a date somebody set by hand in the
-- Callback box. Same distinction delete_call now makes.
update call_contacts ct
   set callback_date = (
         select max(pc.callback_date) from phone_calls pc
          where pc.contact_id = ct.id and pc.deleted_at is null
       ),
       updated_at = now()
 where ct.callback_date is not null
   and exists (
     select 1 from phone_calls pc
      where pc.contact_id = ct.id and pc.deleted_at is not null
        and pc.callback_date = ct.callback_date
   )
   and not exists (
     select 1 from phone_calls pc
      where pc.contact_id = ct.id and pc.deleted_at is null
        and pc.callback_date = ct.callback_date
   );
