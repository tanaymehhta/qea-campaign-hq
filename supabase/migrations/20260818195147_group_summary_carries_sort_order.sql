-- `sort_order` on the summary, so one read answers everything about a group.
--
-- repList() (lib/db.js) read campaign_groups directly, because sort_order was
-- the one field the summary did not carry. That left the Overview showing the
-- typed `status` while /campaigns showed the derived one - the two pages
-- disagreeing about a word again, which is the thing this whole exercise is
-- about. Appended rather than inserted, so create-or-replace accepts it.
--
-- This is the live definition of v_group_summary. 20260818195031 has the
-- reasoning for `actual_status` and for the `platform` fallback.
create or replace view v_group_summary as
 SELECT g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner,
    CASE
        WHEN g.platform IS NULL OR cardinality(g.platform) = 0
        THEN ( SELECT array_agg(DISTINCT c.source ORDER BY c.source)
                 FROM campaign_group_members m2
                 JOIN campaigns c ON c.id = m2.campaign_id
                WHERE m2.group_id = g.id )
        ELSE g.platform
    END AS platform,
    g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description,
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
    dates.first_sent_on, dates.last_sent_on,
    CASE
        WHEN count(*) FILTER (WHERE (s.status = 'running'::text)) > 0
         AND dates.last_sent_on >= (current_date - 14) THEN 'live'
        WHEN COALESCE(sum(s.sent), (0)::bigint) > 0     THEN 'ended'
        ELSE 'planned'
    END AS actual_status,
    g.sort_order
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
           g.description, g.sort_order, dates.first_sent_on, dates.last_sent_on;

grant select on v_group_summary to anon, authenticated;
