-- ============================================================
-- Person-level layer, so every number on the dashboard can be
-- clicked through to the actual human beings behind it.
--
-- Two tables, because the two vendors expose two different shapes:
--   activities — a true dated event stream. lemlist gives this in full.
--                Instantly only exposes the last send per lead, so its
--                rows are 'sent' events only.
--   people     — per-campaign roster with lifetime per-person counters.
--                Instantly gives this in full; it is the only way to
--                answer "who opened" for Instantly, which never exposes
--                a per-open timestamp.
-- ============================================================

create table if not exists people (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  source             text not null,
  email              text not null,
  name               text,
  company            text,
  title              text,
  status             text,
  sent_count         int  default 0,
  opened_count       int  default 0,
  clicked_count      int  default 0,
  replied_count      int  default 0,
  bounced            boolean default false,
  first_contacted_at timestamptz,
  last_contacted_at  timestamptz,
  raw                jsonb,
  last_synced        timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists people_campaign_idx on people (campaign_id);
create index if not exists people_email_idx    on people (lower(email));
create index if not exists people_contacted_idx on people (last_contacted_at desc);

create table if not exists activities (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  source             text not null,
  source_activity_id text not null,
  event_type         text not null check (event_type in (
                       'sent','opened','clicked','replied','auto_reply','bounced',
                       'linkedin_sent','linkedin_accepted','unsubscribed')),
  occurred_at        timestamptz not null,
  activity_date      date not null,          -- already normalised to America/New_York
  email              text,
  name               text,
  company            text,
  raw                jsonb,
  created_at         timestamptz not null default now(),
  unique (source, source_activity_id)
);
create index if not exists activities_date_type_idx on activities (activity_date desc, event_type);
create index if not exists activities_campaign_idx  on activities (campaign_id, event_type);
create index if not exists activities_email_idx     on activities (lower(email));

alter table people     enable row level security;
alter table activities enable row level security;
drop policy if exists "public read" on people;
create policy "public read" on people     for select to anon, authenticated using (true);
drop policy if exists "public read" on activities;
create policy "public read" on activities for select to anon, authenticated using (true);

-- ---------- drop the Hospitals — Canada list ----------
delete from leads
 where group_id = (select id from campaign_groups where slug = 'hospitals-canada');
delete from campaign_groups where slug = 'hospitals-canada';
