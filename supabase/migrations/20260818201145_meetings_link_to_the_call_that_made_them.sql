-- One meeting, one row, one edit.
--
-- Since 20260806185515 a call logged as `booked_meeting` also writes a meetings
-- row. That is right in principle — two tiles labelled "Meetings booked" that
-- disagree forever is worse. What was missing is everything after the insert:
--
--   nothing linked the two rows.  `evidence` is hardcoded 'chat', so a
--   call-created meeting was indistinguishable from a hand-typed one and the
--   only thing to match on was the name — the same fragile key that caused the
--   problem.
--
--   edit_call did nothing in either direction.  Change an outcome away from
--   booked_meeting and the meeting survives; change one *to* booked_meeting and
--   no meeting is ever created. The KPI could only ever rise.
--
--   delete_call did nothing.  Soft-delete a mis-logged call and the Calls tile
--   drops by one while the meeting feeds the headline number forever, with no
--   route to it from the interface.
--
-- `source_call_id` is that link. `origin` says which door a meeting came
-- through without overloading `evidence`, which describes proof rather than
-- provenance.
--
-- Cancel, never delete: a withdrawn meeting keeps its row with status
-- 'cancelled', so the history stays readable and the drill-down — which already
-- filters to booked + held — stops counting it. The status check constraint
-- already allows it.
--
-- The partial unique index makes "one meeting per call" a rule the database
-- enforces rather than a convention three functions have to remember.
alter table meetings
  add column if not exists source_call_id uuid references phone_calls(id) on delete set null;

alter table meetings
  add column if not exists origin text not null default 'manual';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meetings_origin_check') then
    alter table meetings add constraint meetings_origin_check
      check (origin in ('manual', 'call'));
  end if;
end $$;

create unique index if not exists meetings_one_per_source_call
  on meetings (source_call_id) where source_call_id is not null;

-- Nothing to backfill: log_call only started writing meetings on 6 August and
-- the newest meetings row was created 30 July, so all four existing rows are
-- hand-typed. They take the 'manual' default, which is true.

-- ---------------------------------------------------------------------------
create or replace function public.log_call(p_contact uuid, p_rep text, p_call_date date,
                                           p_outcome text, p_note text, p_callback date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_label text; v_note text; v_email text; v_org text; v_call uuid;
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
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback)
  returning id into v_call;

  -- The dedup guard above returns before this point on a double submit; the
  -- exists-check below additionally stops the same meeting being logged
  -- twice hours apart, which would inflate the KPI even though the second
  -- phone_calls row is a legitimate separate dial.
  --
  -- Matched lowered and trimmed, the way log_meeting already does. The two
  -- human doors used to compare differently — this one raw and case-sensitive,
  -- log_meeting lowered — so any casing difference produced a duplicate.
  if p_outcome = 'booked_meeting' then
    if not exists (
      select 1 from meetings
       where lower(trim(coalesce(prospect_name, ''))) = lower(trim(coalesce(v_name, '')))
         and lower(trim(coalesce(prospect_email, ''))) = lower(trim(coalesce(v_email, '')))
         and meeting_date = p_call_date
         and status <> 'cancelled'
    ) then
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            status, evidence, logged_by, note, source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_call_date,
              'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note, v_call, 'call');
    end if;
  end if;

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $function$;

-- ---------------------------------------------------------------------------
create or replace function public.edit_call(p_call uuid, p_rep text, p_call_date date,
                                            p_outcome text, p_note text, p_callback date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_email text; v_org text; v_note text; v_contact uuid;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
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

  -- The reverse path, which did not exist. Both directions.
  if p_outcome = 'booked_meeting' then
    if exists (select 1 from meetings where source_call_id = p_call) then
      -- keep the linked meeting in step, and un-cancel it if this edit is
      -- putting back an outcome that was previously taken away
      update meetings
         set meeting_date = p_call_date,
             note = v_note,
             status = case when status = 'cancelled' then 'booked' else status end
       where source_call_id = p_call;
    else
      select ct.full_name, ct.email, ct.org_name into v_name, v_email, v_org
        from call_contacts ct where ct.id = v_contact;
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            status, evidence, logged_by, note, source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_call_date,
              'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note, p_call, 'call');
    end if;
  else
    update meetings set status = 'cancelled'
     where source_call_id = p_call and status <> 'cancelled';
  end if;
end $function$;

-- ---------------------------------------------------------------------------
create or replace function public.delete_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update phone_calls set deleted_at = now()
   where id = p_call and deleted_at is null;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;

  -- The meeting outlived the call forever, with no route to it from any screen.
  update meetings set status = 'cancelled'
   where source_call_id = p_call and status <> 'cancelled';
end $function$;
