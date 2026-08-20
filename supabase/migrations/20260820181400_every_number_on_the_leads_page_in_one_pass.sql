-- ============================================================
-- Every number on the Leads page, in one pass.
--
-- The rebuilt page asked twenty-five separate head-counts: one per tile, one
-- per filter chip, each with the OTHER filters still applied so that a chip's
-- number is what clicking it would show. Every one of them re-planned and
-- re-ran `v_lead_people`, which costs ~95ms of execution and ~157ms of
-- planning. Measured: **the page took 9.6 seconds to load.**
--
-- Twenty-five right answers arriving too late to read is not a working page.
--
-- One materialised scan, and every number is a `count(*) filter (...)` over it.
-- The per-chip rule is unchanged and now stated once instead of twenty-five
-- times: a chip counts with every other filter on and its OWN dimension left
-- out, because clicking "call list" replaces the channel filter rather than
-- intersecting with it. Measured after: 98ms for all 26 numbers, page 0.37s.
--
-- Long format — (facet, key, n) — rather than 26 columns, so adding a filter
-- later is a new `union all` and not a signature change every caller has to
-- follow.
-- ============================================================

create or replace function public.lead_facets(
  p_groups      uuid[]  default null,
  p_calls       uuid[]  default null,
  p_channel     text    default null,
  p_status      text    default null,
  p_reached     text    default null,
  p_contactable boolean default false,
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
      (not coalesce(p_contactable, false) or v.contactable)                   as m_can,
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
  select 'list', coalesce(group_id, call_campaign_id)::text, count(*) from f
   where m_ch and m_st and m_rc and m_can and m_q
     and coalesce(group_id, call_campaign_id) is not null
   group by 2
$function$;

grant execute on function public.lead_facets(uuid[], uuid[], text, text, text, boolean, text)
  to anon, authenticated;
