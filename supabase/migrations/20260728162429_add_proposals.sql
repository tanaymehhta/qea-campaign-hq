-- Proposals sent — manual, same shape as meetings. No tool tracks this.
create table proposals (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references campaigns(id) on delete set null,
  group_id      uuid references campaign_groups(id) on delete set null,
  prospect_name text,
  company       text,
  amount        numeric,
  sent_date     date not null default current_date,
  status        text not null default 'sent'
                check (status in ('sent','accepted','declined','expired')),
  logged_by     text,
  note          text,
  created_at    timestamptz not null default now()
);
alter table proposals enable row level security;
create policy "public read" on public.proposals for select to anon, authenticated using (true);
create index on proposals (campaign_id);
create index on proposals (group_id);
grant select on proposals to anon, authenticated;

-- "proposals" must be appended AFTER last_synced — CREATE OR REPLACE VIEW only
-- allows adding trailing columns, not inserting into the middle of the list.
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
  case when coalesce(t.sent,0)  > 0 then round(100.0*t.bounced/t.sent, 1)  end as bounce_pct_of_sent,
  case when coalesce(t.contacted,0) > 0 then round(100.0*t.bounced/t.contacted, 1) end as bounce_pct_of_contacted,
  case when coalesce(t.leads,0) > 0 then round(100.0*t.replied/t.leads, 1) end as reply_pct_of_leads,
  (select count(*) from meetings mt where mt.campaign_id = c.id and mt.status in ('booked','held')) as meetings,
  (select count(*) from replies r where r.campaign_id = c.id and r.sentiment = 'interested')        as positive_replies,
  c.last_synced,
  (select count(*) from proposals p where p.campaign_id = c.id)                                     as proposals
from campaigns c
left join campaign_group_members m on m.campaign_id = c.id
left join campaign_groups g        on g.id = m.group_id
left join campaign_totals t        on t.campaign_id = c.id;

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
  coalesce(sum(s.proposals),0) as proposals
from campaign_groups g
left join v_campaign_summary s on s.group_id = g.id
group by g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform,
         g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description;

alter view v_campaign_summary set (security_invoker = on);
alter view v_group_summary   set (security_invoker = on);
