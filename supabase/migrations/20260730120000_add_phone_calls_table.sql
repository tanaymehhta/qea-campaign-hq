-- ============================================================
-- Phone calls: hand-logged, like meetings, but never traced to a
-- campaign row — some calls (e.g. New York) happened outside any
-- campaign we've loaded into this database. campaign_label is free
-- text for that reason, not a foreign key.
-- ============================================================

create table phone_calls (
  id            uuid primary key default gen_random_uuid(),
  campaign_label text,
  prospect_name text not null,
  call_date     date not null,
  outcome       text not null default 'other'
                check (outcome in ('booked_meeting','follow_up','not_interested','no_answer','other')),
  created_at    timestamptz not null default now()
);

alter table phone_calls enable row level security;
create policy "public read" on public.phone_calls for select to anon, authenticated using (true);
