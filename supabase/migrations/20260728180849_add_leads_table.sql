-- ============================================================
-- leads : person-level record, one row per targeted contact
-- Reconciled against live Instantly/lemlist data, not self-reported.
-- ============================================================

create table leads (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid references campaign_groups(id) on delete set null,
  campaign_id   uuid references campaigns(id) on delete set null,
  source_list   text not null,
  source_file   text,
  name          text,
  email         text,
  company       text,
  title         text,
  status        text not null default 'prospect'
                check (status in ('prospect','assigned','sent','held','no_email')),
  email_quality text,
  raw           jsonb,
  created_at    timestamptz not null default now(),
  unique (source_list, email)
);
create index on leads (group_id, status);
create index on leads (email);

alter table public.leads enable row level security;
create policy "public read" on public.leads for select to anon, authenticated using (true);

insert into campaign_groups (slug, display_name, status)
values ('hospitals-canada', 'Hospitals — Canada', 'list_only');
