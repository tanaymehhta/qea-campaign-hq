-- ============================================================
-- A call with no contact belongs to nobody.
--
-- Three calls made on 16 July 2026 — Levon Shaginyan, Mark Ellis, Raffaele
-- Albanese, campaign label "New York" — were logged before `call_contacts`
-- existed. They carry `contact_id = null` and `rep = null`, and that one hole
-- makes four pages irreconcilable:
--
--   Overview "Calls logged"      counts them          (16 rows / 11 dials)
--   every campaign page          cannot see them      (13 rows /  8 dials)
--   /calls rep chips             attribute them to nobody
--   "People reached · phoned"    counts them as 3 of the 11
--
-- Measured 20 Aug 2026. There is no way to close that gap by reading — the
-- facts do not exist anywhere in this database. Somebody has to type them, so
-- this is the write path that lets them: /calls/orphans.
--
-- Adoption, not invention. The function refuses to touch a call that already
-- has a contact, and it reuses an existing contact on the chosen list when the
-- name already appears there rather than creating a second row for one human —
-- the same rule §10.3 sets for email identity, applied to the only identity
-- these three have.
--
-- A blank field never overwrites a filled one. A rep filling in a phone number
-- for a contact that already has one is correcting it; a rep leaving the box
-- empty is saying nothing, not saying "none".
-- ============================================================

create or replace function public.adopt_orphan_call(
  p_call      uuid,
  p_campaign  uuid,
  p_full_name text,
  p_rep       text,
  p_org       text default null,
  p_role      text default null,
  p_phone     text default null,
  p_email     text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text; v_rep text; v_email text; v_role text; v_label text; v_contact uuid;
begin
  v_name := nullif(trim(coalesce(p_full_name, '')), '');
  v_rep  := nullif(trim(coalesce(p_rep, '')), '');
  -- Lowercased on the way in. `update_contact_detail` does not, and
  -- /person matches an address exactly — a capital letter there loses a
  -- person their call history without saying so.
  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_role := coalesce(nullif(trim(lower(coalesce(p_role, ''))), ''), 'other');

  if v_name is null then
    raise exception 'the person''s name is required — it is the only identity this call has';
  end if;
  if v_rep is null then
    raise exception 'who made this call? a call with no rep is a call in nobody''s numbers';
  end if;
  if v_role not in ('engineer', 'owner', 'other') then
    raise exception 'role must be engineer, owner or other — not "%"', v_role;
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address: %', v_email;
  end if;

  select display_name into v_label from call_campaigns where id = p_campaign;
  if v_label is null then
    raise exception 'no call list with that id';
  end if;

  -- Refused, not silently ignored: a call that already has a contact is not an
  -- orphan, and adopting it twice would move it off the person it belongs to.
  if not exists (select 1 from phone_calls
                  where id = p_call and deleted_at is null and contact_id is null) then
    raise exception 'that call is not an unassigned call';
  end if;

  select id into v_contact
    from call_contacts
   where call_campaign_id = p_campaign
     and lower(trim(full_name)) = lower(v_name)
   order by created_at
   limit 1;

  if v_contact is null then
    insert into call_contacts (call_campaign_id, source_key, full_name, role,
                               org_name, phone, email, contact_source)
    values (p_campaign, 'adopted:' || p_call::text, v_name, v_role,
            nullif(trim(coalesce(p_org, '')), ''),
            nullif(trim(coalesce(p_phone, '')), ''), v_email,
            'typed in by ' || v_rep)
    returning id into v_contact;
  else
    -- Fills gaps and corrects what was typed; never blanks what is there.
    update call_contacts
       set org_name = coalesce(nullif(trim(coalesce(p_org, '')), ''), org_name),
           phone    = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
           email    = coalesce(v_email, email),
           role     = case when v_role = 'other' then role else v_role end,
           updated_at = now()
     where id = v_contact;
  end if;

  update phone_calls
     set contact_id     = v_contact,
         rep            = coalesce(rep, v_rep),
         prospect_name  = v_name,
         campaign_label = v_label
   where id = p_call;
end $function$;

grant execute on function public.adopt_orphan_call(uuid, uuid, text, text, text, text, text, text)
  to anon, authenticated;
