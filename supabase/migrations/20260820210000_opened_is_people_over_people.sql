-- ============================================================
-- "Emails opened" becomes people, over the people who could be counted.
--
-- Q4 in TRUST_OPEN.md, and the same fault T4 just fixed one tile over.
-- Measured 20 Aug 2026, all time, scraping the tile and following its href:
--
--   tile   Emails opened   6.3% / 225     href /list?metric=opened&range=all
--   click                        351 people
--
-- Three different things were being called "opened":
--
--   225  `unique_opened` from the daily notebook, Instantly only. Unique per
--        campaign-DAY, so one person opening on Monday and again on Tuesday is
--        two. Not a headcount, and never was.
--   123  Instantly people with opened_count > 0. Instantly's own two records
--        disagree with each other by 102.
--   228  lemlist people with opened_count > 0. lemlist has never written
--        `unique_opened` at all, so all 228 were invisible to the tile —
--        exactly the hole that hid its 554 reached people until this morning.
--
-- And the denominator was messages: 3,574 *tracked sends* under a numerator
-- that was trying to be people. House rule 4 — a rate's two halves must be the
-- same kind of thing — failed on the same tile that was built to demonstrate it.
--
-- ---------------------------------------------------------------------------
-- What replaces it
--
-- Opens are not a separate pile. They are a **property of a person we reached**,
-- so `reached_people` grows one column and the callers filter on what it
-- already returns — the same way `PILES` filters `response_people` rather than
-- each tile writing its own definition of a response.
--
--   opened   people with opened_count > 0        351  = 123 Instantly + 228 lemlist
--   can_open the campaign that reached them can register an open at all
--
-- Measured today, and this is the whole argument for the new denominator:
--
--   Instantly, tracking on    937 reached   123 opened   13.1%
--   Instantly, tracking off   902 reached     0 opened   unobservable, not zero
--   lemlist                   554 reached   228 opened   41.2%
--
-- 902 people are in campaigns with no pixel in the mail. They did not decline to
-- open it; nothing was watching. Leaving them in the denominator is the
-- guaranteed-zero padding that made the old number 6.3% instead of 23.5%.
--
-- `can_open` is `open_tracking is distinct from false`, so a NULL counts as
-- able. That NULL is lemlist's — it does not report the setting at all — and
-- its campaigns demonstrably register opens, 228 of them. Reading NULL as
-- "cannot" would delete a vendor's entire open history to avoid an unknown,
-- which is the same move as the 0 we are removing, pointed the other way.
--
-- ---------------------------------------------------------------------------
-- What this costs, stated rather than buried
--
-- **The window now means the person's reach date, not the open date.** Neither
-- tool timestamps an open per person — `people.opened_count` is lifetime state
-- with no date on it, which is why `/list?metric=opened` has always carried a
-- banner saying it cannot honour a window. The notebook's per-campaign-day
-- `unique_opened` was the only dated open signal and it is not a headcount, so
-- the two cannot both be had. A window now selects the people reached in it and
-- asks which of them have ever opened. That sentence is on the tile and on the
-- list.
--
-- The tile is renamed **People who opened**. "Emails opened" was accurate for a
-- number counting events and is a lie for a number counting humans.
--
-- Bounce is deliberately NOT moved. Its tile is assembled from the per-mailbox
-- daily table with a partial-day guard and an unplaceable-mailbox total, and it
-- agrees with its own click today. Dragging it into this pile would rebuild
-- working provenance to make an unrelated point.
-- ============================================================

-- The return type changes, so this is a drop rather than a replace. Recreated
-- immediately below with the grants restated.
drop function if exists public.reached_counts(date, date, uuid[], text);
drop function if exists public.reached_people(date, date, uuid[], text);

create function public.reached_people(
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
  can_open           boolean,
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
           (c.open_tracking is distinct from false) as could_open,
           least(p.first_contacted_at, coalesce(f.sent_at, p.first_contacted_at)) as reached_at
    from people p
    -- Inner join: a person with no campaign row cannot be scoped, counted per
    -- group, or asked whether their mail carried a pixel. Measured today, there
    -- are none, and if one ever appears it should surface as a missing campaign
    -- rather than as a person with invented properties.
    join campaigns c on c.id = p.campaign_id
    left join first_send f
      on f.email_key = lower(p.email) and f.src = p.source
    where p.first_contacted_at is not null
      and (p_source    is null or p.source = p_source)
      and (p_campaigns is null or p.campaign_id = any (p_campaigns))
  )
  select distinct on (lower(d.email))
    d.id, d.campaign_id, d.source, lower(d.email), d.name, d.company, d.status,
    d.sent_count, d.opened_count, d.clicked_count, d.replied_count, d.bounced,
    d.could_open,
    -- Returned under the name the rest of the app already knows. The corrected
    -- date is the one the window filtered on, so the list cannot show a date
    -- the count did not use.
    d.reached_at, d.last_contacted_at
  from dated d
  where (p_from is null or d.reached_at >=  (p_from::timestamp     at time zone 'America/New_York'))
    and (p_to   is null or d.reached_at <  ((p_to + 1)::timestamp  at time zone 'America/New_York'))
  order by lower(d.email), d.reached_at
$$;

-- The tiles. Still a thin wrapper: every number here is a `count(*) filter` over
-- the rows the list itself receives, so a tile and its click cannot describe
-- different people.
--
--   people     everyone reached in scope
--   instantly / lemlist   the vendor split the reached tile prints
--   opened     of those, who has ever opened
--   trackable  of those, whose mail could register an open at all — the only
--              honest denominator for `opened`
create function public.reached_counts(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default null
)
returns table (people int, instantly int, lemlist int, opened int, trackable int)
language sql
stable
set search_path = public
as $$
  select
    count(*)::int,
    count(*) filter (where r.source = 'instantly')::int,
    count(*) filter (where r.source = 'lemlist')::int,
    count(*) filter (where r.opened_count > 0)::int,
    count(*) filter (where r.can_open)::int
  from reached_people(p_from, p_to, p_campaigns, p_source) r
$$;

grant execute on function public.reached_people(date, date, uuid[], text) to anon, authenticated;
grant execute on function public.reached_counts(date, date, uuid[], text) to anon, authenticated;
