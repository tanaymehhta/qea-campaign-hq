-- ============================================================
-- Reporting views
-- ============================================================

create or replace view v_campaign_summary as
select
  c.id                as campaign_id,
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
  g.id                as group_id,
  g.slug              as group_slug,
  g.display_name      as group_name,
  m.sub_campaign_label,
  m.assignment_source,
  coalesce(t.leads,0)             as leads,
  coalesce(t.reached,0)           as reached,
  coalesce(t.contacted,0)         as contacted,
  coalesce(t.sent,0)              as sent,
  coalesce(t.delivered,0)         as delivered,
  coalesce(t.bounced,0)           as bounced,
  coalesce(t.opened,0)            as opened,
  coalesce(t.replied,0)           as replied,
  coalesce(t.clicked,0)           as clicked,
  coalesce(t.linkedin_accepted,0) as linkedin_accepted,
  coalesce(t.unsubscribed,0)      as unsubscribed,
  -- rates, computed the way the Vault computes them
  case when coalesce(t.sent,0)  > 0 then round(100.0*t.bounced/t.sent, 1)  end as bounce_pct_of_sent,
  case when coalesce(t.contacted,0) > 0 then round(100.0*t.bounced/t.contacted, 1) end as bounce_pct_of_contacted,
  case when coalesce(t.leads,0) > 0 then round(100.0*t.replied/t.leads, 1) end as reply_pct_of_leads,
  (select count(*) from meetings mt where mt.campaign_id = c.id and mt.status in ('booked','held')) as meetings,
  (select count(*) from replies r where r.campaign_id = c.id and r.sentiment = 'interested')        as positive_replies,
  c.last_synced
from campaigns c
left join campaign_group_members m on m.campaign_id = c.id
left join campaign_groups g        on g.id = m.group_id
left join campaign_totals t        on t.campaign_id = c.id;

create or replace view v_group_daily as
select
  g.id   as group_id,
  g.slug as group_slug,
  c.source,
  d.metric_date,
  sum(d.sent)                as sent,
  sum(d.contacted)           as contacted,
  sum(d.new_leads_contacted) as new_leads_contacted,
  sum(d.delivered)           as delivered,
  sum(d.bounced)             as bounced,
  sum(d.opened)              as opened,
  sum(d.replied)             as replied,
  sum(d.replies_automatic)   as replies_automatic,
  sum(d.clicked)             as clicked,
  sum(d.linkedin_sent)       as linkedin_sent,
  sum(d.linkedin_accepted)   as linkedin_accepted
from daily_metrics d
join campaigns c on c.id = d.campaign_id
left join campaign_group_members m on m.campaign_id = c.id
left join campaign_groups g on g.id = m.group_id
group by g.id, g.slug, c.source, d.metric_date;

create or replace view v_daily_totals as
select
  d.metric_date,
  c.source,
  sum(d.sent)                as sent,
  sum(d.new_leads_contacted) as new_leads_contacted,
  sum(d.bounced)             as bounced,
  sum(d.opened)              as opened,
  sum(d.replied)             as replied,
  sum(d.linkedin_accepted)   as linkedin_accepted
from daily_metrics d
join campaigns c on c.id = d.campaign_id
group by d.metric_date, c.source;

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
  coalesce(sum(s.positive_replies),0) as positive_replies
from campaign_groups g
left join v_campaign_summary s on s.group_id = g.id
group by g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform,
         g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description;

-- ============================================================
-- RLS — public site, read-only for anon. Writes are service_role only.
-- ============================================================

alter table campaign_groups        enable row level security;
alter table campaigns              enable row level security;
alter table campaign_group_members enable row level security;
alter table daily_metrics          enable row level security;
alter table campaign_totals        enable row level security;
alter table template_versions      enable row level security;
alter table step_metrics           enable row level security;
alter table replies                enable row level security;
alter table meetings               enable row level security;
alter table events                 enable row level security;
alter table sync_runs              enable row level security;
alter table email_accounts         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['campaign_groups','campaigns','campaign_group_members','daily_metrics',
                           'campaign_totals','template_versions','step_metrics','replies',
                           'meetings','events','sync_runs','email_accounts']
  loop
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;;