-- ============================================================
-- A booked meeting has a date, and one definition of whose it is.
--
-- Two faults, both on the Meetings tile, both measured live on 20 Aug 2026.
--
-- ---------------------------------------------------------------------------
-- Fault 1 — the tile and its own click disagree, for exactly the meetings
-- that come from calls.
--
-- Scraped the way §7 of the handoff asks: read the tile's number and the
-- tile's own href, follow the href, count the rows.
--
--   /?rep=Mark Vasu        "Meetings booked"  5
--   its href               /list?metric=meetings&range=all&rep=Mark+Vasu
--   rows behind it         4
--
-- The missing one is Baris Acar, the only meeting on the board that came from
-- a phone call. A call-created meeting carries `campaign_id = null` AND
-- `group_id = null`, because the calls workspace belongs to no email campaign.
-- Three files each answer "is this meeting this rep's?" differently:
--
--   app/page.jsx:71        group OR campaign's group OR (no scope AND logged_by = rep)
--   app/list/page.jsx:164  group OR campaign  — cannot see a call meeting at all
--   app/meetings/page.jsx:44  owner of group ?? owner of campaign's group ?? logged_by
--
-- That is F2 with a different table under it. One meeting hides today; the
-- moment a second rep runs a second call list, every meeting they book hides.
-- The fix is the one this codebase already uses twice (T4, T5): the rule moves
-- into Postgres once, and every reader asks that one definition.
--
-- ---------------------------------------------------------------------------
-- Fault 2 — there is nowhere to write the date of the meeting.
--
-- `phone_calls` holds `call_date` and `callback_date` and nothing else, and
-- `log_call` writes `meeting_date := p_call_date`. So a meeting agreed on the
-- phone today for 3 September is recorded as a meeting *today*. Both dates in
-- the call form were the call's own dates; neither was the meeting's.
--
-- Decided by Tanay, 20 Aug 2026:
--   · a `booked_meeting` outcome now REQUIRES a meeting date. The database
--     refuses the write and says so in a sentence, the way a do-not-call
--     without a reason already does. A meeting cannot be silently dated to
--     the day of the call again.
--   · the Overview's date window means *booked in this window*, not *meeting
--     falls in this window*. A meeting booked today for 3 September is a win
--     today; dating it by `meeting_date` would empty a rep's best week and
--     fill a week a fortnight out. Hence `booked_on`.
--   · "Meetings booked" counts MEETINGS, not people. Two conversations with
--     Jeffrey Hohenstein are two meetings. `meeting_counts` returns the
--     headcount too, so the tile can say both without a second definition.
--
-- `booked_on` is null for the four hand-typed meetings: nobody recorded when
-- they were agreed, and inventing a date from `created_at` would be a guess
-- (Jeffrey Hohenstein's two rows were both typed on 30 July, one of them for a
-- meeting that had already happened on the 22nd). Null means "not known", and
-- the scope date falls back to `meeting_date` for those rows — which is
-- exactly today's behaviour, so nothing that is currently true moves.
--
-- The manual /meetings form is deliberately left alone. It asks for the
-- meeting date and has never asked when it was agreed; adding a field there is
-- a separate decision. Its rows keep `booked_on = null` and the fallback.
-- ============================================================

alter table meetings add column if not exists booked_on date;

comment on column meetings.booked_on is
  'The day the meeting was agreed, which is not the day it happens. Null on rows
   predating 20 Aug 2026, where nobody recorded it; readers fall back to
   meeting_date. Every meeting created from a call carries the call date.';

-- The one meeting that came from a call was agreed on the call. Its
-- meeting_date is still the call date and that is NOT known to be right — the
-- note reads "interested in demo, setting up" — but meetings is hand-kept, so
-- this migration will not invent a date it was never told. Only booked_on,
-- which the call itself proves.
update meetings m
   set booked_on = pc.call_date
  from phone_calls pc
 where pc.id = m.source_call_id
   and m.booked_on is null;

-- ---------------------------------------------------------------------------
-- One definition of "a meeting in this scope".
--
-- security invoker, like reached_people and response_people: RLS already hides
-- what anon may not see, and a definer read here would widen it.
--
-- Scope is three-in-one because a meeting can arrive through three doors:
--   · an email campaign        -> campaign_id
--   · a rep's group            -> group_id
--   · a phone call             -> source_call_id, and the rep is the caller or
--                                 the owner of the call campaign they called from
-- plus the hand-typed meeting that names no scope at all, which answers to
-- whoever logged it. Without that last clause a rep's numbers can never sum to
-- the all-reps total.
--
-- All three args null means every meeting — that is "all reps, all campaigns",
-- not "no scope matched".
create or replace function public.meeting_rows(
  p_from date, p_to date, p_campaigns uuid[], p_groups uuid[], p_rep text
) returns table (
  id uuid, campaign_id uuid, group_id uuid,
  prospect_name text, prospect_email text, company text,
  meeting_date date, booked_on date, scope_date date,
  status text, evidence text, note text, origin text,
  source_call_id uuid, rep text
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select m.id, m.campaign_id, m.group_id,
         m.prospect_name, m.prospect_email, m.company,
         m.meeting_date, m.booked_on,
         coalesce(m.booked_on, m.meeting_date) as scope_date,
         m.status, m.evidence, m.note, m.origin, m.source_call_id,
         -- Display only. Scoping is the where clause below; this is the name a
         -- list can print, resolved the same way /meetings resolves it.
         coalesce(
           cg.owner,
           (select g.owner from campaign_group_members mm
              join campaign_groups g on g.id = mm.group_id
             where mm.campaign_id = m.campaign_id
             order by g.sort_order nulls last limit 1),
           cc.owner, pc.rep, m.logged_by
         ) as rep
    from meetings m
    left join campaign_groups cg on cg.id = m.group_id
    left join phone_calls    pc on pc.id = m.source_call_id
    left join call_contacts  ct on ct.id = pc.contact_id
    left join call_campaigns cc on cc.id = ct.call_campaign_id
   where m.status in ('booked', 'held')
     and (p_from is null or coalesce(m.booked_on, m.meeting_date) >= p_from)
     and (p_to   is null or coalesce(m.booked_on, m.meeting_date) <= p_to)
     and (
          (p_campaigns is null and p_groups is null and p_rep is null)
       or (p_campaigns is not null and m.campaign_id = any (p_campaigns))
       or (p_groups    is not null and m.group_id    = any (p_groups))
       or (p_rep is not null and (
              pc.rep = p_rep
           or cc.owner = p_rep
           or (m.group_id is null and m.campaign_id is null
               and m.source_call_id is null and m.logged_by = p_rep)))
     )
$function$;

-- The tile's number, over the tile's own pile. `meetings` is what the tile
-- prints (Tanay, 20 Aug: two conversations with one man are two meetings);
-- `people` rides along so the tile can say "5 meetings · 4 people" without a
-- second definition of either, and `from_calls` so a page can say how many
-- came off the phone.
create or replace function public.meeting_counts(
  p_from date, p_to date, p_campaigns uuid[], p_groups uuid[], p_rep text
) returns table (meetings bigint, people bigint, from_calls bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select count(*)::bigint,
         count(distinct coalesce(
           lower(nullif(trim(coalesce(r.prospect_email, '')), '')),
           lower(trim(coalesce(r.prospect_name, '')))
         ))::bigint,
         count(*) filter (where r.source_call_id is not null)::bigint
    from meeting_rows(p_from, p_to, p_campaigns, p_groups, p_rep) r
$function$;

grant execute on function public.meeting_rows(date, date, uuid[], uuid[], text)
  to anon, authenticated;
grant execute on function public.meeting_counts(date, date, uuid[], uuid[], text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- log_call and edit_call gain the meeting's own date.
--
-- Dropped and recreated rather than replaced: a new argument is a new
-- signature, and leaving the six-argument version in place would give
-- PostgREST two candidates for the same call and let an old caller keep
-- writing meetings dated to the day of the call.
drop function if exists public.log_call(uuid, text, date, text, text, date);
drop function if exists public.edit_call(uuid, text, date, text, text, date);

create or replace function public.log_call(p_contact uuid, p_rep text, p_call_date date,
                                           p_outcome text, p_note text, p_callback date,
                                           p_meeting_date date default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_label text; v_note text; v_email text; v_org text; v_call uuid;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;
  -- The rule that stops a meeting being dated by accident. Said as a sentence,
  -- because the rep reads it on the page they were typing on.
  if p_outcome = 'booked_meeting' and p_meeting_date is null then
    raise exception 'a booked meeting needs the date of the meeting — the date it is actually happening, not the date of this call';
  end if;

  select ct.full_name, cc.display_name, ct.email, ct.org_name
    into v_name, v_label, v_email, v_org
    from call_contacts ct
    join call_campaigns cc on cc.id = ct.call_campaign_id
   where ct.id = p_contact;
  if v_name is null then
    raise exception 'no contact with id %', p_contact;
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');

  -- Double-click, or a browser re-posting the form, must not become two
  -- calls. Same person, same day, same outcome, same note, logged seconds
  -- apart is one call being submitted twice — not a rep who dialled again.
  -- ponytail: a time window, not an idempotency key. Swap it for a token
  -- from the form if genuine same-minute repeat dials ever matter.
  if exists (
    select 1 from phone_calls
     where contact_id = p_contact
       and call_date  = p_call_date
       and outcome    = p_outcome
       and coalesce(note, '') = coalesce(v_note, '')
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into phone_calls (campaign_label, prospect_name, call_date, outcome, note,
                           contact_id, rep, callback_date)
  values (v_label, v_name, p_call_date, p_outcome, v_note,
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback)
  returning id into v_call;

  -- The dedup guard above returns before this point on a double submit; the
  -- exists-check below additionally stops the same meeting being logged
  -- twice hours apart, which would inflate the KPI even though the second
  -- phone_calls row is a legitimate separate dial.
  --
  -- Matched on the meeting's own date now, not the call's: two calls a week
  -- apart that confirm the same 3 September meeting are one meeting, and a
  -- second call that books a genuinely different date is a second one.
  if p_outcome = 'booked_meeting' then
    if not exists (
      select 1 from meetings
       where lower(trim(coalesce(prospect_name, ''))) = lower(trim(coalesce(v_name, '')))
         and lower(trim(coalesce(prospect_email, ''))) = lower(trim(coalesce(v_email, '')))
         and meeting_date = p_meeting_date
         and status <> 'cancelled'
    ) then
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            booked_on, status, evidence, logged_by, note,
                            source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_meeting_date,
              p_call_date, 'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note,
              v_call, 'call');
    end if;
  end if;

  if p_callback is not null then
    update call_contacts set callback_date = p_callback, updated_at = now()
     where id = p_contact;
  end if;
end $function$;

create or replace function public.edit_call(p_call uuid, p_rep text, p_call_date date,
                                            p_outcome text, p_note text, p_callback date,
                                            p_meeting_date date default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_email text; v_org text; v_note text; v_contact uuid;
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;
  if p_outcome = 'booked_meeting' and p_meeting_date is null then
    raise exception 'a booked meeting needs the date of the meeting — the date it is actually happening, not the date of this call';
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');

  update phone_calls
     set call_date = p_call_date,
         outcome = p_outcome,
         note = v_note,
         callback_date = p_callback,
         rep = coalesce(nullif(trim(coalesce(p_rep, '')), ''), rep)
   where id = p_call and deleted_at is null
  returning contact_id into v_contact;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;

  -- Both directions, as before — plus the meeting's own date, which is the
  -- thing an edit is most often for: the prospect moved it.
  if p_outcome = 'booked_meeting' then
    if exists (select 1 from meetings where source_call_id = p_call) then
      update meetings
         set meeting_date = p_meeting_date,
             booked_on = p_call_date,
             note = v_note,
             status = case when status = 'cancelled' then 'booked' else status end
       where source_call_id = p_call;
    else
      select ct.full_name, ct.email, ct.org_name into v_name, v_email, v_org
        from call_contacts ct where ct.id = v_contact;
      insert into meetings (prospect_name, prospect_email, company, meeting_date,
                            booked_on, status, evidence, logged_by, note,
                            source_call_id, origin)
      values (v_name, lower(nullif(trim(coalesce(v_email, '')), '')), v_org, p_meeting_date,
              p_call_date, 'booked', 'chat', nullif(trim(coalesce(p_rep, '')), ''), v_note,
              p_call, 'call');
    end if;
  else
    update meetings set status = 'cancelled'
     where source_call_id = p_call and status <> 'cancelled';
  end if;
end $function$;

grant execute on function public.log_call(uuid, text, date, text, text, date, date)
  to anon, authenticated;
grant execute on function public.edit_call(uuid, text, date, text, text, date, date)
  to anon, authenticated;
