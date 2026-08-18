-- Point the canary at what the pages actually read.
--
-- v_reconciliation was built one step earlier against daily_metrics, on purpose:
-- a detector that has never been seen to fail is not a detector. It returned
-- exactly one row - instantly / bounced / daily 0 / lifetime 72 - which is the
-- fault we already understood, at the size we already knew.
--
-- Now it reads v_daily_facts, the same source the Overview and /health read. The
-- question it answers changes from "do two stored copies agree" to the one that
-- matters: "does the number on the Overview equal the number on /campaigns".
--
-- One consequence worth stating, because it is the whole reason the grain split
-- exists: an Instantly campaign-day bounce in v_daily_facts is NULL, so summing
-- it per campaign yields NULL, and NULL is not a disagreement - it is the
-- absence of a claim. Instantly bounce therefore reconciles only at the grain it
-- is knowable: company-wide, one row, campaign_id null. That row is the
-- acceptance test for Phase 1 and it should now be gone.
create or replace view v_reconciliation as
with daily as (
  select campaign_id,
         sum(sent)    as sent,
         sum(bounced) as bounced,
         sum(opened)  as opened,
         sum(replied) as replied,
         sum(clicked) as clicked
  from v_daily_facts
  where campaign_id is not null
  group by campaign_id
),
per_campaign as (
  select c.source, c.id as campaign_id, c.name, m.metric, m.daily_total, m.lifetime_total
  from campaigns c
  left join daily d on d.campaign_id = c.id
  left join campaign_totals t on t.campaign_id = c.id
  cross join lateral (values
    ('sent',    coalesce(d.sent,0),    coalesce(t.sent,0)),
    ('bounced', coalesce(d.bounced,0), coalesce(t.bounced,0)),
    ('opened',  coalesce(d.opened,0),  coalesce(t.opened,0)),
    ('replied', coalesce(d.replied,0), coalesce(t.replied,0)),
    ('clicked', coalesce(d.clicked,0), coalesce(t.clicked,0))
  ) as m(metric, daily_total, lifetime_total)
  -- the one pair whose daily side is not campaign-shaped; handled below
  where not (c.source = 'instantly' and m.metric = 'bounced')
),
-- The company-wide row. The daily side is the overlay in v_daily_facts; the
-- lifetime side is every Instantly campaign's stored total. A NULL overlay date
-- (the nightly mailbox pull has not landed for today yet) makes the daily side
-- NULL, and the row reports as a difference against NULL rather than pretending
-- the window is complete.
company_bounce as (
  select 'instantly'::text               as source,
         null::uuid                      as campaign_id,
         'all instantly campaigns'::text as name,
         'bounced'::text                 as metric,
         (select sum(bounced)::int from v_daily_facts
           where campaign_id is null and source = 'instantly') as daily_total,
         (select sum(t.bounced)::int from campaign_totals t
             join campaigns c on c.id = t.campaign_id
            where c.source = 'instantly')                      as lifetime_total
),
all_pairs as (
  select * from per_campaign
  union all
  select * from company_bounce
)
select
  source, campaign_id, name, metric, daily_total, lifetime_total,
  lifetime_total - daily_total as difference,
  -- Sized, not binary: one send off on a 5,000-send campaign is a rounding
  -- artefact between two vendor endpoints; ten is somebody's data going missing.
  case
    when abs(lifetime_total - daily_total) >= 10
      or abs(lifetime_total - daily_total)::numeric
         / nullif(greatest(daily_total, lifetime_total), 0) > 0.05 then 'high'
    when abs(lifetime_total - daily_total) >= 3
      or abs(lifetime_total - daily_total)::numeric
         / nullif(greatest(daily_total, lifetime_total), 0) > 0.01 then 'medium'
    else 'low'
  end as severity
from all_pairs
where daily_total is distinct from lifetime_total;

grant select on v_reconciliation to anon, authenticated;
