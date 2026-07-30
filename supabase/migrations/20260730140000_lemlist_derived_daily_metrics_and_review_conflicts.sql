-- lemlist's daily_metrics was built by a separate in-memory tally over the
-- same activity feed that also fills `activities`, computed from whatever a
-- single paginated pull happened to return. Two independent readings of one
-- feed can disagree (a page pulled while lemlist is writing new activity can
-- skip or reorder rows), and because the tally was additive, a bad reading
-- was never revisited once written. Concretely this produced an 11-person
-- "LinkedIn sent" count with zero matching people, and a bounce that existed
-- in activities but never made it into a day's tally.
--
-- Fix: stop tallying in application memory. Derive daily_metrics for lemlist
-- straight from activities with a SQL aggregate, so there is exactly one
-- writer of the truth and a mismatch is no longer representable — every
-- re-run recomputes the day fresh from whatever activities currently holds,
-- so a late-arriving row self-heals on the next sync instead of staying wrong
-- forever.
create or replace function public.refresh_lemlist_daily_metrics(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with agg as (
    select a.campaign_id, a.activity_date as metric_date,
      count(*) filter (where a.event_type = 'sent')            as sent,
      count(*) filter (where a.event_type = 'bounced')         as bounced,
      count(*) filter (where a.event_type = 'opened')          as opened,
      count(*) filter (where a.event_type = 'clicked')         as clicked,
      count(*) filter (where a.event_type = 'replied')         as replied,
      count(*) filter (where a.event_type = 'auto_reply')      as replies_automatic,
      count(*) filter (where a.event_type = 'linkedin_sent')     as linkedin_sent,
      count(*) filter (where a.event_type = 'linkedin_accepted') as linkedin_accepted
    from activities a
    join campaigns c on c.id = a.campaign_id
    where c.source = 'lemlist'
      and a.activity_date between p_from and p_to
    group by a.campaign_id, a.activity_date
  )
  insert into daily_metrics (
    campaign_id, metric_date, sent, contacted, delivered, bounced,
    opened, clicked, replied, replies_automatic, linkedin_sent, linkedin_accepted, pulled_at
  )
  select campaign_id, metric_date, sent, sent, greatest(sent - bounced, 0), bounced,
         opened, clicked, replied, replies_automatic, linkedin_sent, linkedin_accepted, now()
  from agg
  on conflict (campaign_id, metric_date) do update set
    sent = excluded.sent, contacted = excluded.contacted, delivered = excluded.delivered,
    bounced = excluded.bounced, opened = excluded.opened, clicked = excluded.clicked,
    replied = excluded.replied, replies_automatic = excluded.replies_automatic,
    linkedin_sent = excluded.linkedin_sent, linkedin_accepted = excluded.linkedin_accepted,
    pulled_at = excluded.pulled_at;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.refresh_lemlist_daily_metrics(date, date) from public, anon, authenticated;
grant execute on function public.refresh_lemlist_daily_metrics(date, date) to service_role;

-- A canary for the class of bug above, kept even though it should now always
-- be empty for lemlist: if a future change reintroduces a second writer, or
-- Instantly ever grows event-level data of its own, this is where drift would
-- show up again rather than sitting unnoticed for a week.
create or replace view v_metric_drift as
with agg as (
  select a.campaign_id, a.activity_date as metric_date,
    count(*) filter (where a.event_type = 'sent')            as sent,
    count(*) filter (where a.event_type = 'bounced')         as bounced,
    count(*) filter (where a.event_type = 'linkedin_sent')     as linkedin_sent,
    count(*) filter (where a.event_type = 'linkedin_accepted') as linkedin_accepted
  from activities a
  join campaigns c on c.id = a.campaign_id
  where c.source = 'lemlist'
  group by a.campaign_id, a.activity_date
)
select dm.campaign_id, c.name, dm.metric_date,
       dm.sent as dm_sent, coalesce(agg.sent,0) as act_sent,
       dm.bounced as dm_bounced, coalesce(agg.bounced,0) as act_bounced,
       dm.linkedin_sent as dm_linkedin_sent, coalesce(agg.linkedin_sent,0) as act_linkedin_sent,
       dm.linkedin_accepted as dm_linkedin_accepted, coalesce(agg.linkedin_accepted,0) as act_linkedin_accepted
from daily_metrics dm
join campaigns c on c.id = dm.campaign_id and c.source = 'lemlist'
left join agg on agg.campaign_id = dm.campaign_id and agg.metric_date = dm.metric_date
where dm.sent is distinct from coalesce(agg.sent,0)
   or dm.bounced is distinct from coalesce(agg.bounced,0)
   or dm.linkedin_sent is distinct from coalesce(agg.linkedin_sent,0)
   or dm.linkedin_accepted is distinct from coalesce(agg.linkedin_accepted,0);

grant select on v_metric_drift to anon, authenticated;

-- A reply nobody has ever looked at is exactly how a real meeting goes
-- unrecorded: it never trips the reply_split conflict (Instantly's own count
-- can already agree with ours) and never gets classified, so it never turns
-- into a meeting or a "not interested" and just sits. Surface it after 48h.
create or replace view v_conflicts as
select
  'reply_split'::text                       as kind,
  c.campaign_id                             as campaign_id,
  c.day                                     as conflict_date,
  null::uuid                                as subject_id,
  format('%s inbound on %s — Instantly counts %s real / %s auto, we read %s / %s',
         c.msgs, to_char(c.day, 'DD Mon'), c.their_real, c.their_auto,
         c.ours_real, c.ours_auto)          as title,
  'Confirm each message below and the difference resolves itself.'::text as detail,
  c.msgs                                    as items
from v_reply_conflicts c
union all
select
  'meeting_detail', m.campaign_id, m.meeting_date, m.id,
  format('Meeting on %s has no name recorded', to_char(m.meeting_date, 'DD Mon')),
  'Logged by hand with the prospect left blank. Only you know who this was.',
  1
from meetings m
where coalesce(nullif(trim(m.prospect_name), ''), null) is null
union all
select
  'needs_review', r.campaign_id, (r.received_at at time zone 'America/New_York')::date, r.id,
  format('%s replied and nobody has read it yet',
         coalesce(nullif(trim(r.lead_name), ''), r.lead_email, 'Someone')),
  'Unclassified for over 48 hours. Read it, classify it — and if it is a booked call, log the meeting.',
  1
from replies r
where r.sentiment = 'unclassified'
  and r.received_at < now() - interval '48 hours';

grant select on v_conflicts to anon, authenticated;
