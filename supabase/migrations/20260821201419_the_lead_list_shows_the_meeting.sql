-- ============================================================
-- A meeting shows up on the lead list.
--
-- Reported by Tanay, 21 August 2026: "if I add a person's name on the meetings
-- tab and say that I met them, that is not getting updated in the leads list.
-- For Bharat Mudgal this specific person did not work."
--
-- Measured before writing anything. Bharat Mudgal is in `people` (synced from
-- Instantly, Canada — Justin's list, first emailed 28 Jul), in `leads` (the
-- July spreadsheet, status 'assigned'), and has a meeting on 10 Aug, status
-- 'booked'. All three rows are correct and nothing failed to write.
--
-- What failed is that /leads has no idea meetings exist. `v_lead_people` unions
-- the email side and the call side and never looks at `meetings` at all, so his
-- row reads "emailed · assigned" exactly as it did before the meeting was
-- logged. 20260821130000 made a meeting *put a stranger on* the list; for
-- somebody already on it, there was nothing to see.
--
-- Note this is also why the write in that migration is skipped for him and was
-- right to be: writing 'prospect' over an 'assigned' that a human typed on a
-- spreadsheet would be a status moving as a side effect of an unrelated write.
-- The meeting is not a status. It is its own fact and it gets its own columns.
--
-- ---------------------------------------------------------------------------
-- Three columns, appended, derived — never stored
--
--   meetings           how many are on the books, deleted ones excluded
--   last_meeting_date  the most recent one
--   meeting_status     booked / held / no show / cancelled, latest first
--
-- Joined on the person key, which for the email side is the address lowercased
-- — the same identity rule the meetings page groups by, and the only rule this
-- codebase ever merges two records on. A meeting logged against somebody with
-- no address, or against a call-list name keyed on their contact id, does not
-- attach: those people are visible on /meetings and in the call workspace, and
-- a name-match here would be the one thing §10.3 forbids.
--
-- `phone` on the email side (this migration also carries it through `v_leads`
-- from the column the previous one added to `leads`) so a lead added by hand
-- and reached by telephone shows the number. The call side still wins where
-- both have one: it is the phone-native side.
-- ============================================================

-- ---------------------------------------------------------------------------
-- v_leads: unchanged but for `phone`, appended to both arms. `people` has never
-- carried a phone number, so the live arm is a null of the right type.
-- ---------------------------------------------------------------------------
create or replace view v_leads as
with lead_one as (
  select distinct on (lower(l.email))
         lower(l.email) as email_key,
         l.id, l.group_id, l.campaign_id, l.name, l.email, l.company, l.title,
         l.status, l.email_quality, l.source_list, l.source_file, l.phone, l.created_at
  from leads l
  where l.email is not null
  order by lower(l.email), l.created_at, l.id
)
select
  p.id, m.group_id, p.campaign_id, p.source, p.name,
  lower(p.email) as email, p.company, lo.title, lo.status, lo.email_quality,
  lo.source_list, lo.source_file,
  true as in_tools,
  p.first_contacted_at, p.last_contacted_at, p.bounced,
  lo.phone
from people p
left join campaign_group_members m on m.campaign_id = p.campaign_id
left join lead_one lo on lo.email_key = lower(p.email)

union all

select
  lo.id, lo.group_id, lo.campaign_id,
  null::text as source,
  lo.name, lo.email_key as email, lo.company, lo.title, lo.status, lo.email_quality,
  lo.source_list, lo.source_file,
  false as in_tools,
  null::timestamptz as first_contacted_at,
  null::timestamptz as last_contacted_at,
  null::boolean as bounced,
  lo.phone
from lead_one lo
where not exists (select 1 from people p where lower(p.email) = lo.email_key);

grant select on v_leads to anon, authenticated;


-- ---------------------------------------------------------------------------
-- v_lead_people: the live definition, with the `met` arm and the two phone
-- changes. Everything else is byte-for-byte what was there.
-- ---------------------------------------------------------------------------
create or replace view v_lead_people as
with shared_mailbox as (
  select lower(trim(ct.email)) as k
  from call_contacts ct
  where nullif(trim(ct.email), '') is not null
  group by lower(trim(ct.email))
  having count(*) > 1
      or split_part(lower(trim(min(ct.email))), '@', 1) ~
         '^(info|contact|admin|office|hello|sales|mail|inquiries|enquiries|support|team|general|reception|frontdesk|front-desk|main|hr|jobs|careers|accounts|billing|estimating)$'
),
emailed as (
  select
    lower(vl.email) as person_key,
    (array_agg(vl.id order by vl.first_contacted_at, vl.id))[1]                    as id,
    (array_agg(vl.group_id order by vl.group_id))[1]                               as group_id,
    (array_agg(vl.campaign_id order by vl.campaign_id))[1]                         as campaign_id,
    (array_agg(vl.name order by (vl.name is null), vl.name))[1]                    as name,
    lower(vl.email)                                                                as email,
    (array_agg(vl.company order by (vl.company is null), vl.company))[1]           as company,
    (array_agg(vl.title order by (vl.title is null), vl.title))[1]                 as title,
    (array_agg(vl.status order by (vl.status is null), vl.status))[1]              as status,
    (array_agg(vl.email_quality order by (vl.email_quality is null), vl.email_quality))[1] as email_quality,
    (array_agg(vl.phone order by (vl.phone is null), vl.phone))[1]                 as phone,
    bool_or(vl.in_tools)                                                           as in_tools,
    min(vl.first_contacted_at)                                                     as first_contacted_at,
    max(vl.last_contacted_at)                                                      as last_contacted_at,
    bool_or(coalesce(vl.bounced, false))                                           as bounced,
    count(*)                                                                       as campaign_rows
  from v_leads vl
  where vl.email is not null
  group by lower(vl.email)
),
call_side as (
  select
    case
      when nullif(trim(ct.email), '') is null then 'call:' || ct.id::text
      when exists (select 1 from shared_mailbox s where s.k = lower(trim(ct.email)))
        then 'call:' || ct.id::text
      else lower(trim(ct.email))
    end                                     as person_key,
    ct.id                                   as call_contact_id,
    ct.call_campaign_id,
    ct.full_name                            as name,
    lower(nullif(trim(ct.email), ''))       as email,
    exists (select 1 from shared_mailbox s where s.k = lower(trim(ct.email))) as email_is_shared,
    ct.org_name                             as company,
    ct.role, ct.phone, ct.dnc, ct.dnc_reason, ct.callback_date,
    ct.buildings_count, ct.best_rank,
    count(pc.id)                            as calls,
    min(pc.call_date)                       as first_call_date,
    max(pc.call_date)                       as last_call_date,
    (array_agg(pc.outcome order by pc.call_date desc, pc.created_at desc)
       filter (where pc.id is not null))[1] as call_outcome,
    (array_agg(pc.rep order by pc.call_date desc, pc.created_at desc)
       filter (where pc.rep is not null))[1] as call_rep
  from call_contacts ct
  left join phone_calls pc on pc.contact_id = ct.id and pc.deleted_at is null
  group by ct.id
),
loose_calls as (
  select
    'call:' || lower(trim(pc.prospect_name)) as person_key,
    null::uuid as call_contact_id,
    null::uuid as call_campaign_id,
    (array_agg(pc.prospect_name order by pc.call_date))[1] as name,
    null::text as email,
    false      as email_is_shared,
    (array_agg(pc.company order by (pc.company is null)))[1] as company,
    null::text as role, null::text as phone,
    false as dnc, null::text as dnc_reason, null::date as callback_date,
    0 as buildings_count, null::int as best_rank,
    count(pc.id)      as calls,
    min(pc.call_date) as first_call_date,
    max(pc.call_date) as last_call_date,
    (array_agg(pc.outcome order by pc.call_date desc, pc.created_at desc))[1] as call_outcome,
    (array_agg(pc.rep order by pc.call_date desc, pc.created_at desc)
       filter (where pc.rep is not null))[1] as call_rep
  from phone_calls pc
  where pc.deleted_at is null and pc.contact_id is null
  group by 1
),
called as (
  select * from call_side
  union all
  select * from loose_calls
),
twins as (
  select lower(trim(c.name)) as name_key
  from called c
  join emailed e on lower(trim(e.name)) = lower(trim(c.name))
  where c.email is null and c.name is not null
  group by 1
),
-- New. One row per address we have ever booked or held with, deleted meetings
-- excluded, so a meeting removed as a mistake takes its badge with it.
met as (
  select
    lower(trim(m.prospect_email)) as person_key,
    count(*)                      as meetings,
    max(m.meeting_date)           as last_meeting_date,
    (array_agg(m.status order by m.meeting_date desc, m.created_at desc))[1] as meeting_status
  from meetings m
  where m.deleted_at is null
    and nullif(trim(coalesce(m.prospect_email, '')), '') is not null
  group by 1
)
select
  coalesce(e.person_key, c.person_key)                       as person_key,
  coalesce(e.name, c.name)                                   as name,
  coalesce(e.email, c.email)                                 as email,
  coalesce(c.email_is_shared, false)                         as email_is_shared,
  coalesce(e.company, c.company)                             as company,
  coalesce(e.title, c.role)                                  as title,
  -- The call side wins: it is the phone-native side. The email side can only
  -- have one at all since `leads.phone` was added a migration ago.
  coalesce(c.phone, e.phone)                                 as phone,
  case when e.person_key is not null and c.person_key is not null then 'both'
       when c.person_key is not null then 'call'
       else 'email' end                                      as channel,
  e.group_id,
  e.campaign_id,
  c.call_campaign_id,
  c.call_contact_id,
  e.status,
  e.email_quality,
  coalesce(e.in_tools, false)                                as in_tools,
  coalesce(e.bounced, false)                                 as bounced,
  e.first_contacted_at,
  e.last_contacted_at,
  coalesce(c.calls, 0)                                       as calls,
  c.first_call_date,
  c.last_call_date,
  c.call_outcome,
  c.call_rep,
  c.callback_date,
  coalesce(c.dnc, false)                                     as dnc,
  c.dnc_reason,
  coalesce(c.buildings_count, 0)                             as buildings_count,
  c.best_rank,
  least(
    e.first_contacted_at,
    coalesce(c.first_call_date::timestamp at time zone 'America/New_York', e.first_contacted_at)
  )                                                          as contacted_at,
  (coalesce(e.email, c.email) is not null
    or nullif(trim(coalesce(c.phone, e.phone, '')), '') is not null) as contactable,
  (t.name_key is not null)                                   as name_twin,
  coalesce(mt.meetings, 0)                                   as meetings,
  mt.last_meeting_date,
  mt.meeting_status
from emailed e
full outer join called c on c.person_key = e.person_key
left join twins t on t.name_key = lower(trim(c.name))
left join met mt on mt.person_key = coalesce(e.person_key, c.person_key);

grant select on v_lead_people to anon, authenticated;


-- ---------------------------------------------------------------------------
-- lead_rows carries the three columns to the page. Dropped and recreated
-- rather than replaced: Postgres will not change the return type of an
-- existing function in place. Same seven arguments, same predicate, same order
-- — if this signature ever stops matching lead_facets, the page is asking two
-- different questions again.
-- ---------------------------------------------------------------------------
drop function if exists public.lead_rows(uuid[], uuid[], text, text, text, boolean, text);

create function public.lead_rows(
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
  contactable boolean, name_twin boolean, buildings_count int,
  meetings bigint, last_meeting_date date, meeting_status text
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
    v.contactable, v.name_twin, v.buildings_count,
    v.meetings, v.last_meeting_date, v.meeting_status
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
  order by v.contacted_at desc nulls last, v.name
$function$;

grant execute on function public.lead_rows(uuid[], uuid[], text, text, text, boolean, text)
  to anon, authenticated;
