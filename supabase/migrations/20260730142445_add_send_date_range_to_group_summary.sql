create or replace view v_group_summary as
select
  g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform,
  g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description,
  count(s.campaign_id)                                              as campaign_count,
  count(*) filter (where s.status = 'running')                      as running_count,
  count(*) filter (where s.status = 'paused')                       as paused_count,
  count(*) filter (where s.status = 'draft')                        as draft_count,
  coalesce(sum(s.leads),0)     as leads,
  coalesce(sum(s.sent),0)      as sent,
  coalesce(sum(s.delivered),0) as delivered,
  coalesce(sum(s.bounced),0)   as bounced,
  coalesce(sum(s.opened),0)    as opened,
  coalesce(sum(s.replied),0)   as replied,
  coalesce(sum(s.linkedin_accepted),0) as linkedin_accepted,
  coalesce(sum(s.meetings),0)  as meetings,
  coalesce(sum(s.positive_replies),0) as positive_replies,
  coalesce(sum(s.proposals),0) as proposals,
  dates.first_sent_on, dates.last_sent_on
from campaign_groups g
left join v_campaign_summary s on s.group_id = g.id
left join (
  select m.group_id,
         min(d.metric_date) filter (where d.sent > 0) as first_sent_on,
         max(d.metric_date) filter (where d.sent > 0) as last_sent_on
  from daily_metrics d
  join campaign_group_members m on m.campaign_id = d.campaign_id
  group by m.group_id
) dates on dates.group_id = g.id
group by g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform,
         g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description,
         dates.first_sent_on, dates.last_sent_on;
