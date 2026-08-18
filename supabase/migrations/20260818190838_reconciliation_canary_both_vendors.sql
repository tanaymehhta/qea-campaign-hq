-- A canary that can actually see the fault it exists to catch.
--
-- v_metric_drift, the canary already on /health, is scoped `where c.source =
-- 'lemlist'` and compares daily_metrics against activities. Since
-- 20260730135341 made one SQL function the sole writer of both sides, they
-- cannot disagree. It is empty by construction and has read "all clear" for a
-- month while the Instantly bounce gap sat in plain sight.
--
-- This one compares the two notebooks that actually feed different pages:
--   Notebook 1  daily_metrics    -> the Overview, the chart, /health
--   Notebook 2  campaign_totals  -> /campaigns, /campaigns/[slug], /c/[id]
-- Both vendors. A row here means two pages will print different numbers for the
-- same word, which is the whole of what went wrong.
--
-- Grain is not uniform, and pretending it is would rebuild the bug. Instantly
-- bounce cannot be placed on a campaign: the only dated copy lives in
-- email_account_daily, keyed on the mailbox, and 13 of 23 Instantly mailboxes
-- send for more than one campaign. So it reconciles company-wide - one row for
-- the vendor, campaign_id null - and every other pair reconciles per campaign.
--
-- `delivered` is deliberately absent. It is sent - bounced, a formula, not a
-- measurement; storing it is what let it drift to 1,844 against 7,395. It is
-- derived at read time from Phase 1 onward and there is nothing left to compare.
-- `contacted` is absent too: never displayed on any page, so a difference in it
-- cannot mislead anyone.
create or replace view v_reconciliation as
with daily as (
  select campaign_id,
         sum(sent)    as sent,
         sum(bounced) as bounced,
         sum(opened)  as opened,
         sum(replied) as replied,
         sum(clicked) as clicked
  from daily_metrics
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
company_bounce as (
  select 'instantly'::text                  as source,
         null::uuid                         as campaign_id,
         'all instantly campaigns'::text    as name,
         'bounced'::text                    as metric,
         sum(coalesce(d.bounced,0))::int    as daily_total,
         sum(coalesce(t.bounced,0))::int    as lifetime_total
  from campaigns c
  left join daily d on d.campaign_id = c.id
  left join campaign_totals t on t.campaign_id = c.id
  where c.source = 'instantly'
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
