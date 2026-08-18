-- lemlist's /stats endpoint is window-sensitive and disagrees with itself across
-- windows. The activity stream is the authoritative event log, so for lemlist we
-- keep only leadTotal from /stats and derive every message metric from
-- daily_metrics. Instantly's own lifetime endpoint is authoritative and is left
-- alone.
create or replace function public.refresh_lemlist_totals()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  with agg as (
    select d.campaign_id,
           sum(d.sent)              as sent,
           sum(d.delivered)         as delivered,
           sum(d.bounced)           as bounced,
           sum(d.opened)            as opened,
           sum(d.clicked)           as clicked,
           sum(d.replied)           as replied,
           sum(d.linkedin_sent)     as linkedin_sent,
           sum(d.linkedin_accepted) as linkedin_accepted,
           sum(d.contacted)         as contacted
    from daily_metrics d
    join campaigns c on c.id = d.campaign_id
    where c.source = 'lemlist'
    group by d.campaign_id
  )
  update campaign_totals t
     set sent = a.sent, delivered = a.delivered, bounced = a.bounced,
         opened = a.opened, clicked = a.clicked, replied = a.replied,
         linkedin_sent = a.linkedin_sent, linkedin_accepted = a.linkedin_accepted,
         contacted = a.contacted, as_of = now()
    from agg a
   where t.campaign_id = a.campaign_id;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.refresh_lemlist_totals() to service_role;
