-- ============================================================
-- Calls, second pass: the three things end-to-end testing found
-- that the first pass left open.
--
--  1. A double-submitted form logged the same call twice, and the
--     Overview tile counts calls — so a misclick inflated a number
--     the company steers on.
--  2. A contact retired with "do not call" could only be brought
--     back with hand-written SQL. The UI had no way out.
--  3. update_contact_detail checked *which* field you edited but
--     never *what* you put in it, so "asdf" saved cleanly as a
--     phone number and the next rep dialled it.
-- ============================================================

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text, p_callback date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_label text; v_note text;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer','other') then
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

-- The way back from a do-not-call. Retiring someone is one click and was
-- one-way; a misclick meant losing a contact from the working list for good.
-- Logged in call_contact_edits like any other correction, so the round trip
-- is visible rather than silent.
create or replace function public.restore_contact(p_contact uuid, p_rep text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_old text;
begin
  select dnc_reason into v_old from call_contacts where id = p_contact;
  update call_contacts
     set dnc = false, dnc_reason = null, updated_at = now()
   where id = p_contact;
  if not found then
    raise exception 'no contact with id %', p_contact;
  end if;

  insert into call_contact_edits (contact_id, rep, field, old_value, new_value)
  values (p_contact, nullif(trim(coalesce(p_rep, '')), ''), 'dnc', v_old, null);
end $$;

create or replace function public.update_contact_detail(
  p_contact uuid, p_rep text, p_field text, p_value text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_old text; v_new text;
begin
  -- Whitelisted to the three details a call can correct. Everything else
  -- came from the source list and is re-imported, not hand-edited.
  if p_field not in ('phone','email','linkedin') then
    raise exception 'not an editable field: %', p_field;
  end if;
  v_new := nullif(trim(coalesce(p_value, '')), '');

  -- Shape check, deliberately loose. The point is to catch a slip or a
  -- half-typed value before someone dials it — not to be an authority on
  -- what a phone number may look like. Extensions, +country codes, dots
  -- and parentheses all pass; seven digits is the floor.
  if p_field = 'phone' and v_new is not null
     and length(regexp_replace(v_new, '\D', '', 'g')) < 7 then
    raise exception 'that does not look like a phone number: %', v_new;
  end if;
  if p_field = 'email' and v_new is not null
     and v_new !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address: %', v_new;
  end if;

  -- EXECUTE does not set FOUND, so existence is checked explicitly.
  if not exists (select 1 from call_contacts where id = p_contact) then
    raise exception 'no contact with id %', p_contact;
  end if;
  execute format('select %I from call_contacts where id = $1', p_field)
    into v_old using p_contact;

  execute format('update call_contacts set %I = $1, updated_at = now() where id = $2', p_field)
    using v_new, p_contact;

  insert into call_contact_edits (contact_id, rep, field, old_value, new_value)
  values (p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_field, v_old, v_new);
end $$;

grant execute on function public.restore_contact(uuid, text) to anon, authenticated;
