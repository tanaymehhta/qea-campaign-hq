-- inbound_intent_signals — the highest-converting facts we extract.
-- Previously written to Excel only and lost entirely on persist, which meant
-- stage 3's top-ranked openers had no source to read from.
create table if not exists public.inbound_intent_signals (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.inbound_companies(id) on delete cascade,

  -- commitment = public sustainability promise
  -- envelope   = explicit mention of roof/facade/window/exterior work
  -- budget     = committed capital or decarbonization spend with a number
  signal_type   text not null,

  -- envelope rows
  mention_type  text,   -- facade | envelope | roof | window | curtain_wall | recladding | waterproofing | insulation | other
  work_kind     text,   -- assessment (survey/inspection/scan/audit) | construction (repair/replacement/recladding)
  stage         text,   -- planned | underway | completed

  -- commitment rows
  claim_or_target text,
  target_year     text,
  baseline_year   text,

  -- budget rows
  amount        text,
  currency      text,
  scope         text,

  building_or_program text,
  when_text     text,

  quote         text,
  is_own_publication boolean default false,
  source_url    text,
  confidence    numeric,
  created_at    timestamptz default now()
);

create index if not exists inbound_intent_signals_company_idx
  on public.inbound_intent_signals(company_id);
create index if not exists inbound_intent_signals_type_idx
  on public.inbound_intent_signals(company_id, signal_type);

comment on table public.inbound_intent_signals is
  'Stage-1 extracted opener fuel. Every row must carry a source_url; quotes are verbatim, never paraphrased.';


-- inbound_emails — stage 3 output, one row per person considered (sent AND blocked).
create table if not exists public.inbound_emails (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.inbound_companies(id) on delete cascade,
  person_id     uuid references public.inbound_people(id) on delete set null,
  person_email  text not null,

  first_name    text,
  full_name     text,
  title         text,
  role_bucket   text,
  title_cluster text,
  vertical      text,
  icp_key       text,

  subject       text,
  body          text,

  opener_id     text,
  pain_id       text,
  proof_id      text,
  cta_id        text,

  -- the receipts: plain-English claim + the links behind it.
  -- URLs live here, never in `body`.
  opener_fact   text,
  evidence_urls text[] default '{}'::text[],

  validator_status  text,          -- sent | blocked
  validator_reasons text[] default '{}'::text[],

  instantly_campaign_id text,
  instantly_lead_id     text,
  pushed_at     timestamptz,
  send_status   text default 'not_sent',
  reply_status  text,

  llm_cost_usd  numeric,
  run_id        uuid,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- The guard that matters most in an autonomous sender: one email per person, ever.
-- A re-run must update this row, never insert a second one.
create unique index if not exists inbound_emails_company_email_uidx
  on public.inbound_emails(company_id, lower(person_email));

create index if not exists inbound_emails_company_idx
  on public.inbound_emails(company_id);
create index if not exists inbound_emails_send_status_idx
  on public.inbound_emails(send_status);

comment on table public.inbound_emails is
  'Stage-3 output. Includes blocked rows so the reason a person was skipped is never lost.';
