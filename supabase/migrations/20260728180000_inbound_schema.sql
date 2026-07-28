-- ============================================================
-- QEA Inbound Agent schema
-- Same project as Campaign HQ; inbound_* prefix.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- companies ----------
create table if not exists inbound_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  website text,
  industry text,
  employee_count text,
  estimate_revenue text,
  hq_city text,
  hq_state text,
  hq_country text,
  account_type text,
  account_type_confidence numeric,
  account_type_reason text,
  research_status text not null default 'new'
    check (research_status in (
      'new','queued','running','needs_review','ready','not_icp','error'
    )),
  fit_score int,
  engagement_score int default 0,
  last_visited_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_researched_at timestamptz,
  summary text,
  raw_rb2b jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inbound_companies_domain_uidx
  on inbound_companies (domain) where domain is not null;
create index if not exists inbound_companies_research_status_idx
  on inbound_companies (research_status);
create index if not exists inbound_companies_name_idx
  on inbound_companies (lower(name));

-- ---------- people ----------
create table if not exists inbound_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references inbound_companies(id) on delete set null,
  first_name text,
  last_name text,
  full_name text,
  title text,
  linkedin_url text,
  email text,
  phone text,
  city text,
  state text,
  source text not null default 'visitor'
    check (source in ('visitor','research','both','manual')),
  role_hypothesis text,
  priority int default 50,
  include_reason text,
  outreach_status text not null default 'not_started'
    check (outreach_status in (
      'not_started','queued','drafted','approved','sent','replied','held'
    )),
  last_touched_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inbound_people_linkedin_uidx
  on inbound_people (linkedin_url) where linkedin_url is not null;
create unique index if not exists inbound_people_company_email_uidx
  on inbound_people (company_id, lower(email))
  where email is not null and company_id is not null;
create index if not exists inbound_people_company_idx on inbound_people (company_id);
create index if not exists inbound_people_outreach_idx on inbound_people (outreach_status);

-- ---------- webhook events (immutable log) ----------
create table if not exists inbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  source text not null default 'rb2b',
  payload_hash text,
  raw jsonb not null,
  parse_status text not null default 'ok'
    check (parse_status in ('ok','partial','failed')),
  company_id uuid references inbound_companies(id) on delete set null,
  person_id uuid references inbound_people(id) on delete set null,
  error text
);
create unique index if not exists inbound_webhook_events_hash_uidx
  on inbound_webhook_events (payload_hash) where payload_hash is not null;
create index if not exists inbound_webhook_events_received_idx
  on inbound_webhook_events (received_at desc);

-- ---------- visits ----------
create table if not exists inbound_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references inbound_companies(id) on delete cascade,
  person_id uuid references inbound_people(id) on delete set null,
  seen_at timestamptz,
  captured_url text,
  referrer text,
  tags text,
  is_repeat_visit boolean default false,
  event_id uuid references inbound_webhook_events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inbound_visits_company_idx on inbound_visits (company_id, seen_at desc);

-- ---------- buildings ----------
create table if not exists inbound_buildings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references inbound_companies(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  country text,
  building_type text,
  size_hint text,
  source_urls text[] default '{}',
  confidence numeric,
  notes text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists inbound_buildings_company_idx on inbound_buildings (company_id);

-- ---------- compliance rules (seed library) ----------
create table if not exists inbound_compliance_rules (
  id text primary key,
  name text not null,
  geos text[] default '{}',
  building_scope text,
  hook text,
  severity text,
  refs text[] default '{}'
);

-- ---------- compliance hits (per company/building) ----------
create table if not exists inbound_compliance_hits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references inbound_companies(id) on delete cascade,
  building_id uuid references inbound_buildings(id) on delete set null,
  rule_id text references inbound_compliance_rules(id) on delete set null,
  rule_name text,
  jurisdiction text,
  summary text,
  source_urls text[] default '{}',
  confidence numeric,
  created_at timestamptz not null default now()
);
create index if not exists inbound_compliance_hits_company_idx
  on inbound_compliance_hits (company_id);

-- ---------- graph runs ----------
create table if not exists inbound_graph_runs (
  id uuid primary key default gen_random_uuid(),
  graph_name text not null check (graph_name in ('research','outreach')),
  company_id uuid references inbound_companies(id) on delete set null,
  person_id uuid references inbound_people(id) on delete set null,
  status text not null default 'running'
    check (status in ('running','ok','error','needs_review','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  langsmith_run_url text,
  thread_id text,
  input jsonb,
  output jsonb,
  error text,
  excel_path text,
  triggered_by text default 'manual'
);

create index if not exists inbound_graph_runs_started_idx
  on inbound_graph_runs (started_at desc);
create index if not exists inbound_graph_runs_company_idx
  on inbound_graph_runs (company_id);

-- ---------- graph node events (HQ visualization) ----------
create table if not exists inbound_graph_node_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references inbound_graph_runs(id) on delete cascade,
  node_name text not null,
  status text not null check (status in ('started','ok','error','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,
  input_summary jsonb,
  output_summary jsonb,
  error text,
  sequence int not null default 0
);
create index if not exists inbound_graph_node_events_run_idx
  on inbound_graph_node_events (run_id, sequence);

-- ---------- outreach events ----------
create table if not exists inbound_outreach_events (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references inbound_people(id) on delete set null,
  company_id uuid references inbound_companies(id) on delete set null,
  event_type text not null
    check (event_type in (
      'draft_created','approved','sent','opened','replied','bounced','held'
    )),
  channel text default 'email',
  event_at timestamptz not null default now(),
  subject text,
  body text,
  meta jsonb,
  run_id uuid references inbound_graph_runs(id) on delete set null
);
create index if not exists inbound_outreach_events_day_idx
  on inbound_outreach_events (event_at desc);
create index if not exists inbound_outreach_events_type_idx
  on inbound_outreach_events (event_type);

-- ---------- daily metrics (ET calendar dates) ----------
create table if not exists inbound_daily_metrics (
  metric_date date primary key,
  emails_sent int default 0,
  people_contacted int default 0,
  people_received int default 0,
  companies_received int default 0,
  research_runs_ok int default 0,
  research_runs_error int default 0,
  drafts_created int default 0,
  replies int default 0
);

-- ---------- seed compliance rules ----------
insert into inbound_compliance_rules (id, name, geos, building_scope, hook, severity, refs) values
  ('nyc_ll97', 'NYC Local Law 97', array['NY','New York','NYC'],
   'Large buildings; carbon caps with penalties',
   'LL97 carbon caps — envelope work is often the first lever before HVAC electrification',
   'penalty', array['https://www.nyc.gov/site/buildings/codes/ll97.page']),
  ('nyc_ll11', 'NYC Local Law 11 / FISP', array['NY','New York','NYC'],
   'Facades of buildings 6+ stories',
   'Facade inspection cycle — unsafe conditions force capital work',
   'compliance', array[]::text[]),
  ('boston_berdo', 'Boston BERDO', array['MA','Boston','Massachusetts'],
   'Large buildings energy reporting + performance',
   'BERDO reporting and compliance payments create urgency for envelope audits',
   'penalty', array[]::text[]),
  ('ma_lber', 'Massachusetts LBER', array['MA','Massachusetts'],
   'Commercial/industrial/institutional/multifamily over ~20k sqft',
   'State energy disclosure list is a ready prospecting universe',
   'disclosure', array[]::text[]),
  ('la_ebewe', 'Los Angeles EBEWE', array['CA','Los Angeles','LA'],
   'Existing building energy + water efficiency',
   'EBEWE benchmarking and retrofit path for LA assets',
   'compliance', array[]::text[]),
  ('seattle_beps', 'Seattle BEPS', array['WA','Seattle'],
   'Building performance standards',
   'Seattle performance standards — envelope is a low-regret first step',
   'compliance', array[]::text[]),
  ('denver_energize', 'Energize Denver', array['CO','Denver'],
   'Commercial building performance',
   'Energize Denver deadlines push owners to quantify envelope losses',
   'compliance', array[]::text[]),
  ('chicago_beps', 'Chicago BEPS / energy reporting', array['IL','Chicago'],
   'Large commercial energy disclosure',
   'Chicago disclosure markets — sell risk + energy, not a phantom fine',
   'disclosure', array[]::text[])
on conflict (id) do nothing;

-- ---------- RLS: public read (same pattern as Campaign HQ) ----------
alter table inbound_companies enable row level security;
alter table inbound_people enable row level security;
alter table inbound_webhook_events enable row level security;
alter table inbound_visits enable row level security;
alter table inbound_buildings enable row level security;
alter table inbound_compliance_rules enable row level security;
alter table inbound_compliance_hits enable row level security;
alter table inbound_graph_runs enable row level security;
alter table inbound_graph_node_events enable row level security;
alter table inbound_outreach_events enable row level security;
alter table inbound_daily_metrics enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'inbound_companies','inbound_people','inbound_webhook_events','inbound_visits',
    'inbound_buildings','inbound_compliance_rules','inbound_compliance_hits',
    'inbound_graph_runs','inbound_graph_node_events','inbound_outreach_events',
    'inbound_daily_metrics'
  ]
  loop
    execute format(
      'drop policy if exists "public read" on %I; create policy "public read" on %I for select to anon, authenticated using (true);',
      t, t
    );
  end loop;
end $$;
