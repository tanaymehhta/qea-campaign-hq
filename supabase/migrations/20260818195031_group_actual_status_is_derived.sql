-- "Live" stops being a word somebody typed once.
--
-- `campaign_groups.status` is hand-set at group creation and 20260730145549 says
-- outright it is "never touched again by the sync". So it records **intent** -
-- are we still investing in this - and it is allowed to be stale. What it cannot
-- do is answer "is anything inside actually running", which is what every reader
-- assumes it means.
--
-- This adds `actual_status`, derived on every read, and leaves `status` alone as
-- the typed intent.
--
-- ---------------------------------------------------------------------------
-- Why it takes TWO signals, not one. Each alone is measurably wrong today:
--
--   the vendor's `running` flag goes stale.  lber is marked `ended` by a human
--   and still has one campaign the vendor calls `running`. It last sent on
--   22 July, 27 days ago. The human is right and the flag is wrong; deriving
--   from the flag alone would have the dashboard start calling lber live.
--
--   recent sends do not mean more are coming.  `qea` sent 4 days ago and has
--   **zero** running campaigns. Nothing further can go out. Deriving from
--   activity alone would call it live.
--
-- So `live` requires both: a campaign the vendor still calls running, AND a send
-- inside the window. Either signal failing is enough to say the group is done.
--
-- ---------------------------------------------------------------------------
-- The window is 14 days, and it is the one tunable number here. Measured across
-- every group's send history: the largest gap between consecutive sending days
-- while a group was genuinely active is **7 days** (lber), and no group has ever
-- had a gap longer than 7. Fourteen is double the observed maximum, which leaves
-- room for a holiday week without a group flickering between states. Sending is
-- weekdays-only, so this is roughly two working weeks.
--
-- Widen it if a group ever legitimately pauses longer than a fortnight; it is a
-- calibration knob, not a law.
--
-- Checked against all six groups: chicago-retrofit live, qea-resellers live,
-- roof live, lber ended, qea ended, ungrouped planned. All six match what a
-- person familiar with them says they are.
--
-- ---------------------------------------------------------------------------
-- `platform` also changes, and NOT the way PLAN.md proposed. PLAN says derive it
-- from campaigns.source. Measured: lber's typed platform is
-- {lemlist, hubspot} while its only campaign source is lemlist. The `hubspot`
-- entry is human knowledge that no campaign row can reproduce, and deriving
-- would silently delete it. So the typed value wins where one exists, and the
-- derived value fills in only where it is blank - which fixes the actual
-- complaint (a blank platform draws Instantly campaigns in the lemlist colour,
-- app/campaigns/page.jsx:43) without destroying anything a person entered.
--
-- v_group_status_drift is dropped rather than replaced: `actual_status` belongs
-- near the front of its column list, and create-or-replace cannot insert a
-- column. Only /health reads it.
drop view if exists v_group_status_drift;

create or replace view v_group_summary as
 SELECT g.id,
    g.slug,
    g.display_name,
    g.vault_name,
    g.status,
    g.owner,
    -- typed value wins; derived fills a blank. See the header.
    CASE
        WHEN g.platform IS NULL OR cardinality(g.platform) = 0
        THEN ( SELECT array_agg(DISTINCT c.source ORDER BY c.source)
                 FROM campaign_group_members m2
                 JOIN campaigns c ON c.id = m2.campaign_id
                WHERE m2.group_id = g.id )
        ELSE g.platform
    END AS platform,
    g.geography,
    g.segment,
    g.list_source,
    g.sequence_shape,
    g.started_on,
    g.description,
    count(s.campaign_id) AS campaign_count,
    count(*) FILTER (WHERE (s.status = 'running'::text)) AS running_count,
    count(*) FILTER (WHERE (s.status = 'paused'::text)) AS paused_count,
    count(*) FILTER (WHERE (s.status = 'draft'::text)) AS draft_count,
    COALESCE(sum(s.leads), (0)::bigint) AS leads,
    COALESCE(sum(s.sent), (0)::bigint) AS sent,
    COALESCE(sum(s.delivered), (0)::bigint) AS delivered,
    COALESCE(sum(s.bounced), (0)::bigint) AS bounced,
    COALESCE(sum(s.opened), (0)::bigint) AS opened,
    COALESCE(sum(s.replied), (0)::bigint) AS replied,
    COALESCE(sum(s.linkedin_accepted), (0)::bigint) AS linkedin_accepted,
    COALESCE(sum(s.meetings), (0)::numeric) AS meetings,
    COALESCE(sum(s.positive_replies), (0)::numeric) AS positive_replies,
    COALESCE(sum(s.proposals), (0)::numeric) AS proposals,
    dates.first_sent_on,
    dates.last_sent_on,
    -- Derived every read, so it cannot be stale. Both signals must agree.
    CASE
        WHEN count(*) FILTER (WHERE (s.status = 'running'::text)) > 0
         AND dates.last_sent_on >= (current_date - 14) THEN 'live'
        WHEN COALESCE(sum(s.sent), (0)::bigint) > 0     THEN 'ended'
        ELSE 'planned'
    END AS actual_status
   FROM ((campaign_groups g
     LEFT JOIN v_campaign_summary s ON ((s.group_id = g.id)))
     LEFT JOIN ( SELECT m.group_id,
            min(d.metric_date) FILTER (WHERE (d.sent > 0)) AS first_sent_on,
            max(d.metric_date) FILTER (WHERE (d.sent > 0)) AS last_sent_on
           FROM (daily_metrics d
             JOIN campaign_group_members m ON ((m.campaign_id = d.campaign_id)))
          GROUP BY m.group_id) dates ON ((dates.group_id = g.id)))
  GROUP BY g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform,
           g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on,
           g.description, dates.first_sent_on, dates.last_sent_on;

-- The canary, now firing in both directions.
--
-- The old one fired only on a group marked `planned` or `abandoned` that was
-- sending, and never on the far more common opposite: a group marked `live` that
-- quietly finished. `qea` has been that case for days - typed `live`, zero
-- campaigns running, last send 14 August - and the check read all-clear.
--
-- Note what deliberately does NOT fire: lber, typed `ended` with one campaign
-- the vendor still calls running. Derived `actual_status` agrees it has ended,
-- because it has not sent in 27 days. The human was right; a one-signal rule
-- would have reported them as disagreeing and sent someone to "fix" a correct
-- label.
create view v_group_status_drift as
select g.id, g.slug, g.display_name,
       g.status        as stored_status,
       v.actual_status,
       v.running_count, v.campaign_count, v.first_sent_on, v.last_sent_on, v.sent,
       case
         when g.status in ('live', 'planned') and v.actual_status = 'ended'
           then 'labelled ' || g.status || ', but nothing is running and it has not sent in over a fortnight'
         else 'labelled ' || g.status || ', but it is still sending'
       end as detail
from campaign_groups g
join v_group_summary v on v.id = g.id
where (g.status in ('live', 'planned')     and v.actual_status = 'ended')
   or (g.status in ('ended', 'abandoned')  and v.actual_status = 'live');

grant select on v_group_summary to anon, authenticated;
grant select on v_group_status_drift to anon, authenticated;
