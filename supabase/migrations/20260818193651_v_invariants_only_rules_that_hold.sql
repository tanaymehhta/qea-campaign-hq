-- Statements that must never be true, kept to the ones that are actually true.
--
-- PLAN.md proposed four: bounced <= sent, opened <= sent, clicked <= sent, and
-- delivered = sent - bounced. Each was tested against live data before being
-- written down, and the result changed the list.
--
-- **At campaign-day grain they are false-positive machines.** Counted 18 Aug:
--
--   daily opened  > sent    11 rows
--   daily replied > sent     3 rows
--   daily bounced > sent     1 row
--   daily clicked > sent     0 rows
--
-- None of those is a fault. An open is dated when it happens and the send that
-- earned it was days earlier, so any per-day comparison of an outcome against a
-- send is comparing two different cohorts. Shipping those four at daily grain
-- would have put fifteen permanent red rows on /health on the first afternoon,
-- and a panel that is always red is a panel nobody reads - the same failure as
-- v_metric_drift's permanent green, arrived at from the other direction.
--
-- **At lifetime grain, opened/clicked/replied still are not sound.** They hold
-- today, on all 42 campaigns. But `opened` counts opens, not openers - Instantly
-- keeps `unique_opened` as a separate column precisely because one person can
-- open six times. A campaign with 100 sent and 150 opens is ordinary and would
-- trip a rule that was only ever incidentally true. Left out.
--
-- **delivered = sent - bounced is gone because it is no longer a comparison.**
-- 20260818… made v_campaign_summary derive it, so there are not two copies to
-- disagree. An invariant over a formula checks arithmetic, not data.
--
-- What survives is the set that cannot be violated without something being
-- genuinely wrong: an outcome that requires a send, and a number below zero.
-- All of them return nothing today, which is what makes a row here worth
-- reading.
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

-- The same rule one level down, where the dated Instantly bounce actually comes
-- from. If this fires, the overlay feeding the Overview is built on bad input.
select 'mailbox_bounced_exceeds_sent',
       e.source, null::uuid, e.email,
       format('%s bounced against %s sent on %s', e.bounced, e.sent, to_char(e.metric_date, 'DD Mon')),
       'high'
from email_account_daily e
where e.bounced > e.sent

union all

-- No metric is ever negative. Nothing should be able to write one; this is the
-- check that says so out loud rather than trusting it.
select 'negative_metric',
       c.source, c.id, c.name,
       format('lifetime: sent %s, delivered %s, bounced %s, opened %s, replied %s, clicked %s',
              t.sent, t.delivered, t.bounced, t.opened, t.replied, t.clicked),
       'high'
from campaign_totals t join campaigns c on c.id = t.campaign_id
where least(t.sent, t.delivered, t.bounced, t.opened, t.replied, t.clicked,
            t.leads, t.contacted) < 0

union all

select 'negative_metric_daily',
       c.source, c.id, c.name,
       format('%s: sent %s, bounced %s, opened %s, replied %s, clicked %s',
              to_char(d.metric_date, 'DD Mon'), d.sent, d.bounced, d.opened, d.replied, d.clicked),
       'high'
from daily_metrics d join campaigns c on c.id = d.campaign_id
where least(d.sent, coalesce(d.bounced, 0), d.opened, d.replied, d.clicked) < 0

union all

-- A campaign that has demonstrably sent, with no lifetime row at all. This is
-- TRUST.md F5: syncLemlist swallows the error for a campaign with no sequence,
-- so it never gets a campaign_totals row, and refresh_lemlist_totals is an
-- UPDATE ... FROM which cannot create one. That campaign would be missing from
-- /campaigns permanently and nothing would say so. Zero today - the one campaign
-- without a totals row has never sent.
select 'sent_but_no_lifetime_row',
       c.source, c.id, c.name,
       format('%s sent across %s days, and no campaign_totals row', sum(d.sent), count(*)),
       'high'
from campaigns c
join daily_metrics d on d.campaign_id = c.id
left join campaign_totals t on t.campaign_id = c.id
where t.campaign_id is null
group by c.source, c.id, c.name
having sum(d.sent) > 0;

grant select on v_invariants to anon, authenticated;
