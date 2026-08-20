-- ============================================================
-- People reached: one definition, both tools, a headcount of humans.
--
-- Measured 20 Aug 2026 the way §7 of the handoff asks — scrape the tile's
-- number, follow the tile's own href, count what comes back:
--
--   tile  "People reached"  1,839    href  /list?metric=contacted&range=all
--   click                   2,393 people
--
-- The gap is 554 and every one of them is lemlist. The number came from
-- `v_daily_facts.new_leads_contacted`, which lemlist has never written — 0
-- across all 234 of its campaign-days. The click read `people.first_contacted_at`,
-- which both vendors do write. Two answers to one question: F2 in TRUST.md,
-- living in the first tile of the funnel.
--
-- Every doc in this repo records "lemlist never reported people reached". That
-- is true of the daily notebook and false of the per-person table, and the
-- distinction was never written down. lemlist's 554 were rebuilt from its
-- activity stream with a true minimum (see 20260806185524) and have been
-- sitting in `people` the whole time.
--
-- ---------------------------------------------------------------------------
-- Why the number moves to the per-person table rather than the click moving to
-- the notebook
--
-- Only one of the two can produce a list. `new_leads_contacted` is a count per
-- campaign-day with no names attached, so a tile fed by it can never open onto
-- the people it counted. `people` has the humans. The one-pile rule decides it:
-- the number must come from the pile that can be listed.
--
-- Corroboration that the two really are the same population, not two
-- populations that happen to be near each other: on the Instantly side the
-- notebook totals 1,839 and this function returns 1,839, exactly, and 8/11,
-- 8/12 and 8/13 agree day by day (30/30, 323/323, 145/145).
--
-- ---------------------------------------------------------------------------
-- Why the date is `least(stored first contact, earliest surviving send)`
--
-- Instantly's API never exposes first-touch. The sync writes
-- `timestamp_last_contact` into `first_contacted_at` (functions/sync ~line 355)
-- and before the 6 Aug trigger it was overwritten every 30 minutes, so a person
-- first emailed on 21 July who got a follow-up on 4 August is stored as
-- 4 August. All time is unharmed — they are one person either way — but a
-- windowed view files them on the wrong day.
--
-- Measured, whole Instantly cohort, per NY calendar day against the notebook:
--
--   stored date as-is                 1,171 of 1,839 people misdated,
--                                     smeared onto 3-6 Aug from all of July
--   least(stored, earliest send)        423 misdated, all of them inside the
--                                     same July fortnight, ~6 days late
--
-- So the send log remembers an earlier send than the frozen column for 1,219
-- people, and taking whichever is earlier is strictly closer to the truth. It
-- is not exact and is not claimed to be: Instantly's activity feed also keeps
-- only a lead's most recent send, which is why 423 survive. Those 423 sit on
-- 27-28 July against a notebook that says 20-21 July, and the two errors cancel
-- to the row — 423 missing from one pair of days, 423 extra on the other.
--
-- lemlist is untouched by any of this; its dates were always right. Instantly
-- after 6 Aug is untouched too. Tanay chose this option on 20 Aug over leaving
-- the dates raw and over refusing a date window altogether.
--
-- ---------------------------------------------------------------------------
-- The grain is a person, not a row
--
-- `people` is keyed per campaign, so the same human in two campaigns is two
-- rows. Today that changes nothing — 2,393 rows across 2,393 addresses — and
-- the day it does, a tile that counts rows starts saying "people" while meaning
-- "rows", which is exactly the fault the Meetings tile still carries (Jeffrey
-- Hohenstein, twice). `distinct on (lower(email))` keeps the earliest contact,
-- so a person is counted once and shown under the campaign that first reached
-- them. Scoping happens before the dedupe, so a per-campaign drill-down still
-- finds someone who is also in another campaign.
--
-- ---------------------------------------------------------------------------
-- Same four arguments as response_people, and the same reasons
--
--   p_from / p_to      inclusive New York calendar dates, null = unbounded.
--   p_campaigns        null = everything the anon key can see; a rep's scope is
--                      resolved to campaign ids by campaignIdsForRep first.
--   p_source           'instantly' | 'lemlist' | null for both. Defaults to
--                      both here, where response_people defaults to Instantly:
--                      that default exists because a rate needed an Instantly
--                      denominator, and this function IS the denominator.
--
-- `security invoker`, and `hidden` appears nowhere in the body. `people` and
-- `activities` both carry `NOT is_hidden_campaign(campaign_id)` for anon, the
-- only role the dashboard holds. Writing this `security definer` would hand it
-- rows it has never been allowed to see. Measured today: no reached person sits
-- in a hidden campaign, so this changes no number now — it means the exclusion
-- cannot be forgotten later.
--
-- No stored copy, no new column, no rollup: house rule 7. Both functions are
-- live aggregates over tables the sync already maintains.
-- ============================================================

create or replace function public.reached_people(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default null
)
returns table (
  id                 uuid,
  campaign_id        uuid,
  source             text,
  email              text,
  name               text,
  company            text,
  status             text,
  sent_count         int,
  opened_count       int,
  clicked_count      int,
  replied_count      int,
  bounced            boolean,
  first_contacted_at timestamptz,
  last_contacted_at  timestamptz
)
language sql
stable
set search_path = public
as $$
  with first_send as (
    select a.source as src, lower(a.email) as email_key, min(a.occurred_at) as sent_at
    from activities a
    where a.event_type = 'sent' and a.email is not null
    group by 1, 2
  ),
  dated as (
    -- The date this person was reached, as close as either tool will admit to.
    -- coalesce inside least() because least() ignores nulls but the intent is
    -- explicit: no send row means the stored date stands unchallenged.
    select p.*,
           least(p.first_contacted_at, coalesce(f.sent_at, p.first_contacted_at)) as reached_at
    from people p
    left join first_send f
      on f.email_key = lower(p.email) and f.src = p.source
    where p.first_contacted_at is not null
      and (p_source    is null or p.source = p_source)
      and (p_campaigns is null or p.campaign_id = any (p_campaigns))
  )
  select distinct on (lower(d.email))
    d.id, d.campaign_id, d.source, lower(d.email), d.name, d.company, d.status,
    d.sent_count, d.opened_count, d.clicked_count, d.replied_count, d.bounced,
    -- Returned under the name the rest of the app already knows. The corrected
    -- date is the one the window filtered on, so the list cannot show a date
    -- the count did not use.
    d.reached_at, d.last_contacted_at
  from dated d
  where (p_from is null or d.reached_at >=  (p_from::timestamp     at time zone 'America/New_York'))
    and (p_to   is null or d.reached_at <  ((p_to + 1)::timestamp  at time zone 'America/New_York'))
  order by lower(d.email), d.reached_at
$$;

-- The tile. A thin wrapper on purpose — if it ever grows its own copy of the
-- predicates the number and the list can disagree again, which is the bug.
-- The vendor split rides along because the tile says it out loud, the way the
-- Emails sent tile already does.
create or replace function public.reached_counts(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default null
)
returns table (people int, instantly int, lemlist int)
language sql
stable
set search_path = public
as $$
  select
    count(*)::int,
    count(*) filter (where r.source = 'instantly')::int,
    count(*) filter (where r.source = 'lemlist')::int
  from reached_people(p_from, p_to, p_campaigns, p_source) r
$$;

grant execute on function public.reached_people(date, date, uuid[], text) to anon, authenticated;
grant execute on function public.reached_counts(date, date, uuid[], text) to anon, authenticated;
