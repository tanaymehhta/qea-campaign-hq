-- The daily notebook, with the hole named instead of filled with a zero.
--
-- daily_metrics was written before either sync existed and declared
-- `bounced int default 0` / `delivered int default 0`. syncInstantly() names
-- eleven columns and never those two, so Postgres supplied the default and
-- "we did not copy it" became indistinguishable from "it was zero". 5,623
-- Instantly emails read as a perfect 0% bounce rate on the homepage while
-- /campaigns, reading the vendor's lifetime endpoint, read 72.
--
-- This view is what the Overview and /health read instead. Three rules:
--
-- 1. Instantly campaign-day `bounced` is NULL, never 0. We do not know it and
--    will not claim to. It becomes real only if the daily API turns out to
--    carry a bounce field (Phase 1b) - one authenticated GET decides that.
--
-- 2. The company-wide Instantly bounce arrives as an overlay row: one per date,
--    campaign_id NULL, carrying only `bounced`. email_account_daily has the
--    dated truth but is keyed on (source, email, metric_date) with no campaign
--    id, and 13 of 23 Instantly mailboxes send for more than one campaign. So
--    the figure is real at company grain and unattributable below it.
--    Attributing the ten single-campaign mailboxes anyway would put a real
--    number on some campaigns and 0 on the rest with nothing on screen saying
--    which - the exact failure this view exists to end.
--
-- 3. `delivered` is derived as sent - bounced, never stored. Storing it is how
--    it drifted to 1,844 against the lifetime notebook's 7,395. NULL bounce
--    gives NULL delivered, which is the honest answer.
--
-- The overlay's own gap, measured and deliberately left visible: email_account_daily
-- is refreshed by the 03:00 ET nightly run, not the 30-minute one. So today
-- always has an Instantly send day with no mailbox row yet. That date gets an
-- overlay row with `bounced` NULL rather than no row at all - a missing row
-- would silently read as "no bounces today", which is the same lie one level up.
-- A reader summing this column must treat NULL as "not yet known" and refuse to
-- total the window, which is what app/page.jsx does.
create or replace view v_daily_facts as
select
  d.campaign_id,
  c.source,
  d.metric_date,
  d.sent,
  d.contacted,
  d.new_leads_contacted,
  case when c.source = 'instantly' then null else d.bounced end as bounced,
  case when c.source = 'instantly' then null else d.sent - d.bounced end as delivered,
  d.opened,
  d.unique_opened,
  d.replied,
  d.unique_replied,
  d.replies_automatic,
  d.clicked,
  d.unique_clicked,
  d.linkedin_sent,
  d.linkedin_accepted,
  d.opportunities
from daily_metrics d
join campaigns c on c.id = d.campaign_id

union all

-- The overlay. Every date Instantly is known to have been active, from either
-- side, so a date present in one and missing from the other cannot go silent.
-- Every column but `bounced` is 0: this row measures nothing else and must add
-- nothing else to any sum it lands in.
select
  null::uuid                    as campaign_id,
  'instantly'::text             as source,
  dates.metric_date,
  0 as sent,
  0 as contacted,
  0 as new_leads_contacted,
  (select sum(e.bounced)::int
     from email_account_daily e
    where e.source = 'instantly'
      and e.metric_date = dates.metric_date) as bounced,
  null::int                     as delivered,
  0 as opened,
  0 as unique_opened,
  0 as replied,
  0 as unique_replied,
  0 as replies_automatic,
  0 as clicked,
  0 as unique_clicked,
  0 as linkedin_sent,
  0 as linkedin_accepted,
  0 as opportunities
from (
  select d.metric_date
    from daily_metrics d join campaigns c on c.id = d.campaign_id
   where c.source = 'instantly'
  union
  select e.metric_date from email_account_daily e where e.source = 'instantly'
) as dates;

grant select on v_daily_facts to anon, authenticated;
