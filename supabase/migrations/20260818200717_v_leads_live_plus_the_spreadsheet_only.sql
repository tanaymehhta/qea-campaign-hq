-- /leads stops being a snapshot of 28 July.
--
-- Measured 18 Aug: `leads` holds 1,950 rows, newest created_at 28 July, and
-- **no writer anywhere in this repository**. `people` holds 2,756 and is synced
-- every 30 minutes. 810 people are in the tools and invisible on that page, and
-- the number grows with every campaign. A new campaign reaches every page within
-- half an hour except this one, and nothing on screen said so.
--
-- Applying PLAN.md §1's model: `people` is the **vendor** copy and is live.
-- `leads` holds a **human** fact — that somebody put this person on a list, from
-- a named source file, with a quality grade and a pipeline status — for rows
-- that exist nowhere else. Neither is redundant. Only one is current.
--
-- ---------------------------------------------------------------------------
-- `leads.status` stays human-owned. Decided 18 Aug rather than inferred, because
-- PLAN.md Phase 1c says to ask: its vocabulary (sent / assigned / prospect /
-- held / no_email) describes a human pipeline, not vendor state, and there is no
-- honest mapping onto `people`. So the 1,950 imported rows keep their status and
-- everyone else joins with **null**, which renders as an em dash. Deriving a
-- status for the other 810 would make one word mean two different things
-- depending on which half of the list you were reading — the exact failure this
-- whole exercise has been removing.
--
-- ---------------------------------------------------------------------------
-- Two measured details that shape the SQL:
--
--   `leads` has 1,950 rows across only **1,921 distinct emails**. Joining
--   people to leads on email directly would fan a person out into two rows.
--   `lead_one` picks one row per address, oldest first, so the join cannot
--   multiply.
--
--   **53 leads rows have no matching person**, across **24 distinct addresses** —
--   TRUST.md's 24 counted people, not rows, and both are right. They are the
--   spreadsheet entries that were never loaded into a tool, and they are the
--   reason this view is a union rather than a straight read of `people`.
--
-- Row grain is one per (person, campaign), so a person in two campaigns appears
-- twice — which is what makes the per-group counts add up, and matches how
-- `leads` already behaved. The "Total people" tile counts rows, as it did
-- before; the honest distinct figure is about 2% lower (2,731 of 2,780).
create or replace view v_leads as
with lead_one as (
  select distinct on (lower(l.email))
         lower(l.email) as email_key,
         l.id, l.group_id, l.campaign_id, l.name, l.email, l.company, l.title,
         l.status, l.email_quality, l.source_list, l.source_file, l.created_at
  from leads l
  where l.email is not null
  order by lower(l.email), l.created_at, l.id
)
-- the live side: everyone the tools currently know about
select
  p.id,
  m.group_id,
  p.campaign_id,
  p.source,
  p.name,
  lower(p.email)          as email,
  p.company,
  lo.title,
  lo.status,                       -- human, null for anyone never on a spreadsheet
  lo.email_quality,
  lo.source_list,
  lo.source_file,
  true                    as in_tools,
  p.first_contacted_at,
  p.last_contacted_at,
  p.bounced
from people p
left join campaign_group_members m on m.campaign_id = p.campaign_id
left join lead_one lo on lo.email_key = lower(p.email)

union all

-- and the ones who only ever existed on a spreadsheet
select
  lo.id,
  lo.group_id,
  lo.campaign_id,
  null::text              as source,
  lo.name,
  lo.email_key            as email,
  lo.company,
  lo.title,
  lo.status,
  lo.email_quality,
  lo.source_list,
  lo.source_file,
  false                   as in_tools,
  null::timestamptz       as first_contacted_at,
  null::timestamptz       as last_contacted_at,
  null::boolean           as bounced
from lead_one lo
where not exists (
  select 1 from people p where lower(p.email) = lo.email_key
);

grant select on v_leads to anon, authenticated;
