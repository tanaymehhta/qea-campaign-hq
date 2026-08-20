-- ============================================================
-- One definition of "a person who responded".
--
-- The homepage tile said 3. Clicking it opened a list of 193 messages. Both
-- numbers were computed honestly and neither was the other's pile: the tile
-- was distinct Instantly people minus robots minus refusals, counted in
-- JavaScript inside the Next.js render; the page was every inbound row from
-- both vendors, all time, capped at 300. Two answers to one question is F2 in
-- TRUST.md, and it survives every fix that only corrects one of them.
--
-- So the rule moves out of the render and into here, once, and the tile and the
-- list both ask this function. They cannot drift, because there is nothing left
-- to drift from.
--
-- ---------------------------------------------------------------------------
-- Why a per-person rollup and not a count of rows
--
-- `replies` is one row per message. A human who writes twice is two rows, and
-- one of them can be an out-of-office and the other a real answer — that is not
-- hypothetical, T1 found exactly that person in Canada's list. Summing labels
-- would count them twice and could file them under both. So the grain is the
-- person (`lower(lead_email)`, and every row in the table has one), the labels
-- arrive as `bool_or`, and one `interested` anywhere wins.
--
-- Four flags come back, and the caller picks which pile it wants:
--
--   responded    any of interested / not_interested / not_now / referral.
--                A refusal IS a response. That is the change from the old tile,
--                and it is the reason Total and Interested are two tiles now:
--                one counts who wrote back, the other counts who said yes.
--   interested   one `interested` row anywhere, even alongside a later no.
--   needs_label  EVERY message from this person is unclassified. Not "has an
--                unclassified message" — a person already labelled elsewhere is
--                settled, and the tile that warns about homework must not warn
--                about them. This is what stopped the old "unread" note being a
--                ceiling that could never fall.
--   robot_only   every message is an auto_reply. Never a response.
--
-- Unclassified is homework, not a KPI: a person who is only unclassified is in
-- none of the first two piles. Labelling is what moves them, and it happens on
-- /replies through `classify_reply`, which already exists.
--
-- ---------------------------------------------------------------------------
-- Why security invoker, and where `hidden` went
--
-- RLS already excludes hidden campaigns from `replies` for the anon role
-- (`NOT is_hidden_campaign(campaign_id)`), which is the only role the dashboard
-- holds. Writing this `security definer` — the habit from the write functions
-- next door — would hand anon 58 rows it has never been allowed to see. So this
-- is `security invoker`, the default, and `hidden` is not mentioned anywhere in
-- the body. The policy is the filter. Measured 20 Aug 2026: all 58 of those
-- hidden rows are lemlist robots, so this changes no number today; it means the
-- exclusion cannot be forgotten tomorrow.
--
-- ---------------------------------------------------------------------------
-- Why the window is New York, when the old code used UTC
--
-- The homepage divides Interested by `new_leads_contacted`, which comes from
-- `v_daily_facts.metric_date` — a calendar date in the company's timezone. The
-- replies fetch it replaces bounded `received_at` with `T00:00:00Z`, so a reply
-- that arrived at 8pm on the 12th in New York landed in the 13th's bucket and
-- was divided by the 12th's sends. Four hours of skew between a numerator and
-- its denominator, invisible on "all time" and wrong on "today". Both sides now
-- mean the same day.
--
-- p_from / p_to are inclusive dates, and NULL means unbounded, so "all time"
-- asks for nothing rather than asking for 2020-01-01.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
--
-- No stored total. No `replies_totals` table, no new column on `daily_metrics`
-- or `campaign_totals`. This is a live aggregate, and house rule 7 in
-- TRUST_OPEN.md is that a count you can `count(*)` never gets a second copy —
-- a copy needs the sync to keep it in step, and a human retag to keep it in
-- step, and the day one of them is forgotten it reads as a plausible zero.
--
-- No rep parameter either. A rep owns groups, not campaigns, and the resolution
-- from one to the other already exists in `campaignIdsForRep` in lib/db.js.
-- Passing the resolved campaign ids keeps that rule in one place too.
-- ============================================================

-- One row per human, over whatever window / campaigns / vendor is asked for.
--
-- p_source: 'instantly' for anything with a rate on it — lemlist has never
-- reported `new_leads_contacted` (0 across all 234 of its campaign-days), so a
-- lemlist person in the numerator would be divided by a denominator they are
-- not in. NULL means both vendors, which is what the "All inbound" list wants.
create or replace function public.response_people(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default 'instantly'
)
returns table (
  lead_email  text,
  lead_name   text,
  company     text,
  sources     text[],
  labels      text[],
  msgs        int,
  first_at    timestamptz,
  last_at     timestamptz,
  responded   boolean,
  interested  boolean,
  needs_label boolean,
  robot_only  boolean
)
language sql
stable
set search_path = public
as $$
  select
    lower(r.lead_email),
    -- The freshest name and company we hold for them; older rows often carry
    -- neither, so this is a coalesce across the thread rather than a max().
    (array_agg(r.lead_name order by r.received_at desc)
       filter (where nullif(trim(r.lead_name), '') is not null))[1],
    (array_agg(r.company   order by r.received_at desc)
       filter (where nullif(trim(r.company),   '') is not null))[1],
    array_agg(distinct r.source),
    array_agg(distinct r.sentiment),
    count(*)::int,
    min(r.received_at),
    max(r.received_at),
    bool_or(r.sentiment in ('interested','not_interested','not_now','referral')),
    bool_or(r.sentiment = 'interested'),
    bool_and(r.sentiment = 'unclassified'),
    bool_and(r.sentiment = 'auto_reply')
  from replies r
  where r.lead_email is not null
    and (p_source    is null or r.source = p_source)
    and (p_campaigns is null or r.campaign_id = any (p_campaigns))
    and (p_from is null or r.received_at >=  (p_from::timestamp      at time zone 'America/New_York'))
    and (p_to   is null or r.received_at <  ((p_to + 1)::timestamp   at time zone 'America/New_York'))
  group by lower(r.lead_email)
$$;

-- The tiles. A thin wrapper on purpose: if this ever grows its own copy of the
-- predicates, the two numbers can disagree again, which is the entire bug.
create or replace function public.response_counts(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default 'instantly'
)
returns table (
  people      int,
  responded   int,
  interested  int,
  needs_label int,
  robot_only  int
)
language sql
stable
set search_path = public
as $$
  select
    count(*)::int,
    count(*) filter (where p.responded)::int,
    count(*) filter (where p.interested)::int,
    count(*) filter (where p.needs_label)::int,
    count(*) filter (where p.robot_only)::int
  from response_people(p_from, p_to, p_campaigns, p_source) p
$$;

grant execute on function public.response_people(date, date, uuid[], text) to anon, authenticated;
grant execute on function public.response_counts(date, date, uuid[], text) to anon, authenticated;
