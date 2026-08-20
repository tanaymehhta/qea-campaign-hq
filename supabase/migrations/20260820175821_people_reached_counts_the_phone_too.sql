-- ============================================================
-- People reached counts the phone too.
--
-- Decided by Tanay on 20 August 2026, reversing §10.2 of NEXT_AGENT.md, which
-- said this tile stays the email pile. His words: "which is then reached out
-- the no of people to whom phone calls have been made no matter what the
-- outcome is."
--
-- So the rule is: **we reached a person if we emailed them or if we rang them,
-- whatever happened on the call.** A voicemail counts. A no-answer counts. The
-- dial is the reach.
--
-- Measured 20 Aug 2026, before the change:
--
--   email pile (reached_people)                     2,399 people
--   people with at least one live phone_calls row      11 people
--   of those 11, already in the email pile              0
--   ------------------------------------------------------
--   after                                           2,410 people
--
-- The 11 are 8 rows in `call_contacts` plus 3 older calls (Levon Shaginyan,
-- Mark Ellis, Raffaele Albanese, all 16 July, campaign label "New York") that
-- were logged before the call workspace existed and have no contact record at
-- all. They are still people we rang, so they are still people we reached. They
-- key on their name because that is the only identity they have.
--
-- ---------------------------------------------------------------------------
-- Three things this must not break, and how each is held
--
-- 1. THE OPEN RATE. `opened` ÷ `trackable`, where trackable is "their mail
--    could carry a pixel". A person we only phoned was never sent mail, so
--    `can_open` is false for them and they cannot enter that denominator. The
--    rate is unmoved by this migration — verified below.
--
-- 2. IDENTITY. Same human = same email address, lowercased, where both sides
--    have one (§10.3). Never a name match across piles. The dedup key is the
--    email when there is one and a call-scoped key when there is not, so a
--    called person with no email can never silently merge onto an emailed one.
--    Zero overlap today; the rule is for when it starts.
--
-- 3. A REP'S NUMBERS MUST SUM TO EVERYONE'S. A called person has no
--    `campaign_id`, so scoping by campaign alone would drop all 11 out of every
--    rep view while leaving them in the all-reps total — the same hole that put
--    a call-booked meeting in the tile and not in its own click
--    (20260820174533). Hence `p_rep`: a called person is in a rep's scope when
--    the caller was that rep, or when the call campaign is theirs.
--
--    `p_rep` defaults to null and every existing caller omits it, so nothing
--    that does not pass it changes behaviour.
--
-- ---------------------------------------------------------------------------
-- Which date "reached" means when both channels touched one person
--
-- The earliest one. Reached is a first-touch fact, so an email in June and a
-- call in August is a person reached in June, and the row carries the June
-- source. Nobody is in both piles today, so this decides nothing yet — it is
-- written down so it is not decided differently by accident later.
-- ============================================================

-- The four-argument versions go first, so the five-argument ones below cannot
-- coexist with them for even one statement — an overload reachable by four
-- named arguments is an ambiguous call, and the old one would answer 2,399
-- while the tile beside it read 2,410.
drop function if exists public.reached_counts(date, date, uuid[], text);
drop function if exists public.reached_people(date, date, uuid[], text);

create or replace function public.reached_people(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default null,
  p_rep       text    default null
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
set search_path to 'public'
as $function$
  with first_send as (
    select a.source as src, lower(a.email) as email_key, min(a.occurred_at) as sent_at
    from activities a
    where a.event_type = 'sent' and a.email is not null
    group by 1, 2
  ),
  emailed as (
    -- Unchanged from 20260820200000. The date this person was reached, as close
    -- as either tool will admit to. coalesce inside least() because least()
    -- ignores nulls but the intent is explicit: no send row means the stored
    -- date stands unchallenged.
    select
      coalesce(lower(p.email), 'person:' || p.id::text) as key,
      p.id, p.campaign_id, p.source, lower(p.email) as email, p.name, p.company,
      p.status, p.sent_count, p.opened_count, p.clicked_count, p.replied_count,
      p.bounced,
      (c.open_tracking is distinct from false) as can_open,
      least(p.first_contacted_at, coalesce(f.sent_at, p.first_contacted_at)) as reached_at,
      p.last_contacted_at
    from people p
    -- Inner join: a person with no campaign row cannot be scoped, counted per
    -- group, or asked whether their mail carried a pixel. Measured, there are
    -- none, and if one ever appears it should surface as a missing campaign
    -- rather than as a person with invented properties.
    join campaigns c on c.id = p.campaign_id
    left join first_send f
      on f.email_key = lower(p.email) and f.src = p.source
    where p.first_contacted_at is not null
      and (p_source    is null or p.source = p_source)
      and (p_campaigns is null or p.campaign_id = any (p_campaigns))
  ),
  -- One row per human we have dialled. `deleted_at` is the soft delete every
  -- call reader already honours — a mis-logged call that was taken back is not
  -- a person we reached.
  called as (
    select
      coalesce(
        lower(nullif(trim(ct.email), '')),
        'call:' || coalesce(ct.id::text, lower(trim(pc.prospect_name)))
      ) as key,
      -- Grouped on the person key alone, never on the call's own id: three of
      -- these people predate `call_contacts` and are identified only by name,
      -- and grouping by a per-call column would split one human into one row
      -- per dial the moment somebody rings them twice.
      (array_agg(coalesce(ct.id, pc.id) order by pc.call_date, pc.created_at))[1] as id,
      null::uuid   as campaign_id,
      'call'::text as source,
      (array_agg(lower(nullif(trim(ct.email), '')) order by pc.call_date))[1]    as email,
      (array_agg(coalesce(ct.full_name, pc.prospect_name) order by pc.call_date))[1] as name,
      (array_agg(coalesce(ct.org_name, pc.company) order by pc.call_date))[1]    as company,
      -- The newest outcome, which is what the calls workspace already shows on
      -- the row. A count of dials would be a different fact and is not this.
      (array_agg(pc.outcome order by pc.call_date desc, pc.created_at desc))[1]  as status,
      0 as sent_count, 0 as opened_count, 0 as clicked_count, 0 as replied_count,
      false as bounced,
      -- We never sent this person mail, so no pixel of ours could ever load in
      -- it. False keeps them out of the open rate's denominator, which is the
      -- one number this migration must not move.
      false as can_open,
      min(pc.call_date)::timestamp at time zone 'America/New_York' as reached_at,
      max(pc.call_date)::timestamp at time zone 'America/New_York' as last_contacted_at
    from phone_calls pc
    left join call_contacts  ct on ct.id = pc.contact_id
    left join call_campaigns cc on cc.id = ct.call_campaign_id
    where pc.deleted_at is null
      and (p_source is null or p_source = 'call')
      -- A called person belongs to no email campaign, so a campaign-only scope
      -- cannot hold them. They answer to the rep who rang them, or to the owner
      -- of the list they were rung from. With no rep asked for, an explicit
      -- campaign scope means "these email campaigns" and excludes them.
      and (
        (p_campaigns is null and p_rep is null)
        or (p_rep is not null and (pc.rep = p_rep or cc.owner = p_rep))
      )
    group by 1
  ),
  everyone as (
    select key, id, campaign_id, source, email, name, company, status,
           sent_count, opened_count, clicked_count, replied_count, bounced,
           can_open, reached_at, last_contacted_at, 0 as pile from emailed
    union all
    select key, id, campaign_id, source, email, name, company, status,
           sent_count, opened_count, clicked_count, replied_count, bounced,
           can_open, reached_at, last_contacted_at, 1 as pile from called
  )
  select distinct on (e.key)
    e.id, e.campaign_id, e.source, e.email, e.name, e.company, e.status,
    e.sent_count, e.opened_count, e.clicked_count, e.replied_count, e.bounced,
    e.can_open,
    -- Returned under the name the rest of the app already knows. The date the
    -- window filtered on is the date the list shows, so the two cannot differ.
    e.reached_at, e.last_contacted_at
  from everyone e
  where (p_from is null or e.reached_at >=  (p_from::timestamp     at time zone 'America/New_York'))
    and (p_to   is null or e.reached_at <  ((p_to + 1)::timestamp  at time zone 'America/New_York'))
  -- Earliest touch wins, and the email pile breaks a same-day tie because it
  -- carries the richer row. See the header: this decides nothing today.
  order by e.key, e.reached_at, e.pile
$function$;

-- The tile. Still a thin wrapper on purpose: if it grows its own copy of the
-- predicates, the number and the list can disagree again, which is the bug.
create or replace function public.reached_counts(
  p_from      date    default null,
  p_to        date    default null,
  p_campaigns uuid[]  default null,
  p_source    text    default null,
  p_rep       text    default null
)
returns table (people int, instantly int, lemlist int, calls int,
               opened int, trackable int)
language sql
stable
set search_path to 'public'
as $function$
  select
    count(*)::int,
    count(*) filter (where r.source = 'instantly')::int,
    count(*) filter (where r.source = 'lemlist')::int,
    count(*) filter (where r.source = 'call')::int,
    count(*) filter (where r.opened_count > 0)::int,
    count(*) filter (where r.can_open)::int
  from reached_people(p_from, p_to, p_campaigns, p_source, p_rep) r
$function$;

grant execute on function public.reached_people(date, date, uuid[], text, text) to anon, authenticated;
grant execute on function public.reached_counts(date, date, uuid[], text, text) to anon, authenticated;
