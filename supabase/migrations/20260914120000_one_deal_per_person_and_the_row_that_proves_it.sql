-- ============================================================
-- One deal per person, and the row that proves it.
--
-- When Instantly marks a lead Interested, a deal should appear in HubSpot
-- without anyone retyping it. The hard part is not creating the deal — it is
-- creating it exactly once, forever, across a job that runs every thirty
-- minutes and is allowed to die halfway through.
--
-- The temptation is a queue: a list of things to push, crossed off as they go.
-- Queues lose work. A row crossed off before the write lands is lost; a row
-- crossed off after is a duplicate when the process dies between the two.
--
-- So there is no queue and nothing is ever crossed off. There is one durable
-- fact per person — *this person has a deal, and here is its id* — and the
-- question "who still needs one?" is recomputed from scratch on every run:
--
--     interested in Instantly, and no deal_id here yet.
--
-- That makes every failure mode heal itself without special handling. A run
-- that dies after ten of thirty people leaves twenty still unanswered by this
-- table, so the next run picks up exactly those twenty. A lead marked
-- Interested three weeks ago that somehow never went through is in every
-- single run's list until it succeeds — it cannot fall off, because it was
-- never on a list to fall off of.
--
-- The one genuinely dangerous gap is a crash *between* HubSpot accepting the
-- deal and this table recording it. The push handles that by searching HubSpot
-- for an existing deal before creating one, so the retry adopts the orphan
-- rather than making its twin. This table cannot prevent that case; it is
-- named here so the next person knows where the guard lives.
--
-- Keyed on email, not (campaign, email) like `people`. A person who appears in
-- two campaigns is still one person and gets one deal. Lowercased on the way
-- in, because HubSpot matches addresses case-insensitively and we must agree
-- with it or we will happily create a second deal for Mike@ and mike@.
--
-- `attempts` and `last_error` are the visible half of a failure. A lead whose
-- push fails every time retries every thirty minutes forever and tells nobody;
-- these two columns are where you look when you suspect that is happening.
-- ponytail: no alerting, no attempt ceiling. Add one if a stuck row ever
-- actually happens — a cap invented before the first failure would be a guess
-- about a failure nobody has seen.
-- ============================================================

create table if not exists public.hubspot_pushes (
  email           text primary key,

  -- Null until HubSpot has confirmed the deal exists. This column, and only
  -- this column, is what "already done" means.
  deal_id         text,
  contact_id      text,

  -- What we sent, kept so a wrong name can be explained a month later without
  -- re-deriving it from a campaign that may since have been renamed.
  deal_name       text,
  owner           text,
  campaign_id     uuid references public.campaigns (id) on delete set null,

  pushed_at       timestamptz,
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now()
);

-- The only question this table is ever asked.
create index if not exists hubspot_pushes_unpushed
  on public.hubspot_pushes (email) where deal_id is null;

-- Same posture as app_users: the sync writes it with the service role, and
-- nothing reaches it through the dashboard's anon key. RLS on with no policy
-- denies everyone; service_role bypasses RLS entirely and so is unaffected.
alter table public.hubspot_pushes enable row level security;
