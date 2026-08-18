-- ============================================================
-- QEA Campaign HQ — core schema
-- Field names follow the QEA Vault's own vocabulary.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 1. campaign_groups : the parent campaign ----------
create table campaign_groups (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  display_name  text not null,
  vault_name    text,
  description   text,
  objective     text,
  owner         text,
  platform      text[]  default '{}',      -- tools: instantly, lemlist, hubspot, phone...
  geography     text,
  segment       text,
  list_source   text,
  dataset_ids   text[] default '{}',
  sequence_shape text,
  status        text not null default 'planned'
                check (status in ('planned','scoping','list_only','live','paused','ended','abandoned')),
  started_on    date,
  earliest_send date,
  budget_note   text,
  notes         text,
  sort_order    int default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- 2. campaigns : one row per campaign in a sending tool ----------
create table campaigns (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null
                     check (source in ('instantly','lemlist','hubspot','phone','teams','unify','other')),
  source_campaign_id text,                 -- null for manual efforts with no tool
  name               text not null,
  vault_name         text,                 -- what the Vault calls it
  status             text not null default 'unknown'
                     check (status in ('running','paused','draft','completed','errored','unknown')),
  status_raw         text,
  status_changed_at  timestamptz,
  is_manual          boolean not null default false,
  daily_limit        int,
  open_tracking      boolean,
  link_tracking      boolean,
  text_only          boolean,
  sender_emails      text[] default '{}',
  schedule_timezone  text,
  started_on         date,
  raw                jsonb,
  first_seen         timestamptz not null default now(),
  last_synced        timestamptz,
  unique (source, source_campaign_id)
);
create index on campaigns (source, status);

-- ---------- 3. membership : auto-derived, overridable ----------
create table campaign_group_members (
  group_id          uuid not null references campaign_groups(id) on delete cascade,
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  sub_campaign_label text,
  assignment_source text not null default 'auto' check (assignment_source in ('auto','override')),
  assigned_at       timestamptz not null default now(),
  primary key (campaign_id)                -- a campaign belongs to exactly one group
);
create index on campaign_group_members (group_id);

-- ---------- 4. daily_metrics : the fact table ----------
create table daily_metrics (
  campaign_id          uuid not null references campaigns(id) on delete cascade,
  metric_date          date not null,
  sent                 int default 0,
  contacted            int default 0,
  new_leads_contacted  int default 0,
  delivered            int default 0,
  bounced              int default 0,
  opened               int default 0,
  unique_opened        int default 0,
  replied              int default 0,
  unique_replied       int default 0,
  replies_automatic    int default 0,
  clicked              int default 0,
  unique_clicked       int default 0,
  linkedin_sent        int default 0,
  linkedin_accepted    int default 0,
  opportunities        int default 0,
  pulled_at            timestamptz not null default now(),
  primary key (campaign_id, metric_date)
);
create index on daily_metrics (metric_date);

-- ---------- 5. campaign_totals : lifetime snapshot ----------
create table campaign_totals (
  campaign_id       uuid primary key references campaigns(id) on delete cascade,
  as_of             timestamptz not null default now(),
  leads             int default 0,
  reached           int default 0,
  contacted         int default 0,
  sent              int default 0,
  delivered         int default 0,
  bounced           int default 0,
  opened            int default 0,
  replied           int default 0,
  clicked           int default 0,
  linkedin_sent     int default 0,
  linkedin_accepted int default 0,
  opportunities     int default 0,
  unsubscribed      int default 0,
  completed         int default 0,
  raw               jsonb
);

-- ---------- 6. template_versions : copy, hashed and dated ----------
create table template_versions (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  step_index   int not null,
  variant      text not null default '0',
  channel      text not null default 'email',
  delay_days   int,
  subject      text,
  body         text,
  content_hash text not null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  unique (campaign_id, step_index, variant, content_hash)
);

-- ---------- 7. step_metrics : per-step performance ----------
create table step_metrics (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_index  int not null,
  variant     text not null default '0',
  sent        int default 0,
  opened      int default 0,
  replied     int default 0,
  replies_automatic int default 0,
  clicked     int default 0,
  as_of       timestamptz not null default now(),
  primary key (campaign_id, step_index, variant)
);

-- ---------- 8. replies ----------
create table replies (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid references campaigns(id) on delete set null,
  source            text not null,
  source_message_id text,
  lead_email        text,
  lead_name         text,
  company           text,
  channel           text default 'email',
  received_at       timestamptz,
  subject           text,
  body              text,
  sentiment         text not null default 'unclassified'
                    check (sentiment in ('interested','referral','not_now','not_interested','auto_reply','unclassified')),
  classified_by     text check (classified_by in ('ai','human')),
  classified_at     timestamptz,
  created_at        timestamptz not null default now(),
  unique (source, source_message_id)
);
create index on replies (campaign_id, received_at desc);

-- ---------- 9. meetings : manual, the primary KPI ----------
create table meetings (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references campaigns(id) on delete set null,
  group_id      uuid references campaign_groups(id) on delete set null,
  prospect_name text,
  prospect_email text,
  company       text,
  meeting_date  date,
  status        text not null default 'booked'
                check (status in ('booked','held','no_show','cancelled')),
  evidence      text not null default 'chat'
                check (evidence in ('tool','calendar','crm','chat')),
  logged_by     text,
  note          text,
  created_at    timestamptz not null default now()
);

-- ---------- 10. events : the timeline of what happened ----------
create table events (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid references campaign_groups(id) on delete cascade,
  campaign_id   uuid references campaigns(id) on delete cascade,
  event_date    date not null,
  event_type    text not null default 'note'
                check (event_type in ('launched','paused','resumed','copy_changed','list_loaded',
                                      'limit_changed','tracking_changed','note','flag','blocker')),
  title         text not null,
  body          text,
  is_flagged_conflict boolean not null default false,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on events (event_date desc);

-- ---------- 11. sync_runs : is the job alive? ----------
create table sync_runs (
  id            bigserial primary key,
  source        text not null,
  mode          text not null check (mode in ('incremental','nightly','weekly','backfill','manual')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running','ok','partial','error')),
  rows_upserted int default 0,
  detail        jsonb,
  error         text
);
create index on sync_runs (started_at desc);

-- ---------- 12. email_accounts : mailbox health ----------
create table email_accounts (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,
  email          text not null,
  domain         text,
  warmup_enabled boolean,
  warmup_score   numeric,
  daily_limit    int,
  status         text,
  raw            jsonb,
  last_synced    timestamptz not null default now(),
  unique (source, email)
);
