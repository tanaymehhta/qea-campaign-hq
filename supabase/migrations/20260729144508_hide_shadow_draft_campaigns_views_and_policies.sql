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
    COALESCE(t.delivered, 0) AS delivered,
    COALESCE(t.bounced, 0) AS bounced,
    COALESCE(t.opened, 0) AS opened,
    COALESCE(t.replied, 0) AS replied,
    COALESCE(t.clicked, 0) AS clicked,
    COALESCE(t.linkedin_accepted, 0) AS linkedin_accepted,
    COALESCE(t.unsubscribed, 0) AS unsubscribed,
        CASE
            WHEN (COALESCE(t.sent, 0) > 0) THEN round(((100.0 * (t.bounced)::numeric) / (t.sent)::numeric), 1)
            ELSE NULL::numeric
        END AS bounce_pct_of_sent,
        CASE
            WHEN (COALESCE(t.contacted, 0) > 0) THEN round(((100.0 * (t.bounced)::numeric) / (t.contacted)::numeric), 1)
            ELSE NULL::numeric
        END AS bounce_pct_of_contacted,
        CASE
            WHEN (COALESCE(t.leads, 0) > 0) THEN round(((100.0 * (t.replied)::numeric) / (t.leads)::numeric), 1)
            ELSE NULL::numeric
        END AS reply_pct_of_leads,
    ( SELECT count(*) AS count
           FROM meetings mt
          WHERE ((mt.campaign_id = c.id) AND (mt.status = ANY (ARRAY['booked'::text, 'held'::text])))) AS meetings,
    ( SELECT count(*) AS count
           FROM replies r
          WHERE ((r.campaign_id = c.id) AND (r.sentiment = 'interested'::text))) AS positive_replies,
    c.last_synced,
    ( SELECT count(*) AS count
           FROM proposals p
          WHERE (p.campaign_id = c.id)) AS proposals
   FROM (((campaigns c
     LEFT JOIN campaign_group_members m ON ((m.campaign_id = c.id)))
     LEFT JOIN campaign_groups g ON ((g.id = m.group_id)))
     LEFT JOIN campaign_totals t ON ((t.campaign_id = c.id)))
  WHERE NOT c.hidden;

create or replace view v_daily_totals as
 SELECT d.metric_date,
    c.source,
    sum(d.sent) AS sent,
    sum(d.new_leads_contacted) AS new_leads_contacted,
    sum(d.bounced) AS bounced,
    sum(d.opened) AS opened,
    sum(d.replied) AS replied,
    sum(d.linkedin_accepted) AS linkedin_accepted
   FROM (daily_metrics d
     JOIN campaigns c ON ((c.id = d.campaign_id)))
  WHERE NOT c.hidden
  GROUP BY d.metric_date, c.source;

create or replace view v_group_daily as
 SELECT g.id AS group_id,
    g.slug AS group_slug,
    c.source,
    d.metric_date,
    sum(d.sent) AS sent,
    sum(d.contacted) AS contacted,
    sum(d.new_leads_contacted) AS new_leads_contacted,
    sum(d.delivered) AS delivered,
    sum(d.bounced) AS bounced,
    sum(d.opened) AS opened,
    sum(d.replied) AS replied,
    sum(d.replies_automatic) AS replies_automatic,
    sum(d.clicked) AS clicked,
    sum(d.linkedin_sent) AS linkedin_sent,
    sum(d.linkedin_accepted) AS linkedin_accepted
   FROM (((daily_metrics d
     JOIN campaigns c ON ((c.id = d.campaign_id)))
     LEFT JOIN campaign_group_members m ON ((m.campaign_id = c.id)))
     LEFT JOIN campaign_groups g ON ((g.id = m.group_id)))
  WHERE NOT c.hidden
  GROUP BY g.id, g.slug, c.source, d.metric_date;

create or replace function is_hidden_campaign(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from campaigns where id = cid and hidden) $$;

revoke all on function is_hidden_campaign(uuid) from public;
grant execute on function is_hidden_campaign(uuid) to anon, authenticated;

drop policy if exists "public read" on campaigns;
create policy "public read" on campaigns for select
  to anon, authenticated using (not hidden);

drop policy if exists "public read" on campaign_group_members;
create policy "public read" on campaign_group_members for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));

drop policy if exists "public read" on people;
create policy "public read" on people for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));

drop policy if exists "public read" on activities;
create policy "public read" on activities for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));

drop policy if exists "public read" on replies;
create policy "public read" on replies for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));

drop policy if exists "public read" on daily_metrics;
create policy "public read" on daily_metrics for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));

drop policy if exists "public read" on meetings;
create policy "public read" on meetings for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));

drop policy if exists "public read" on proposals;
create policy "public read" on proposals for select
  to anon, authenticated using (not is_hidden_campaign(campaign_id));
