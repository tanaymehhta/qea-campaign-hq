-- Stage-3 contract: fields the code already computes but threw away at the
-- persistence boundary (mashed into text blobs). All additive.

-- 1. inbound_companies: vertical is half of the email routing key (icp_key).
--    Pressure scalars were folded into `summary` prose; stage 3 cannot read prose.
alter table public.inbound_companies
  add column if not exists vertical text,
  add column if not exists must_report_energy boolean,
  add column if not exists must_meet_performance boolean,
  add column if not exists reporting_notes text,
  add column if not exists deadlines_or_cycles text,
  add column if not exists public_energy_data text,
  add column if not exists retrofit_permit_notes text,
  add column if not exists planning_window_notes text,
  add column if not exists portfolio_scale text,
  add column if not exists portfolio_notes text,
  add column if not exists sustainability_plan_exists boolean,
  add column if not exists sustainability_program_name text,
  add column if not exists sustainability_report_url text,
  add column if not exists sustainability_report_year text,
  add column if not exists needs_human_review boolean,
  add column if not exists review_reasons text[] default '{}'::text[];

-- 2. inbound_people: stage 2 squashed role/tier/email status into `include_reason`.
alter table public.inbound_people
  add column if not exists role_bucket text,
  add column if not exists fit_tier text,
  add column if not exists list_status text,
  add column if not exists email_status text,
  add column if not exists email_source text,
  add column if not exists seniority_band text,
  add column if not exists company_match text,
  add column if not exists title_cluster text,
  add column if not exists sendable boolean,
  add column if not exists sendable_reason text,
  add column if not exists apollo_id text;

-- 3. inbound_buildings: year/ownership/retrofit were appended into `notes` text
--    and duplicated into `raw` jsonb. Real columns.
alter table public.inbound_buildings
  add column if not exists year_built text,
  add column if not exists ownership_status text,
  add column if not exists retrofit_history_notes text,
  add column if not exists public_data_sources text[] default '{}'::text[];

-- 4. inbound_compliance_rules: without these two, stage 3 cannot tell
--    "must report annually" from "faces fines" — the mistake that burns accounts.
alter table public.inbound_compliance_rules
  add column if not exists must_do text,
  add column if not exists has_teeth boolean;

comment on column public.inbound_compliance_rules.must_do is
  'Honest plain-language obligation, e.g. "report energy and GHG annually". Quoted in outreach openers.';
comment on column public.inbound_compliance_rules.has_teeth is
  'True only when real penalties exist. False = reporting-only. NULL = unknown; treat as false for outreach.';
