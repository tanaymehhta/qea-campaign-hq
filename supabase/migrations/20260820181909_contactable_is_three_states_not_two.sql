-- ============================================================
-- "Can we contact them" is three states, not two.
--
-- Caught by following the tile's own href: "No way to contact" read 1,162 and
-- the page it opened listed all 3,986. `p_contactable boolean` only ever had
-- two meanings — filter to the contactable, or do not filter — so there was no
-- way to ask for the 1,162 the tile was counting. A tile whose click cannot
-- express its own number is a tile that lies by construction, and no amount of
-- care in the page could have fixed it: the argument had no room for the
-- answer.
--
-- Three states now: null asks nothing, true is "has a phone or an email",
-- false is "has neither". Both readers change together, because they are one
-- predicate with two callers and always have to be.
-- ============================================================

create or replace function public.lead_facets(
  p_groups      uuid[]  default null,
  p_calls       uuid[]  default null,
  p_channel     text    default null,
  p_status      text    default null,
  p_reached     text    default null,
  p_contactable boolean default null,
  p_search      text    default null
)
returns table (facet text, key text, n bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with f as materialized (
    select
      v.channel, v.status, v.contacted_at, v.contactable, v.calls,
      v.group_id, v.call_campaign_id,
      (p_channel is null or v.channel = p_channel)                            as m_ch,
      (p_status  is null or v.status  = p_status)                             as m_st,
      (p_reached is null
        or (p_reached = 'yes') = (v.contacted_at is not null))                as m_rc,
      (p_contactable is null or v.contactable = p_contactable)                as m_can,
      (coalesce(array_length(p_groups, 1), 0) = 0
         and coalesce(array_length(p_calls, 1), 0) = 0
       or v.group_id = any (p_groups)
       or v.call_campaign_id = any (p_calls))                                 as m_list,
      (p_search is null
        or v.name ilike '%' || p_search || '%'
        or v.email ilike '%' || p_search || '%'
        or v.company ilike '%' || p_search || '%'
        or v.phone ilike '%' || p_search || '%')                              as m_q
    from v_lead_people v
  )
  -- The whole page, unfiltered: what this page is a page of.
  select 'total', 'all',           count(*)                                             from f
  union all select 'total', 'email',  count(*) filter (where channel = 'email')          from f
  union all select 'total', 'call',   count(*) filter (where channel = 'call')           from f
  union all select 'total', 'both',   count(*) filter (where channel = 'both')           from f
  union all select 'total', 'contacted', count(*) filter (where contacted_at is not null) from f
  union all select 'total', 'never',  count(*) filter (where contacted_at is null)       from f
  union all select 'total', 'unreachable', count(*) filter (where not contactable)       from f
  union all select 'total', 'marked_sent', count(*) filter (where status = 'sent')       from f
  union all select 'total', 'called', count(*) filter (where calls > 0)                  from f
  -- The list on screen: every filter applied.
  union all
  select 'shown', 'all', count(*) from f
   where m_ch and m_st and m_rc and m_can and m_list and m_q
  -- Each tab, counted with every OTHER filter still on, because a tab's number
  -- has to be what clicking it would show. Its own dimension is the one thing
  -- left out — clicking "call list" replaces the channel filter, it does not
  -- intersect with it.
  union all
  select 'channel', 'all', count(*) from f where m_st and m_rc and m_can and m_list and m_q
  union all
  select 'channel', channel, count(*) from f
   where m_st and m_rc and m_can and m_list and m_q group by channel
  union all
  select 'reached', 'all', count(*) from f where m_ch and m_st and m_can and m_list and m_q
  union all
  select 'reached', case when contacted_at is not null then 'yes' else 'no' end, count(*)
    from f where m_ch and m_st and m_can and m_list and m_q group by 2
  union all
  select 'status', 'all', count(*) from f where m_ch and m_rc and m_can and m_list and m_q
  union all
  select 'status', status, count(*) from f
   where m_ch and m_rc and m_can and m_list and m_q and status is not null group by status
  union all
  select 'list', 'all', count(*) from f where m_ch and m_st and m_rc and m_can and m_q
  union all
  select 'list', coalesce(group_id, call_campaign_id)::text, count(*) from f
   where m_ch and m_st and m_rc and m_can and m_q
     and coalesce(group_id, call_campaign_id) is not null
   group by 2
$function$;


create or replace function public.lead_rows(
  p_groups      uuid[]  default null,
  p_calls       uuid[]  default null,
  p_channel     text    default null,
  p_status      text    default null,
  p_reached     text    default null,
  p_contactable boolean default null,
  p_search      text    default null
)
returns table (
  person_key text, name text, email text, email_is_shared boolean,
  company text, title text, phone text, channel text,
  group_id uuid, call_campaign_id uuid,
  status text, email_quality text,
  calls bigint, last_call_date date, call_outcome text, call_rep text,
  callback_date date, dnc boolean,
  first_contacted_at timestamptz, contacted_at timestamptz,
  contactable boolean, name_twin boolean, buildings_count int
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    v.person_key, v.name, v.email, v.email_is_shared,
    v.company, v.title, v.phone, v.channel,
    v.group_id, v.call_campaign_id,
    v.status, v.email_quality,
    v.calls, v.last_call_date, v.call_outcome, v.call_rep,
    v.callback_date, v.dnc,
    v.first_contacted_at, v.contacted_at,
    v.contactable, v.name_twin, v.buildings_count
  from v_lead_people v
  where (p_channel is null or v.channel = p_channel)
    and (p_status  is null or v.status  = p_status)
    and (p_reached is null or (p_reached = 'yes') = (v.contacted_at is not null))
    and (p_contactable is null or v.contactable = p_contactable)
    and (coalesce(array_length(p_groups, 1), 0) = 0
           and coalesce(array_length(p_calls, 1), 0) = 0
         or v.group_id = any (p_groups)
         or v.call_campaign_id = any (p_calls))
    and (p_search is null
         or v.name ilike '%' || p_search || '%'
         or v.email ilike '%' || p_search || '%'
         or v.company ilike '%' || p_search || '%'
         or v.phone ilike '%' || p_search || '%')
  -- Most recently contacted first, so the people something has happened to are
  -- at the top and the untouched list is beneath them rather than interleaved.
  order by v.contacted_at desc nulls last, v.name
$function$;

grant execute on function public.lead_facets(uuid[], uuid[], text, text, text, boolean, text)
  to anon, authenticated;
grant execute on function public.lead_rows(uuid[], uuid[], text, text, text, boolean, text)
  to anon, authenticated;
