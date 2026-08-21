-- ============================================================
-- The Responses column has to add up.
--
-- Six pages stopped reading `campaign_totals.replied` today and started asking
-- `response_counts` — one definition of "a person who answered", the one
-- 20260820120000 put in this database and /replies lists. The Overview said 33
-- in a tile and 41 in the table underneath it; both were honestly computed and
-- neither was the other's pile, which is F2 in TRUST.md and is the fault that
-- keeps coming back every time the rule lives somewhere a second reader cannot
-- get to.
--
-- The fix removed the second reader. This adds the two rules that say so if it
-- ever grows back, in the view /health already renders under "Things that must
-- never be true". Both return nothing today, and both can genuinely fail —
-- this view's own header refuses a green light that means nothing.
--
-- ---------------------------------------------------------------------------
-- Why these two and not "the tile equals its click"
--
-- The tile cannot disagree with its click any more: `response_counts` is
-- literally `count(*) filter (...)` over `response_people`, and the tile and
-- the list call them with the same four arguments. Asserting that would be
-- asserting that Postgres works.
--
-- What CAN fail is the grain. `response_people` groups by `lower(lead_email)`
-- and by nothing else — deliberately, because a human who writes twice is one
-- person and one of those messages can be an out-of-office. That is right for
-- a total and it means a per-group column is a different shape from the total
-- above it: a person who answers on two groups' campaigns is one row in the
-- total and one row in each of two columns.
--
-- Measured 21 Aug 2026, before either rule was written: 138 reply rows, 118
-- people, zero of whom appear on more than one campaign, and zero rows with a
-- null campaign_id. So the columns add up today. Nothing in the schema makes
-- that stay true — one referral forwarded into a second list is all it takes —
-- and the day it stops, the Overview goes back to a table that does not sum to
-- its own total, silently, which is exactly how the last one survived a month.
--
--   RESPONSES ADD UP        the per-group columns sum to the same people
--                           counted once over all grouped campaigns.
--   RESPONSE HAS A COLUMN   an answer on a campaign in no group is counted in
--                           the Overview total and in no row above it.
--
-- The second is the `meeting_belongs_to_no_rep` rule one branch up, in the
-- other half of the funnel: the same hole, entered through a campaign that
-- nobody grouped rather than a meeting nobody's rep owns.
--
-- ---------------------------------------------------------------------------
-- Why `not c.hidden` is written out here
--
-- `response_counts` is security invoker and leans on RLS to exclude hidden
-- campaigns — correct for the dashboard, which holds the anon role. This view
-- is not invoker (no reloptions, so it runs as its owner) and would therefore
-- see the 58 hidden reply rows the pages cannot. All 58 are lemlist robots and
-- contribute to neither side today, so this changes no number; it means the
-- rule keeps comparing what the pages compare tomorrow, when they might not be.
-- ============================================================

create or replace view v_invariants as

-- A bounce requires a send. Structural: the receiving server rejected something
-- we handed it.
select 'bounced_exceeds_sent'::text as rule,
       c.source, c.id as campaign_id, c.name as subject,
       format('%s bounced against %s sent, lifetime', t.bounced, t.sent) as detail,
       'high'::text as severity
from campaign_totals t join campaigns c on c.id = t.campaign_id
where t.bounced > t.sent

union all

select 'mailbox_bounced_exceeds_sent'::text as rule,
       e.source, null::uuid as campaign_id, e.email as subject,
       format('%s bounced against %s sent on %s', e.bounced, e.sent,
              to_char(e.metric_date::timestamp with time zone, 'DD Mon')) as detail,
       'high'::text as severity
from email_account_daily e
where e.bounced > e.sent

union all

select 'negative_metric'::text as rule,
       c.source, c.id as campaign_id, c.name as subject,
       format('lifetime: sent %s, delivered %s, bounced %s, opened %s, replied %s, clicked %s',
              t.sent, t.delivered, t.bounced, t.opened, t.replied, t.clicked) as detail,
       'high'::text as severity
from campaign_totals t join campaigns c on c.id = t.campaign_id
where least(t.sent, t.delivered, t.bounced, t.opened, t.replied, t.clicked, t.leads, t.contacted) < 0

union all

select 'negative_metric_daily'::text as rule,
       c.source, c.id as campaign_id, c.name as subject,
       format('%s: sent %s, bounced %s, opened %s, replied %s, clicked %s',
              to_char(d.metric_date::timestamp with time zone, 'DD Mon'),
              d.sent, d.bounced, d.opened, d.replied, d.clicked) as detail,
       'high'::text as severity
from daily_metrics d join campaigns c on c.id = d.campaign_id
where least(d.sent, coalesce(d.bounced, 0), d.opened, d.replied, d.clicked) < 0

union all

select 'sent_but_no_lifetime_row'::text as rule,
       c.source, c.id as campaign_id, c.name as subject,
       format('%s sent across %s days, and no campaign_totals row', sum(d.sent), count(*)) as detail,
       'high'::text as severity
from campaigns c
  join daily_metrics d on d.campaign_id = c.id
  left join campaign_totals t on t.campaign_id = c.id
where t.campaign_id is null
group by c.source, c.id, c.name
having sum(d.sent) > 0

union all

-- PARTITION. A counted meeting whose rep is nobody on the roster is counted in
-- the all-reps total and in no rep's column, so the strip stops summing — the
-- 8-vs-9 that started the audit. The roster is campaign_groups.owner, which is
-- what repList() builds the strip from; there is no rep table.
select 'meeting_belongs_to_no_rep'::text as rule,
       null::text as source,
       r.campaign_id,
       coalesce(nullif(trim(r.prospect_name), ''), r.prospect_email, 'a meeting with no name') as subject,
       case when r.rep is null
         then format('%s: no group, no call and nobody recorded as having logged it, so it counts in the all-reps total and in nobody''s column',
                     to_char(r.meeting_date::timestamp with time zone, 'DD Mon'))
         else format('%s: resolved to "%s", who owns no campaign group, so it counts in the all-reps total and in nobody''s column',
                     to_char(r.meeting_date::timestamp with time zone, 'DD Mon'), r.rep)
       end as detail,
       'high'::text as severity
from meeting_rows(null, null, null, null, null, 'counted') r
where r.rep is null
   or not exists (select 1 from campaign_groups g where g.owner = r.rep)

union all

-- AGREEMENT. The group tile and its own drill-down are two expressions of one
-- rule, and this is the one that drifted: /campaigns/qea-resellers read 1 on
-- 20 Aug where the href under it opened 2.
select 'group_tile_disagrees_with_its_own_click'::text as rule,
       null::text as source,
       null::uuid as campaign_id,
       g.display_name as subject,
       format('the Meetings tile on /campaigns/%s reads %s and its own drill-down opens %s',
              g.slug, gs.meetings, x.rows_behind) as detail,
       'high'::text as severity
from campaign_groups g
  join v_group_summary gs on gs.id = g.id
  cross join lateral (
    select count(*) as rows_behind
    from meeting_rows(null, null,
      (select array_agg(mm.campaign_id) from campaign_group_members mm where mm.group_id = g.id),
      array[g.id], null, 'counted')
  ) x
where gs.meetings is distinct from x.rows_behind::numeric

union all

-- RESPONSES ADD UP. The Responses column on the Overview is `response_counts`
-- per group; the Total beside it is `response_counts` over everything. Those
-- are two shapes of one question and they agree only while no human has
-- answered inside two groups — `response_people` counts a person once, and a
-- person in two groups is one row in the total and one in each of two columns.
--
-- Both sides are restricted to campaigns that belong to a group, so an
-- ungrouped campaign is the other rule's business and not a permanent red
-- light here.
select 'response_column_does_not_sum'::text as rule,
       null::text as source,
       null::uuid as campaign_id,
       'the Responses column on the Overview'::text as subject,
       format('the group columns add to %s and the same people counted once are %s — somebody has answered inside two groups, so the column no longer sums to its own total',
              parts.n, whole.n) as detail,
       'high'::text as severity
from (
  select coalesce(sum(x.responded), 0)::int as n
  from campaign_groups g
  cross join lateral response_counts(null, null,
    array(select m.campaign_id
            from campaign_group_members m
            join campaigns c on c.id = m.campaign_id and not c.hidden
           where m.group_id = g.id), null) x
) parts
cross join lateral (
  select coalesce(x.responded, 0)::int as n
  from response_counts(null, null,
    array(select distinct m.campaign_id
            from campaign_group_members m
            join campaigns c on c.id = m.campaign_id and not c.hidden), null) x
) whole
where parts.n is distinct from whole.n

union all

-- RESPONSE HAS A COLUMN. The Overview total asks `response_counts` with no
-- campaign filter, so it counts everyone the anon key can see. Every row above
-- it is a group. A person who answered on a campaign nobody grouped is
-- therefore in the total and in no row — the same hole as a meeting whose rep
-- owns no group, entered from the campaign side.
select 'response_belongs_to_no_group'::text as rule,
       r.source,
       r.campaign_id,
       coalesce(nullif(trim(r.lead_name), ''), r.lead_email) as subject,
       format('answered on "%s", which is in no campaign group, so they count in the Overview total and in no row above it',
              coalesce(c.name, 'a campaign that is no longer on file')) as detail,
       'high'::text as severity
from replies r
  left join campaigns c on c.id = r.campaign_id
  left join campaign_group_members m on m.campaign_id = r.campaign_id
where m.campaign_id is null
  and coalesce(c.hidden, false) = false
  and r.sentiment in ('interested', 'not_interested', 'not_now', 'referral')
group by r.source, r.campaign_id,
         coalesce(nullif(trim(r.lead_name), ''), r.lead_email), c.name;
