-- `delivered` becomes a formula on this side too, and one wrong number goes away.
--
-- v_daily_facts already derives it as sent - bounced. This view still read the
-- stored `campaign_totals.delivered`, so the two halves of the dashboard
-- computed the same word two different ways - which is the shape of every
-- problem in TRUST.md.
--
-- It was also wrong, by exactly the amount that shape predicts. Measured:
--
--   QEA Resellers — Chicago (Referral)   sent 328   bounced 17
--   stored delivered 313                 sent - bounced = 311
--
-- The cause, found in the data rather than guessed. refresh_lemlist_totals sums
-- the daily notebook, and refresh_lemlist_daily_metrics stores each day as
-- `greatest(sent - bounced, 0)` (20260730135341:47). On 25 July that campaign
-- recorded **0 sent and 2 bounced** - normal, because a bounce is dated when it
-- arrives and the send that caused it was days earlier. The clamp turned -2 into
-- 0, and the lifetime sum inherited the 2.
--
-- So per-day `delivered` is not a quantity that means anything: bounces lag
-- sends, and any per-day difference of the two is an artefact of that lag. Only
-- the lifetime figure is real, and only as a formula. That is the whole argument
-- for deriving rather than storing, demonstrated by the one campaign where the
-- stored copy drifted.
--
-- Both stored `delivered` columns - campaign_totals and daily_metrics - are
-- vestigial after this. Nothing in app/, lib/ or any view reads either. They are
-- left in place because refresh_lemlist_daily_metrics still writes them and
-- removing them is a separate change with no user-visible payoff.
--
-- Nothing else in this view is touched.
create or replace view v_campaign_summary as
 SELECT c.id AS campaign_id,
    c.source,
    c.source_campaign_id,
    c.name,
    c.vault_name,
    c.status,
    c.is_manual,
    c.daily_limit,
    c.open_tracking,
    c.link_tracking,
    c.text_only,
    c.started_on,
    g.id AS group_id,
    g.slug AS group_slug,
    g.display_name AS group_name,
    m.sub_campaign_label,
    m.assignment_source,
    COALESCE(t.leads, 0) AS leads,
    COALESCE(t.reached, 0) AS reached,
    COALESCE(t.contacted, 0) AS contacted,
    COALESCE(t.sent, 0) AS sent,
    -- derived, never read from storage: see the header
    COALESCE(t.sent, 0) - COALESCE(t.bounced, 0) AS delivered,
    COALESCE(t.bounced, 0) AS bounced,
    COALESCE(t.opened, 0) AS opened,
    COALESCE(t.replied, 0) AS replied,
    COALESCE(t.clicked, 0) AS clicked,
    COALESCE(t.linkedin_accepted, 0) AS linkedin_accepted,
    COALESCE(t.unsubscribed, 0) AS unsubscribed,
        CASE
            WHEN COALESCE(t.sent, 0) > 0 THEN round(100.0 * t.bounced::numeric / t.sent::numeric, 1)
            ELSE NULL::numeric
        END AS bounce_pct_of_sent,
        CASE
            WHEN COALESCE(t.contacted, 0) > 0 THEN round(100.0 * t.bounced::numeric / t.contacted::numeric, 1)
            ELSE NULL::numeric
        END AS bounce_pct_of_contacted,
        CASE
            WHEN COALESCE(t.leads, 0) > 0 THEN round(100.0 * t.replied::numeric / t.leads::numeric, 1)
            ELSE NULL::numeric
        END AS reply_pct_of_leads,
    ( SELECT count(*) AS count
           FROM meetings mt
          WHERE mt.campaign_id = c.id AND (mt.status = ANY (ARRAY['booked'::text, 'held'::text]))) AS meetings,
    ( SELECT count(*) AS count
           FROM replies r
          WHERE r.campaign_id = c.id AND r.sentiment = 'interested'::text) AS positive_replies,
    c.last_synced,
    ( SELECT count(*) AS count
           FROM proposals p
          WHERE p.campaign_id = c.id) AS proposals
   FROM campaigns c
     LEFT JOIN campaign_group_members m ON m.campaign_id = c.id
     LEFT JOIN campaign_groups g ON g.id = m.group_id
     LEFT JOIN campaign_totals t ON t.campaign_id = c.id
  WHERE NOT c.hidden;
