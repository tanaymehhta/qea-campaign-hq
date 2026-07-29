-- Hide the lemlist draft campaigns that only shadow the live ones.
--
-- Seven lemlist campaigns sit in draft with zero sends: two called
-- "QEA Resellers — Chicago", two called "QEA Resellers — Seattle", and one each
-- for Denver / Boulder, LA and LBER BEUDO Batch 2. The campaigns that actually
-- send are the "(Referral)" ones, which are running.
--
-- They hold nothing of their own. All 39 replies filed against them have a twin
-- filed against a live campaign at the same minute, and not one of their 24
-- people exists anywhere else but on a live campaign too. What they do is
-- inflate every total that sums across campaigns, and put two identically named
-- rows on a person's page.
--
-- Deleting the rows would not hold: syncLemlist upserts every campaign lemlist
-- lists, keyed on (source, source_campaign_id), so they would return within the
-- half hour. A flag survives, because the upsert names its columns and this is
-- not one of them.

alter table campaigns
  add column if not exists hidden boolean not null default false;

comment on column campaigns.hidden is
  'Kept out of every view and every read. For a campaign that exists in the vendor '
  'but should not count here — today, the lemlist drafts that shadow a live campaign. '
  'The sync never writes this column, so it survives a re-sync.';

-- Keyed on the vendor id rather than ours: if a row is ever deleted and rebuilt,
-- its uuid changes and this does not.
update campaigns set hidden = true
where source = 'lemlist'
  and source_campaign_id in (
    'cam_mak6noLXasGrMTpfY',  -- QEA Resellers — Chicago (draft copy)
    'cam_YqqHe86NEJsnbhbWz',  -- QEA Resellers — Chicago (draft copy)
    'cam_3sT7qCgo3GDYB28Co',  -- QEA Resellers — Seattle (draft copy)
    'cam_iHeRBCDquqcBbiLef',  -- QEA Resellers — Seattle (draft copy)
    'cam_CX2grgf3mfjza7bMD',  -- QEA Resellers — Denver / Boulder (draft)
    'cam_EartWWzJJ29DRWzgN',  -- QEA Resellers — LA (Los Angeles) (draft)
    'cam_GCDsvacgYzyHHSvQ7'   -- LBER — BEUDO Batch 2 (Cambridge) (draft)
  );

-- --------------------------------------------------------------- the reads
--
-- Two levers, because the app reaches the data both ways. Views run as their
-- owner and so ignore row security, which is why the filter is written into
-- them by hand; every direct table read goes through RLS instead. Between the
-- two there is no query, present or future, that has to remember this.

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

-- v_group_summary reads v_campaign_summary, so it inherits the filter.

-- ----------------------------------------------------------------- the rows
--
-- The public key is select-only on every table; these policies narrow what
-- "select" means. The sync writes as the service role, which is not subject to
-- row security, so a hidden campaign still syncs — it simply is not read.

-- A plain subquery would not work here. Once campaigns has a policy hiding the
-- hidden rows, a subquery run by the same role cannot see them either, so
-- `not exists (… and c.hidden)` would be true for everything and filter nothing.
-- A security definer function reads the table as its owner, outside row
-- security, which is the only way to ask the question honestly.
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

-- The subquery runs per row, so give it the index it wants.
create index if not exists campaigns_hidden_idx on campaigns (id) where hidden;
