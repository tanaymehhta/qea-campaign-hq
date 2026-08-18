-- ============================================================
-- Conflicts: everywhere the tools contradict themselves or leave
-- a gap only a person can close.
--
-- Deliberately a view, not a table. A conflict is a fact about the
-- current data, so it appears when the data disagrees and disappears
-- the moment it agrees. Nothing to mark resolved, nothing to go stale.
-- ============================================================

-- Instantly reports, per campaign per day, how many inbound were genuine
-- replies and how many were auto-replies. We import the messages themselves
-- and label them. When our labelling and its count disagree, the split is
-- guesswork and a human should settle it.
create or replace view v_reply_conflicts as
with ours as (
  select r.campaign_id,
         (r.received_at at time zone 'America/New_York')::date as day,
         count(*)                                              as msgs,
         count(*) filter (where r.sentiment = 'auto_reply')     as ours_auto,
         count(*) filter (where r.sentiment <> 'auto_reply')    as ours_real,
         count(*) filter (where r.classified_by = 'human')      as confirmed
  from replies r
  where r.source = 'instantly'
  group by 1, 2
),
theirs as (
  select dm.campaign_id, dm.metric_date as day,
         dm.replied as their_real, dm.replies_automatic as their_auto
  from daily_metrics dm
  join campaigns c on c.id = dm.campaign_id and c.source = 'instantly'
)
select o.campaign_id, o.day, o.msgs, o.ours_real, o.ours_auto,
       t.their_real, t.their_auto, o.confirmed,
       t.their_real - o.ours_real as real_gap
from ours o
join theirs t on t.campaign_id = o.campaign_id and t.day = o.day
where o.ours_real <> t.their_real or o.ours_auto <> t.their_auto;

-- Every open question in one shape, so the page is a single query.
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
where coalesce(nullif(trim(m.prospect_name), ''), null) is null;

-- ------------------------------------------------------------------
-- Write path.
--
-- The dashboard has no login, so these are the only two things a visitor
-- can change, and each is validated here rather than trusted from the
-- client: a whitelisted label on a reply that already exists, and the
-- details of a meeting that already exists. No insert, no delete, no
-- other table. Every change stamps who and when, and the sync never
-- overwrites a row a human has touched.
-- ------------------------------------------------------------------

create or replace function public.classify_reply(p_reply uuid, p_sentiment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sentiment not in ('interested','referral','not_now','not_interested','auto_reply','unclassified') then
    raise exception 'not a valid sentiment: %', p_sentiment;
  end if;
  update replies
     set sentiment     = p_sentiment,
         classified_by = 'human',
         classified_at = now()
   where id = p_reply;
  if not found then
    raise exception 'no reply with id %', p_reply;
  end if;
end $$;

create or replace function public.record_meeting_detail(
  p_meeting uuid, p_name text, p_company text, p_email text, p_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update meetings
     set prospect_name  = coalesce(nullif(trim(p_name), ''), prospect_name),
         company        = coalesce(nullif(trim(p_company), ''), company),
         prospect_email = coalesce(nullif(trim(p_email), ''), prospect_email),
         note           = coalesce(nullif(trim(p_note), ''), note),
         logged_by      = 'dashboard'
   where id = p_meeting;
  if not found then
    raise exception 'no meeting with id %', p_meeting;
  end if;
end $$;

grant execute on function public.classify_reply(uuid, text)                    to anon, authenticated;
grant execute on function public.record_meeting_detail(uuid, text, text, text, text) to anon, authenticated;

grant select on v_conflicts, v_reply_conflicts to anon, authenticated;
