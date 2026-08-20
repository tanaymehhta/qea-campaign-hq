-- ============================================================
-- The six decisions, and the gate that keeps them.
--
-- Two things, written together because the second is what stops the first from
-- being re-argued: the record of what was settled about meetings, and the two
-- checks that report the moment it stops being true.
--
-- ---------------------------------------------------------------------------
-- PART 1 · The six decisions. All settled by Tanay, 20 August 2026.
--
-- They were put to him after the audit of that evening, three of them because
-- they change the shape of the work (0.1, 0.3, 0.6) and three taken as
-- recommended. They live in MEETINGS_PLAN.md as well; they are repeated here
-- because a plan document is a thing somebody decides to read and a migration
-- header is a thing somebody trips over while asking why the schema is like
-- this. Six phases were built on these. None of them is open.
--
-- 0.1 · Cancel only, or cancel AND remove?          TWO VERBS.
--
--   status 'cancelled' means it was a real meeting and it came off. It stays
--   visible and stops counting. `deleted_at` means it was never a meeting — a
--   typo, a double-log, a misclick: out of every count and every list, row kept
--   because a row is evidence.
--
--   The codebase had one stance before this (migration 20260818201145: cancel,
--   never delete), which is right for the first case and has no answer for the
--   second. Without the second verb there is no exit from a duplicate and the
--   primary KPI stays wrong permanently. Built in 20260820195224.
--
-- 0.2 · Who owns a call-created meeting's fields?   THE CALL.
--
--   `edit_meeting` and `remove_meeting` refuse on origin = 'call' and say where
--   to go instead — "this meeting came from a call on 4 Aug; change it there".
--   `edit_call` already keeps a linked meeting in step in both directions and
--   `delete_call` cancels it. A second editor would reopen the
--   two-tiles-that-disagree-forever problem 20260818201145 was written to close,
--   and would let an edit to a call quietly resurrect a meeting somebody had
--   deliberately taken off the board.
--
--   `set_meeting_status` is deliberately exempt: marking a meeting held is
--   useful whichever door it came through, and edit_call preserves any status
--   that is not 'cancelled', so the two cannot fight.
--
-- 0.3 · Campaign pages and group-scoped meetings?   GROUP TILE YES,
--                                                   SUB-CAMPAIGN ROWS NO.
--
--   The hand form sets group_id and never campaign_id, so a group-scoped
--   meeting was invisible to both summaries: group totals summed to 3 while the
--   Overview said 5, and Krishnan Gowri appeared in neither. `v_group_summary`
--   now counts a group's own meetings as well as its campaigns'.
--   `v_campaign_summary` deliberately does not: a sub-campaign row means
--   "meetings attributed to this sub-campaign" and a group meeting genuinely is
--   not one.
--
--   The accepted cost: the Meetings column on /campaigns/[slug] legitimately
--   adds up to less than the group tile above it, and the page says so in a
--   line that only appears when there is something to explain. The person
--   lookup in 20260820211929 narrows that gap from the other end, by resolving
--   a campaign from the prospect's email where there is one.
--
-- 0.4 · booked_on — ask or infer?                   ASK, DEFAULTED TO TODAY.
--
--   Null is refused by log_meeting rather than quietly filled with
--   current_date. Inferring the day a meeting was agreed from created_at is a
--   guess, and this table is the one thing on the dashboard that no tool
--   records — a guess in it is worse than a gap. Jeffrey Hohenstein's two rows
--   were both typed on 30 July, one of them for a meeting that had already
--   happened on the 22nd.
--
--   The four rows logged before the column existed keep booked_on = null and
--   the coalesce(booked_on, meeting_date) fallback forever. Null means "not
--   known", which is true.
--
-- 0.5 · Held / no-show?                             FOUR STATES, MOVABLE ANY
--                                                   TIME.
--
--   booked · held · no_show · cancelled, on a control on every row, changeable
--   in either direction. Counted stays booked + held. Before this, nothing in
--   the product could set either: `held` read on two rows only because somebody
--   had a psql prompt, which made "booked or held" a distinction with no live
--   mechanism behind it.
--
-- 0.6 · Person linking?                             FULL.
--
--   A pre-filled "Log a meeting" button on /replies and /person/[email], and an
--   email that matches somebody in `people` resolves the campaign as well. It
--   is the only part of this work that is new product rather than repair, and
--   it is the part that stops duplicates being made: retyping a name from a
--   reply into the meetings form is exactly how the audit's three-rows-for-one-
--   conversation happened.
--
-- ---------------------------------------------------------------------------
-- PART 2 · The gate, as a row on /health.
--
-- `scripts/meetings-parity.mjs` walks every scope the interface can produce —
-- 3 reps × 5 groups × 35 sub-campaigns × 5 windows, 230 checks — and asserts
-- three things. It is the regression test for all six phases and it passes.
-- But it only runs when somebody runs it, and the faults it was written for
-- were all found by hand, weeks after they started.
--
-- Two of its three invariants become rows here, in the view /health already
-- renders under "Things that must never be true". Both return nothing today.
--
--   PARTITION   per-rep totals sum to the all-reps total.
--
--     Since 20260820194551 the rep is resolved once inside meeting_rows and
--     scoped on, so the sum holds by construction — with one hole. If a
--     meeting resolves to a name that owns no campaign group, the rep strip is
--     built from group owners and has no column to put it in: the all-reps
--     total counts it and nobody's column does. That is the 8-vs-9 that started
--     the audit, and it happened again in testing on 20 Aug when a row was
--     logged by "Justin Levine" while the owner on file is "Justin". The
--     free-text "Logged by" box is one keystroke from it, which is why it now
--     offers a datalist — and why this rule is worth a row rather than trust.
--
--   AGREEMENT   v_group_summary.meetings equals meeting_rows for that group.
--
--     The summary is a hand-written correlated subquery, chosen for speed over
--     calling the function once per group inside a grouped view. Two
--     expressions of one rule is exactly the shape that drifts — it is the
--     shape the whole audit was about — so the second rule asserts they agree,
--     which is what the parity script's third invariant does.
--
-- The script's other invariant, TILE=CLICK, is not here: meeting_counts is
-- literally count(*) over meeting_rows with the same arguments, so it cannot
-- disagree without the database being broken. A rule that cannot fail is a
-- green light that means nothing, and this view's own header refuses those.
--
-- Both rules are cheap — the second calls meeting_rows once per group, five
-- times, over seven rows — and this view is read by one page.
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
where gs.meetings is distinct from x.rows_behind::numeric;

comment on view v_invariants is
  'Statements that must never be true, kept to the ones that are actually true —
   a rule that only looked sound was left out, because a panel that is always red
   is a panel nobody reads. The last two are the meetings parity gate
   (scripts/meetings-parity.mjs) made continuous: per-rep totals sum to the
   all-reps total, and the group tile agrees with its own click.';
