-- Rebuild lemlist's per-person counters from the cumulative activity log.
-- The sync cannot accumulate these in-loop: an incremental run only sees a
-- two-day window, so upserting from it would overwrite a lifetime count.
create or replace function public.refresh_lemlist_people()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with agg as (
    select
      campaign_id,
      lower(email) as email_key,
      min(email)                                              as email,
      max(name)     filter (where name is not null)           as name,
      max(company)  filter (where company is not null)        as company,
      count(*)      filter (where event_type = 'sent')        as sent_count,
      count(*)      filter (where event_type = 'opened')      as opened_count,
      count(*)      filter (where event_type = 'clicked')     as clicked_count,
      count(*)      filter (where event_type in ('replied','auto_reply')) as replied_count,
      bool_or(event_type = 'bounced')                         as bounced,
      min(occurred_at) filter (where event_type = 'sent')     as first_contacted_at,
      max(occurred_at) filter (where event_type = 'sent')     as last_contacted_at
    from activities
    where source = 'lemlist' and email is not null
    group by campaign_id, lower(email)
  )
  insert into people (
    campaign_id, source, email, name, company, status,
    sent_count, opened_count, clicked_count, replied_count, bounced,
    first_contacted_at, last_contacted_at, last_synced
  )
  select
    campaign_id, 'lemlist', email, name, company,
    case when bounced then 'bounced'
         when replied_count > 0 then 'replied'
         when sent_count > 0 then 'contacted'
         else 'active' end,
    sent_count, opened_count, clicked_count, replied_count, bounced,
    first_contacted_at, last_contacted_at, now()
  from agg
  on conflict (campaign_id, email) do update set
    name               = coalesce(excluded.name, people.name),
    company            = coalesce(excluded.company, people.company),
    status             = excluded.status,
    sent_count         = excluded.sent_count,
    opened_count       = excluded.opened_count,
    clicked_count      = excluded.clicked_count,
    replied_count      = excluded.replied_count,
    bounced            = excluded.bounced,
    first_contacted_at = excluded.first_contacted_at,
    last_contacted_at  = excluded.last_contacted_at,
    last_synced        = now();

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.refresh_lemlist_people() from public, anon, authenticated;
grant execute on function public.refresh_lemlist_people() to service_role;
