-- ============================================================
-- A meeting can be changed, and taken back.
--
-- `log_meeting` shipped on 6 August as "the last missing write". It was half of
-- one. Three functions can create a meeting and one can fill in a blank name;
-- nothing could re-date one, mark one held, cancel one, or remove one. Measured
-- 20 Aug through the anon key the site actually uses:
--
--   POST   /meetings  ->  401  new row violates row-level security policy
--   PATCH  /meetings  ->  200  []      silently did nothing
--   DELETE /meetings  ->  204          silently did nothing, row still there
--
-- So a hand-typed meeting was write-once, and the only remedy was the SQL access
-- log_meeting was written to eliminate. `held` exists on two rows today for
-- exactly that reason — somebody had a psql prompt.
--
-- ---------------------------------------------------------------------------
-- Two verbs, not one. Settled by Tanay, 20 Aug 2026.
--
--   status 'cancelled'  it was a real meeting and it came off. Stays visible,
--                       stops counting. The history stays readable.
--   deleted_at          it was never a meeting — a typo, a double-log, a
--                       misclick. Out of every count and every list, row kept
--                       as evidence. The phone_calls pattern, already honoured
--                       by eight readers here.
--
-- The second verb is what makes Phase 4 possible: a duplicate is not a
-- cancellation, and without a way to remove one the KPI stays wrong forever.
--
-- `removed_reason` is its own column rather than text appended to `note`.
-- Appending mangles the note permanently, so a restore would not restore — it
-- would hand back a row with an explanation of its own deletion stapled to it.
-- Two nullable columns, both cleared on restore, and the note is left alone.
--
-- ---------------------------------------------------------------------------
-- The call still owns the meetings it made. Decision 0.2.
--
-- `edit_meeting` and `remove_meeting` refuse on `origin = 'call'` and say where
-- to go instead. That is not timidity about the FK: `edit_call` already keeps a
-- linked meeting in step in both directions, and `delete_call` cancels it. A
-- second editor would reopen the two-tiles-that-disagree-forever problem
-- 20260818201145 was written to close.
--
-- It also avoids a resurrection nobody asked for. If a removed call meeting
-- could exist, any later edit to that call — fixing a typo in its note — would
-- find the row through `source_call_id`, update it, and quietly bring back a
-- meeting somebody had deliberately taken off the board.
--
-- `set_meeting_status` is deliberately NOT restricted. Marking a meeting held
-- is useful whichever door it came through, and `edit_call` preserves any
-- status that is not 'cancelled', so the two cannot fight.
--
-- ---------------------------------------------------------------------------
-- Every reader has to honour the new column, and there are four. They are named
-- here rather than left to a grep: meeting_rows (which Phase 1 made the one
-- that matters), v_campaign_summary, v_group_summary, and the two direct reads
-- in app/person/[email]/page.jsx and lib/calls.js.
--
-- Both duplicate guards must ignore removed rows too, or removing a duplicate
-- would permanently block re-logging the meeting it was a duplicate of — the
-- table would refuse a write on the authority of a row nobody can see.
-- ============================================================

alter table meetings add column if not exists deleted_at timestamptz;
alter table meetings add column if not exists removed_reason text;

comment on column meetings.deleted_at is
  'Set when a meeting was never a meeting — a typo, a double-log, a misclick.
   Distinct from status ''cancelled'', which means it was real and came off.
   Every reader filters on this; the row is kept because a row is evidence.';

-- ---------------------------------------------------------------------------
-- 1 · meeting_rows / meeting_counts learn the column.
--
-- Dropped and recreated rather than replaced: the return type gains two
-- columns, and `create or replace function` will not change OUT parameters.
drop function if exists public.meeting_counts(date, date, uuid[], uuid[], text, text);
drop function if exists public.meeting_rows(date, date, uuid[], uuid[], text, text);

create or replace function public.meeting_rows(
  p_from date, p_to date, p_campaigns uuid[], p_groups uuid[], p_rep text,
  p_status text default 'counted'
) returns table (
  id uuid, campaign_id uuid, group_id uuid,
  prospect_name text, prospect_email text, company text,
  meeting_date date, booked_on date, scope_date date,
  status text, evidence text, note text, origin text,
  source_call_id uuid, logged_by text, rep text,
  scope_label text, group_slug text,
  deleted_at timestamptz, removed_reason text, call_date date
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with resolved as (
    select m.id, m.campaign_id, m.group_id,
           m.prospect_name, m.prospect_email, m.company,
           m.meeting_date, m.booked_on,
           coalesce(m.booked_on, m.meeting_date) as scope_date,
           m.status, m.evidence, m.note, m.origin, m.source_call_id, m.logged_by,
           m.deleted_at, m.removed_reason,
           -- So a page can say "came from a call on 4 Aug" without a second query.
           pc.call_date,
           coalesce(cg.owner, gm.owner, pc.rep, cc.owner, m.logged_by) as rep,
           coalesce(cg.display_name, gm.display_name, cc.display_name) as scope_label,
           coalesce(cg.slug, gm.slug) as group_slug
      from meetings m
      left join campaign_groups cg on cg.id = m.group_id
      left join lateral (
        select g.owner, g.display_name, g.slug
          from campaign_group_members mm
          join campaign_groups g on g.id = mm.group_id
         where mm.campaign_id = m.campaign_id
         order by g.sort_order nulls last
         limit 1
      ) gm on true
      left join phone_calls    pc on pc.id = m.source_call_id
      left join call_contacts  ct on ct.id = pc.contact_id
      left join call_campaigns cc on cc.id = ct.call_campaign_id
  )
  select r.id, r.campaign_id, r.group_id,
         r.prospect_name, r.prospect_email, r.company,
         r.meeting_date, r.booked_on, r.scope_date,
         r.status, r.evidence, r.note, r.origin,
         r.source_call_id, r.logged_by, r.rep,
         r.scope_label, r.group_slug,
         r.deleted_at, r.removed_reason, r.call_date
    from resolved r
   -- 'counted' is booked + held and is what every KPI asks for. 'all' is every
   -- status, which /meetings lists so a cancellation stays readable. 'removed'
   -- is the bin, and is the only value that returns deleted rows at all.
   where (case
            when p_status = 'removed' then r.deleted_at is not null
            when p_status = 'all'     then r.deleted_at is null
            else r.deleted_at is null and r.status in ('booked', 'held')
          end)
     and (p_from is null or r.scope_date >= p_from)
     and (p_to   is null or r.scope_date <= p_to)
     and (case
            when p_rep is not null then r.rep = p_rep
            when p_campaigns is null and p_groups is null then true
            else coalesce(r.campaign_id = any (p_campaigns), false)
              or coalesce(r.group_id    = any (p_groups), false)
          end)
$function$;

comment on function public.meeting_rows(date, date, uuid[], uuid[], text, text) is
  'The only answer to "is this meeting in this scope". Every reader asks this.
   p_rep, when given, is the whole scope and the campaign/group arrays are
   ignored: the returned rep already encodes all three doors a meeting can
   arrive through, so a meeting belongs to exactly one rep and per-rep totals
   sum to the all-reps total by construction. p_status is ''counted''
   (booked + held), ''all'' (every status, still excluding removed) or
   ''removed'' (the bin).';

create or replace function public.meeting_counts(
  p_from date, p_to date, p_campaigns uuid[], p_groups uuid[], p_rep text,
  p_status text default 'counted'
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
    from meeting_rows(p_from, p_to, p_campaigns, p_groups, p_rep, p_status) r
$function$;

grant execute on function public.meeting_rows(date, date, uuid[], uuid[], text, text)
  to anon, authenticated;
grant execute on function public.meeting_counts(date, date, uuid[], uuid[], text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · The two summary views honour it as well.
create or replace view v_campaign_summary as
 SELECT c.id AS campaign_id, c.source, c.source_campaign_id, c.name, c.vault_name,
    c.status, c.is_manual, c.daily_limit, c.open_tracking, c.link_tracking,
    c.text_only, c.started_on,
    g.id AS group_id, g.slug AS group_slug, g.display_name AS group_name,
    m.sub_campaign_label, m.assignment_source,
    COALESCE(t.leads, 0) AS leads,
    COALESCE(t.reached, 0) AS reached,
    COALESCE(t.contacted, 0) AS contacted,
    COALESCE(t.sent, 0) AS sent,
    (COALESCE(t.sent, 0) - COALESCE(t.bounced, 0)) AS delivered,
    COALESCE(t.bounced, 0) AS bounced,
    COALESCE(t.opened, 0) AS opened,
    COALESCE(t.replied, 0) AS replied,
    COALESCE(t.clicked, 0) AS clicked,
    COALESCE(t.linkedin_accepted, 0) AS linkedin_accepted,
    COALESCE(t.unsubscribed, 0) AS unsubscribed,
        CASE WHEN (COALESCE(t.sent, 0) > 0) THEN round(((100.0 * (t.bounced)::numeric) / (t.sent)::numeric), 1) ELSE NULL::numeric END AS bounce_pct_of_sent,
        CASE WHEN (COALESCE(t.contacted, 0) > 0) THEN round(((100.0 * (t.bounced)::numeric) / (t.contacted)::numeric), 1) ELSE NULL::numeric END AS bounce_pct_of_contacted,
        CASE WHEN (COALESCE(t.leads, 0) > 0) THEN round(((100.0 * (t.replied)::numeric) / (t.leads)::numeric), 1) ELSE NULL::numeric END AS reply_pct_of_leads,
    ( SELECT count(*) AS count
           FROM meetings mt
          WHERE ((mt.campaign_id = c.id) AND (mt.deleted_at IS NULL)
             AND (mt.status = ANY (ARRAY['booked'::text, 'held'::text])))) AS meetings,
    ( SELECT count(*) AS count
           FROM replies r
          WHERE ((r.campaign_id = c.id) AND (r.sentiment = 'interested'::text))) AS positive_replies,
    c.last_synced,
    ( SELECT count(*) AS count FROM proposals p WHERE (p.campaign_id = c.id)) AS proposals
   FROM (((campaigns c
     LEFT JOIN campaign_group_members m ON ((m.campaign_id = c.id)))
     LEFT JOIN campaign_groups g ON ((g.id = m.group_id)))
     LEFT JOIN campaign_totals t ON ((t.campaign_id = c.id)))
  WHERE (NOT c.hidden);

create or replace view v_group_summary as
 SELECT g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner,
        CASE WHEN ((g.platform IS NULL) OR (cardinality(g.platform) = 0)) THEN ( SELECT array_agg(DISTINCT c.source ORDER BY c.source) AS array_agg
               FROM (campaign_group_members m2 JOIN campaigns c ON ((c.id = m2.campaign_id))) WHERE (m2.group_id = g.id))
            ELSE g.platform END AS platform,
    g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description,
    count(s.campaign_id) AS campaign_count,
    count(*) FILTER (WHERE (s.status = 'running'::text)) AS running_count,
    count(*) FILTER (WHERE (s.status = 'paused'::text)) AS paused_count,
    count(*) FILTER (WHERE (s.status = 'draft'::text)) AS draft_count,
    COALESCE(sum(s.leads), (0)::bigint) AS leads,
    COALESCE(sum(s.sent), (0)::bigint) AS sent,
    COALESCE(sum(s.delivered), (0)::bigint) AS delivered,
    COALESCE(sum(s.bounced), (0)::bigint) AS bounced,
    COALESCE(sum(s.opened), (0)::bigint) AS opened,
    COALESCE(sum(s.replied), (0)::bigint) AS replied,
    COALESCE(sum(s.linkedin_accepted), (0)::bigint) AS linkedin_accepted,
    (( SELECT count(*) AS count FROM meetings mt
        WHERE ((mt.deleted_at IS NULL)
          AND (mt.status = ANY (ARRAY['booked'::text, 'held'::text]))
          AND ((mt.group_id = g.id)
            OR (mt.campaign_id IN ( SELECT mm.campaign_id FROM campaign_group_members mm WHERE (mm.group_id = g.id)))))))::numeric AS meetings,
    COALESCE(sum(s.positive_replies), (0)::numeric) AS positive_replies,
    COALESCE(sum(s.proposals), (0)::numeric) AS proposals,
    dates.first_sent_on, dates.last_sent_on,
        CASE WHEN ((count(*) FILTER (WHERE (s.status = 'running'::text)) > 0) AND (dates.last_sent_on >= (CURRENT_DATE - 14))) THEN 'live'::text
             WHEN (COALESCE(sum(s.sent), (0)::bigint) > 0) THEN 'ended'::text
             ELSE 'planned'::text END AS actual_status,
    g.sort_order
   FROM ((campaign_groups g
     LEFT JOIN v_campaign_summary s ON ((s.group_id = g.id)))
     LEFT JOIN ( SELECT m.group_id,
            min(d.metric_date) FILTER (WHERE (d.sent > 0)) AS first_sent_on,
            max(d.metric_date) FILTER (WHERE (d.sent > 0)) AS last_sent_on
           FROM (daily_metrics d JOIN campaign_group_members m ON ((m.campaign_id = d.campaign_id)))
          GROUP BY m.group_id) dates ON ((dates.group_id = g.id)))
  GROUP BY g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform, g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description, g.sort_order, dates.first_sent_on, dates.last_sent_on;

-- ---------------------------------------------------------------------------
-- 3 · Both duplicate guards ignore removed rows.
--
-- Without this, removing a duplicate permanently blocks re-logging the meeting
-- it duplicated: the table refuses the write on the authority of a row nobody
-- can see, and the only sentence the rep gets says the meeting is already
-- logged. It is not.
create or replace function public.log_meeting(
  p_name text, p_email text, p_company text, p_date date,
  p_group uuid, p_evidence text, p_note text, p_logged_by text,
  p_booked_on date default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_email text; v_evidence text;
begin
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'the prospect''s name is required'; end if;
  if p_date is null then raise exception 'the meeting date is required'; end if;
  if p_booked_on is null then
    raise exception 'a meeting needs the date it was agreed — the day it was booked, which is what every date window on the dashboard counts by, not the day it happens';
  end if;
  if p_booked_on > p_date then
    raise exception 'a meeting cannot be agreed on % and happen earlier, on %', p_booked_on, p_date;
  end if;

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" does not look like an email address', v_email;
  end if;

  v_evidence := coalesce(nullif(trim(coalesce(p_evidence, '')), ''), 'chat');
  if v_evidence not in ('tool', 'calendar', 'crm', 'chat') then
    raise exception 'evidence must be tool, calendar, crm or chat — not "%"', v_evidence;
  end if;

  if p_group is not null and not exists (select 1 from campaign_groups where id = p_group) then
    raise exception 'no campaign group with that id';
  end if;

  if exists (
    select 1 from meetings
     where lower(trim(prospect_name)) = lower(v_name)
       and coalesce(lower(prospect_email), '') = coalesce(v_email, '')
       and meeting_date = p_date
       and deleted_at is null
  ) then
    raise exception 'a meeting with % on % is already logged', v_name, p_date;
  end if;

  insert into meetings (group_id, prospect_name, prospect_email, company, meeting_date,
                        booked_on, status, evidence, logged_by, note)
  values (p_group, v_name, v_email,
          nullif(trim(coalesce(p_company, '')), ''), p_date,
          p_booked_on, 'booked', v_evidence,
          nullif(trim(coalesce(p_logged_by, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''));
end $$;

grant execute on function public.log_meeting(text, text, text, date, uuid, text, text, text, date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · The three writes that did not exist.

-- Everything log_meeting validates, on a row that is already there. Refuses on
-- a call meeting: that one is the call's, and editing it here would give one
-- row two editors.
create or replace function public.edit_meeting(
  p_meeting uuid, p_name text, p_email text, p_company text, p_date date,
  p_booked_on date, p_group uuid, p_evidence text, p_note text
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_email text; v_evidence text; v_origin text; v_call date;
begin
  select m.origin, pc.call_date into v_origin, v_call
    from meetings m left join phone_calls pc on pc.id = m.source_call_id
   where m.id = p_meeting and m.deleted_at is null;
  if v_origin is null then
    raise exception 'no meeting with that id — it may have been removed';
  end if;
  if v_origin = 'call' then
    raise exception 'this meeting came from a call on % — change it there, so the call and the meeting cannot disagree',
      to_char(v_call, 'DD Mon');
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'the prospect''s name is required'; end if;
  if p_date is null then raise exception 'the meeting date is required'; end if;
  if p_booked_on is not null and p_booked_on > p_date then
    raise exception 'a meeting cannot be agreed on % and happen earlier, on %', p_booked_on, p_date;
  end if;

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" does not look like an email address', v_email;
  end if;

  v_evidence := coalesce(nullif(trim(coalesce(p_evidence, '')), ''), 'chat');
  if v_evidence not in ('tool', 'calendar', 'crm', 'chat') then
    raise exception 'evidence must be tool, calendar, crm or chat — not "%"', v_evidence;
  end if;

  if p_group is not null and not exists (select 1 from campaign_groups where id = p_group) then
    raise exception 'no campaign group with that id';
  end if;

  -- Same guard as logging one, minus this row, so an edit that changes nothing
  -- is not refused as a duplicate of itself.
  if exists (
    select 1 from meetings
     where id <> p_meeting
       and lower(trim(prospect_name)) = lower(v_name)
       and coalesce(lower(prospect_email), '') = coalesce(v_email, '')
       and meeting_date = p_date
       and deleted_at is null
  ) then
    raise exception 'another meeting with % on % is already logged', v_name, p_date;
  end if;

  update meetings
     set prospect_name = v_name,
         prospect_email = v_email,
         company = nullif(trim(coalesce(p_company, '')), ''),
         meeting_date = p_date,
         booked_on = p_booked_on,
         group_id = p_group,
         evidence = v_evidence,
         note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_meeting;
end $$;

-- Not restricted by origin: marking a meeting held is useful whichever door it
-- came through, and edit_call preserves any status that is not 'cancelled', so
-- the two cannot fight over it.
create or replace function public.set_meeting_status(p_meeting uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in ('booked', 'held', 'no_show', 'cancelled') then
    raise exception 'a meeting is booked, held, no_show or cancelled — not "%"', p_status;
  end if;
  update meetings set status = p_status where id = p_meeting and deleted_at is null;
  if not found then
    raise exception 'no meeting with that id — it may have been removed';
  end if;
end $$;

-- A reason is required, following the do-not-call precedent: the row is kept as
-- evidence, and evidence with no explanation is just an absence.
create or replace function public.remove_meeting(p_meeting uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_reason text; v_origin text; v_call date;
begin
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'say why it is being removed — the row is kept, and in a month the reason is the only thing that explains it';
  end if;

  select m.origin, pc.call_date into v_origin, v_call
    from meetings m left join phone_calls pc on pc.id = m.source_call_id
   where m.id = p_meeting and m.deleted_at is null;
  if v_origin is null then
    raise exception 'no meeting with that id — it may already have been removed';
  end if;
  if v_origin = 'call' then
    raise exception 'this meeting came from a call on % — change that call''s outcome, or delete the call, and this goes with it',
      to_char(v_call, 'DD Mon');
  end if;

  update meetings set deleted_at = now(), removed_reason = v_reason where id = p_meeting;
end $$;

create or replace function public.restore_meeting(p_meeting uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update meetings set deleted_at = null, removed_reason = null
   where id = p_meeting and deleted_at is not null;
  if not found then
    raise exception 'no removed meeting with that id';
  end if;
end $$;

grant execute on function public.edit_meeting(uuid, text, text, text, date, date, uuid, text, text)
  to anon, authenticated;
grant execute on function public.set_meeting_status(uuid, text) to anon, authenticated;
grant execute on function public.remove_meeting(uuid, text)     to anon, authenticated;
grant execute on function public.restore_meeting(uuid)          to anon, authenticated;
