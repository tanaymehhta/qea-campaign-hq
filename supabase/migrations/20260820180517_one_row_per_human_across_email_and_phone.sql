-- ============================================================
-- Leads becomes one row per human, across email and phone.
--
-- Decided by Tanay on 20 August 2026, reversing §10.1 of NEXT_AGENT.md. That
-- section said to put only the 11 people we have actually rung on this page and
-- to keep the 1,252-name call list off it. His reason for the reversal is the
-- page's whole job: he looks somebody up here before he contacts them, and a
-- name that is on the call list but not on this page is a name he will chase
-- twice.
--
-- ---------------------------------------------------------------------------
-- Two things were wrong with the page before any of that
--
-- 1. IT COUNTED ROWS AND CALLED THEM PEOPLE. `v_leads` is person × campaign:
--    2,780 rows, 2,731 humans. The 49 extra are one person imported into two
--    campaigns. Measured today, **no** person spans two campaign *groups* — all
--    49 duplicates sit inside one group — so collapsing to one row per human
--    loses nothing from the group tabs and they still sum to the total exactly.
--
-- 2. IDENTITY WAS NEVER DEFINED ACROSS CHANNELS. §10.3 settled it: the same
--    human is the same email address, lowercased, where both sides have one.
--    Never a name match. Measured today:
--
--      call contacts                                   1,252
--      of them with an email address                       72
--      whose email is already on this page                  0
--      whose NAME matches somebody on this page             1
--
--    That one is Michael Murphy — WEILL CORNELL MEDICINE on the call list,
--    Cushman & Wakefield on the email side, and no email on the call row. Two
--    people who share a common name, almost certainly. Merging them would have
--    been silent and wrong, which is exactly why the rule is what it is. A
--    name-only collision is a question for a human, and this view exposes it
--    as `name_twin` rather than acting on it.
--
-- ---------------------------------------------------------------------------
-- What a row is now
--
-- One human, keyed on their email address lowercased. A person with no email —
-- 1,180 of the call list — is keyed on their call-contact id, so they can never
-- collide with anybody. Three older calls (Levon Shaginyan, Mark Ellis,
-- Raffaele Albanese, 16 July, campaign label "New York") predate `call_contacts`
-- entirely and are keyed on their name, which is the only identity they have.
--
--   2,731  people on the email side
-- + 1,252  names on the call list
-- +     3  people rung before the call workspace existed
-- -     0  the same human on both sides
-- = 3,986  humans
--
-- The view is built on `v_leads` rather than on `people` so this change moves
-- no existing number. `v_leads` is security-definer and hands anon 49 rows from
-- hidden campaigns — that is Q9 in TRUST_OPEN.md, still open, and fixing it
-- moves a visible total, so it is not smuggled in here.
-- ============================================================

create or replace view v_lead_people as
with emailed as (
  select
    lower(vl.email) as person_key,
    -- One person, up to two campaign rows. Every field takes the first
    -- non-null in a deterministic order, so two imports of the same human
    -- cannot make the row flicker between page loads.
    (array_agg(vl.id order by vl.first_contacted_at nulls last, vl.id))[1]        as id,
    (array_agg(vl.group_id order by vl.group_id))[1]                              as group_id,
    (array_agg(vl.campaign_id order by vl.campaign_id))[1]                        as campaign_id,
    (array_agg(vl.name order by (vl.name is null), vl.name))[1]                    as name,
    lower(vl.email)                                                                as email,
    (array_agg(vl.company order by (vl.company is null), vl.company))[1]           as company,
    (array_agg(vl.title order by (vl.title is null), vl.title))[1]                 as title,
    (array_agg(vl.status order by (vl.status is null), vl.status))[1]              as status,
    (array_agg(vl.email_quality order by (vl.email_quality is null), vl.email_quality))[1] as email_quality,
    bool_or(vl.in_tools)                                                           as in_tools,
    min(vl.first_contacted_at)                                                     as first_contacted_at,
    max(vl.last_contacted_at)                                                      as last_contacted_at,
    bool_or(coalesce(vl.bounced, false))                                           as bounced,
    count(*)                                                                       as campaign_rows
  from v_leads vl
  where vl.email is not null
  group by lower(vl.email)
),
-- The call list. Every name on it, whether or not anybody has dialled it —
-- which is the reversal this migration exists for. `phone_calls` is left-joined
-- so an uncalled name still produces a row, with zero calls and no outcome.
call_side as (
  select
    coalesce(lower(nullif(trim(ct.email), '')), 'call:' || ct.id::text) as person_key,
    ct.id                                   as call_contact_id,
    ct.call_campaign_id,
    ct.full_name                            as name,
    lower(nullif(trim(ct.email), ''))       as email,
    ct.org_name                             as company,
    ct.role,
    ct.phone,
    ct.dnc,
    ct.dnc_reason,
    ct.callback_date,
    ct.buildings_count,
    ct.best_rank,
    count(pc.id)                            as calls,
    min(pc.call_date)                       as first_call_date,
    max(pc.call_date)                       as last_call_date,
    (array_agg(pc.outcome order by pc.call_date desc, pc.created_at desc)
       filter (where pc.id is not null))[1] as call_outcome,
    (array_agg(pc.rep order by pc.call_date desc, pc.created_at desc)
       filter (where pc.rep is not null))[1] as call_rep
  from call_contacts ct
  left join phone_calls pc on pc.contact_id = ct.id and pc.deleted_at is null
  group by ct.id
),
-- Calls logged before `call_contacts` existed. They have a name, a date and an
-- outcome and nothing else. Left off this page they would be people the
-- Overview counts as reached and this page has never heard of.
loose_calls as (
  select
    'call:' || lower(trim(pc.prospect_name)) as person_key,
    null::uuid                               as call_contact_id,
    null::uuid                               as call_campaign_id,
    (array_agg(pc.prospect_name order by pc.call_date))[1] as name,
    null::text                               as email,
    (array_agg(pc.company order by (pc.company is null)))[1] as company,
    null::text as role, null::text as phone,
    false as dnc, null::text as dnc_reason, null::date as callback_date,
    0 as buildings_count, null::int as best_rank,
    count(pc.id)      as calls,
    min(pc.call_date) as first_call_date,
    max(pc.call_date) as last_call_date,
    (array_agg(pc.outcome order by pc.call_date desc, pc.created_at desc))[1] as call_outcome,
    (array_agg(pc.rep order by pc.call_date desc, pc.created_at desc)
       filter (where pc.rep is not null))[1] as call_rep
  from phone_calls pc
  where pc.deleted_at is null and pc.contact_id is null
  group by 1
),
called as (
  select * from call_side
  union all
  select * from loose_calls
),
-- Name-only collisions. NOT a join — a flag, so a human can look at the two
-- rows and decide. See the header for the one that exists today.
twins as (
  select lower(trim(c.name)) as name_key
  from called c
  join emailed e on lower(trim(e.name)) = lower(trim(c.name))
  where c.email is null and c.name is not null
  group by 1
)
select
  coalesce(e.person_key, c.person_key)                       as person_key,
  coalesce(e.name, c.name)                                   as name,
  coalesce(e.email, c.email)                                 as email,
  coalesce(e.company, c.company)                             as company,
  coalesce(e.title, c.role)                                  as title,
  c.phone,
  -- Which doors this human is behind. `both` is currently empty and the rule
  -- that fills it is the email address, never the name.
  case when e.person_key is not null and c.person_key is not null then 'both'
       when c.person_key is not null then 'call'
       else 'email' end                                      as channel,
  e.group_id,
  e.campaign_id,
  c.call_campaign_id,
  c.call_contact_id,
  e.status,
  e.email_quality,
  coalesce(e.in_tools, false)                                as in_tools,
  coalesce(e.bounced, false)                                 as bounced,
  e.first_contacted_at,
  e.last_contacted_at,
  coalesce(c.calls, 0)                                       as calls,
  c.first_call_date,
  c.last_call_date,
  c.call_outcome,
  c.call_rep,
  c.callback_date,
  coalesce(c.dnc, false)                                     as dnc,
  c.dnc_reason,
  coalesce(c.buildings_count, 0)                             as buildings_count,
  c.best_rank,
  -- The one question this page is for: have we put anything in front of this
  -- person yet, by any channel? A dial counts whatever came of it — the same
  -- rule the Overview's People reached uses since 20 Aug.
  least(
    e.first_contacted_at,
    coalesce(c.first_call_date::timestamp at time zone 'America/New_York', e.first_contacted_at)
  )                                                          as contacted_at,
  -- Can we contact them at all? 1,178 names on the call list have neither a
  -- phone number nor an email address, and a worklist that buries the callable
  -- under them is worse than no worklist.
  (coalesce(e.email, c.email) is not null or nullif(trim(coalesce(c.phone, '')), '') is not null) as contactable,
  (t.name_key is not null)                                   as name_twin
from emailed e
full outer join called c on c.person_key = e.person_key
left join twins t on t.name_key = lower(trim(c.name));

-- Same posture as `v_leads`, which this reads: RLS on the underlying tables is
-- what it is, and this view does not widen it beyond what that page already
-- showed. Q9 (TRUST_OPEN.md §9) still governs the 49 hidden-campaign rows.
grant select on v_lead_people to anon, authenticated;
