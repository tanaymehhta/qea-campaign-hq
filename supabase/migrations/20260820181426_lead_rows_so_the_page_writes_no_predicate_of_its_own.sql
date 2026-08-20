-- ============================================================
-- The Leads page writes no predicate of its own.
--
-- `lead_facets` moved the counting into SQL. That left the table underneath it
-- still filtered in JavaScript — the same six conditions written a second time,
-- in a second language, by hand. They agreed on the day they were written and
-- would have stopped agreeing the first time somebody edited one of them.
--
-- That is not a hypothetical: it is exactly how the homepage came to say
-- "People who replied · 3" over a list of 193 messages. One predicate, two
-- readers — a counter and a lister — is the only arrangement that cannot drift.
--
-- Same seven arguments as `lead_facets`, deliberately. If the two signatures
-- ever diverge, the page is asking two different questions again.
-- ============================================================

create or replace function public.lead_rows(
  p_groups      uuid[]  default null,
  p_calls       uuid[]  default null,
  p_channel     text    default null,
  p_status      text    default null,
  p_reached     text    default null,
  p_contactable boolean default false,
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
    and (not coalesce(p_contactable, false) or v.contactable)
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

grant execute on function public.lead_rows(uuid[], uuid[], text, text, text, boolean, text)
  to anon, authenticated;
