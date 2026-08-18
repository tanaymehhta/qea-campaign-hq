-- ============================================================
-- Calls: a phone-first workspace. One list per call campaign, one
-- row per *person* (not per building — one engineer can carry 63
-- buildings and gets dialled once), and every call logged against
-- them.
--
-- There is deliberately NO new call-log table. The Overview page
-- already counts `phone_calls`, so a call logged in the workspace
-- must be the same row that tile reads — extending `phone_calls`
-- with contact_id / rep / callback_date means there is nothing to
-- reconcile and no way for the two pages to disagree. The instinct
-- to add a parallel table here is strong and wrong.
-- ============================================================

create table call_campaigns (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  display_name  text not null,
  description   text,
  objective     text,
  owner         text,           -- rep name, matches campaign_groups.owner convention
  source_file   text,           -- where the list came from, for provenance
  summary_md    text,           -- the Context panel, markdown, editable without a deploy
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

create table call_contacts (
  id               uuid primary key default gen_random_uuid(),
  call_campaign_id uuid not null references call_campaigns(id),
  source_key       text not null,  -- stable dedupe key: role + normalized name
  full_name        text not null,
  role             text not null default 'other'
                   check (role in ('engineer','owner','other')),
  org_name         text,
  license_no       text,
  phone            text,
  email            text,
  linkedin         text,
  city             text,
  state            text,
  zip              text,
  buildings_count  integer not null default 0,
  buildings        jsonb not null default '[]'::jsonb,  -- [{bin, address, borough, rank, score}]
  best_rank        integer,        -- their best building's rank, for ordering
  contact_source   text,           -- how we got the phone/email, e.g. 'Campaign 01 (verified)'
  dnc              boolean not null default false,
  dnc_reason       text,
  callback_date    date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (call_campaign_id, source_key)
);

-- Audit trail for hand-corrected details: a rep who finds a direct
-- dial on a call saves it, and the next person can see who changed
-- it and when.
create table call_contact_edits (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references call_contacts(id),
  rep         text,
  field       text not null,
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

-- Extend, do not replace. Existing rows predate this feature and some
-- calls happened outside any campaign in this database, so contact_id
-- is nullable and campaign_label stays free text — never backfilled,
-- never constrained.
alter table phone_calls add column contact_id uuid references call_contacts(id);
alter table phone_calls add column rep text;
alter table phone_calls add column callback_date date;

alter table call_campaigns     enable row level security;
alter table call_contacts      enable row level security;
alter table call_contact_edits enable row level security;
create policy "public read" on public.call_campaigns     for select to anon, authenticated using (true);
create policy "public read" on public.call_contacts      for select to anon, authenticated using (true);
create policy "public read" on public.call_contact_edits for select to anon, authenticated using (true);

-- ------------------------------------------------------------------
-- Write path. Same pattern as classify_reply() / record_meeting_detail():
-- the site has no login, so every write is a security-definer function
-- that validates its own arguments, and RLS still blocks direct writes.
-- ------------------------------------------------------------------

create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text, p_callback date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_label text;
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

  insert into phone_calls (campaign_label, prospect_name, call_date, outcome, note,
                           contact_id, rep, callback_date)
  values (v_label, v_name, p_call_date, p_outcome, nullif(trim(coalesce(p_note, '')), ''),
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback);

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $$;

create or replace function public.set_contact_dnc(p_contact uuid, p_rep text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'a do-not-call needs a reason';
  end if;
  update call_contacts
     set dnc = true, dnc_reason = trim(p_reason), updated_at = now()
   where id = p_contact;
  if not found then
    raise exception 'no contact with id %', p_contact;
  end if;
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

create or replace function public.set_callback(p_contact uuid, p_rep text, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update call_contacts set callback_date = p_date, updated_at = now()
   where id = p_contact;
  if not found then
    raise exception 'no contact with id %', p_contact;
  end if;
end $$;

grant execute on function public.log_call(uuid, text, date, text, text, date) to anon, authenticated;
grant execute on function public.set_contact_dnc(uuid, text, text)            to anon, authenticated;
grant execute on function public.update_contact_detail(uuid, text, text, text) to anon, authenticated;
grant execute on function public.set_callback(uuid, text, date)               to anon, authenticated;
