-- ============================================================
-- One conversation, written down twice.
--
-- The last open fault from the 20 Aug audit, and the only part of this work
-- that is new product rather than repair. Reproduced live that evening, in
-- three writes:
--
--   call logged      "1287 East 19th Condominium", no email,  15 Sept
--   hand-logged      same name, + an email the contact lacked, 15 Sept
--   hand-logged      "1287 East 19th Condo",       no email,  15 Sept
--
--   KPI: 3 meetings, 3 people, one conversation — and, until 21 Aug, no way to
--   take two of them off the board.
--
-- Phase 3 built the exit (`deleted_at`, a row kept as evidence). This builds
-- the two halves that were still missing: something that *notices*, and one
-- click that settles it. And it re-keys the guard that let the second row in.
--
-- ---------------------------------------------------------------------------
-- Why the guard is being loosened, not tightened.
--
-- `log_meeting` refused on lower(name) + lower(email) + date. That key is wrong
-- in both directions at once. It let row 2 through — the same person, spelled
-- the same, because an email was typed that the call contact did not have. And
-- it would have refused a genuine *second* meeting with someone already on the
-- board for that day, which is a real thing that has happened twice in this
-- table (Jeffrey Hohenstein, 22 and 30 July).
--
-- So the key is now the address, which is identity, and nothing else is a
-- refusal:
--
--   1 · the same email on the same day  -> refused, loudly. Same person, same
--       day, and the sentence names the meeting already there.
--   2 · that address on the *call contact* behind an existing call meeting ->
--       also refused. This is the cross-door case: a call meeting can carry no
--       email of its own while the contact it came from has one.
--   3 · the same name and no address to check it against -> **inserted**, and
--       surfaced on /conflicts as a duplicate to merge.
--
-- Refusing on 3 would block the genuine second meeting. Inserting on 3 and
-- staying quiet is what produced the audit. Inserting and *saying so* is the
-- only option left, and it is only available now because Phase 3 built a way
-- to remove one.
--
-- ---------------------------------------------------------------------------
-- What the duplicate conflict deliberately does not catch.
--
-- Two live counted meetings pair when they share a date and either the same
-- lowered email, or the same normalised name where either email is missing.
-- Normalised means case and runs of whitespace, nothing more.
--
-- So row 3 of the audit — "1287 East 19th Condo" against "1287 East 19th
-- Condominium" — is NOT caught, and that is a choice rather than an oversight.
-- The only way to catch a renamed duplicate is a fuzzy key, and a fuzzy key on
-- a company KPI pairs two different people at one firm on one day and invites
-- somebody to merge them. A missed duplicate is one visible row too many; a
-- wrongly merged pair is a meeting deleted on the strength of a similar name.
-- pg_trgm is not installed here and this is not the reason to install it.
--
-- ---------------------------------------------------------------------------
-- The conflict is derived, never stored — the philosophy /conflicts states in
-- its own header. It appears when two rows disagree with the world and
-- disappears the moment one of them comes off, so there is nothing to mark
-- done and nothing that can sit here stale.
--
-- `v_conflicts` gains one column, `partner_id`, null on the three older kinds.
-- A duplicate is the first conflict about a *pair* of things, and the page
-- cannot offer "keep this one" without knowing both ids. Appended at the end
-- because `create or replace view` will not insert a column in the middle.
--
-- The keeper is chosen by the view, not by the page: a call meeting first
-- (decision 0.2 — that row is the call's, and `merge_meetings` refuses to drop
-- it), then whichever was written down first. The page still offers both
-- directions; this only decides which is named first.
--
-- ---------------------------------------------------------------------------
-- Two smaller things fixed here because they are the same fault.
--
-- `log_call`'s duplicate guard never learned `deleted_at`. Phase 3's header
-- says both guards did; only `log_meeting`'s was rewritten. Left alone, a
-- removed hand-typed meeting would silently stop the call door creating the
-- meeting it duplicated — and silently, because that guard skips rather than
-- raises: the rep logs a booked call, gets no error, and no meeting appears.
--
-- `v_conflicts`' meeting_detail branch never learned it either, so a removed
-- meeting with no name would ask, forever, for a name nobody can give it.
--
-- ---------------------------------------------------------------------------
-- Decision 0.6, the person lookup: an email that matches somebody in `people`
-- now also sets the meeting's `campaign_id`, so a hand-logged meeting lands on
-- the sub-campaign as well as the group. The rep's own choice of group always
-- wins — if the resolved campaign sits under a different group, the lookup is
-- ignored rather than overruling the human. Every meeting this resolves is one
-- fewer in the gap decision 0.3 accepted between a group tile and the
-- sub-campaign rows beneath it.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1 · The duplicate key, in one place.
--
-- Returns the name already on the board for that day, or null. Both write paths
-- ask it, so "is this the same meeting" has one answer rather than two that
-- drift. p_email must already be lowered and trimmed — both callers do that to
-- validate it, and doing it twice would say the rule lives in two places.
--
-- Not granted to anon: it is a write-path helper, and PostgREST would otherwise
-- publish it as an RPC of its own.
create or replace function public.meeting_clash(
  p_date date, p_email text, p_except uuid default null
) returns text
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(nullif(trim(m.prospect_name), ''), m.prospect_email,
                  'somebody whose name was left blank')
    from meetings m
    left join phone_calls   pc on pc.id = m.source_call_id
    left join call_contacts ct on ct.id = pc.contact_id
   where p_email is not null
     and m.deleted_at is null
     and m.meeting_date = p_date
     and (p_except is null or m.id <> p_except)
     -- The address on the meeting, or the address on the contact behind the
     -- call that made it. The second is the cross-door case.
     and (lower(m.prospect_email) = p_email
       or lower(nullif(trim(coalesce(ct.email, '')), '')) = p_email)
   limit 1
$function$;

revoke execute on function public.meeting_clash(date, text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 2 · log_meeting: the new key, and the person lookup.
create or replace function public.log_meeting(
  p_name text, p_email text, p_company text, p_date date,
  p_group uuid, p_evidence text, p_note text, p_logged_by text,
  p_booked_on date default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_email text; v_evidence text; v_clash text; v_campaign uuid;
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

  -- The address is identity. A name is not, so a name-only match is inserted
  -- and surfaced as a duplicate rather than refused — see the header.
  v_clash := meeting_clash(p_date, v_email);
  if v_clash is not null then
    raise exception 'a meeting with % on % is already logged — the same email address, so this is the same meeting. Change that one instead, or use a different date',
      v_clash, to_char(p_date, 'DD Mon');
  end if;

  -- Decision 0.6. The address resolves the person, the person carries a
  -- campaign, and the meeting lands on the sub-campaign as well as the group.
  -- The rep's own choice of group wins: a campaign under some other group is
  -- ignored rather than allowed to overrule it.
  if v_email is not null then
    select p.campaign_id into v_campaign
      from people p
     where p.email = v_email
       and p.campaign_id is not null
       and (p_group is null or exists (
             select 1 from campaign_group_members mm
              where mm.campaign_id = p.campaign_id and mm.group_id = p_group))
     order by p.last_contacted_at desc nulls last
     limit 1;
  end if;

  insert into meetings (campaign_id, group_id, prospect_name, prospect_email, company,
                        meeting_date, booked_on, status, evidence, logged_by, note)
  values (v_campaign, p_group, v_name, v_email,
          nullif(trim(coalesce(p_company, '')), ''), p_date,
          p_booked_on, 'booked', v_evidence,
          nullif(trim(coalesce(p_logged_by, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''));
end $$;

grant execute on function public.log_meeting(text, text, text, date, uuid, text, text, text, date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · edit_meeting asks the same question, minus this row.
--
-- Only the guard changes. An edit that could not be logged, or a log that could
-- not be edited, would be two rules wearing one name.
create or replace function public.edit_meeting(
  p_meeting uuid, p_name text, p_email text, p_company text, p_date date,
  p_booked_on date, p_group uuid, p_evidence text, p_note text
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_email text; v_evidence text; v_origin text; v_call date; v_clash text;
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

  v_clash := meeting_clash(p_date, v_email, p_meeting);
  if v_clash is not null then
    raise exception 'another meeting with % on % is already logged — the same email address, so this would be the same meeting twice',
      v_clash, to_char(p_date, 'DD Mon');
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

grant execute on function public.edit_meeting(uuid, text, text, text, date, date, uuid, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · merge_meetings — the one click that settles it.
--
-- The loser leaves by the same door as any other mistake: `deleted_at`, row
-- kept, reason recorded. Not `cancelled` — a duplicate was never a meeting that
-- came off, it was a meeting that was never there (decision 0.1).
--
-- Nothing on the keeper is overwritten. An email, a company or a name the
-- keeper is missing is carried across, because that is usually why there are
-- two rows: the hand-typed one has the address the call contact lacked. The
-- note is appended rather than replaced, and skipped if it is already in there.
create or replace function public.merge_meetings(p_keep uuid, p_drop uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare k meetings%rowtype; d meetings%rowtype;
begin
  if p_keep is null or p_drop is null then
    raise exception 'merging needs two meetings — one to keep and one to remove';
  end if;
  if p_keep = p_drop then
    raise exception 'that is one meeting, not two';
  end if;

  select * into k from meetings where id = p_keep and deleted_at is null;
  if not found then
    raise exception 'the meeting to keep is not there — it may already have been removed';
  end if;
  select * into d from meetings where id = p_drop and deleted_at is null;
  if not found then
    raise exception 'the meeting to remove is not there — it may already have been removed';
  end if;

  -- Decision 0.2. The call's row is the call's record of the conversation, and
  -- removing it would leave a call whose outcome says a meeting was booked and
  -- no meeting anywhere. Keep that one and drop the hand-typed one instead.
  if d.origin = 'call' then
    raise exception 'that meeting came from a phone call and is the call''s own record of it — keep that one and remove the hand-typed one instead';
  end if;

  update meetings
     set prospect_name  = coalesce(k.prospect_name, d.prospect_name),
         prospect_email = coalesce(k.prospect_email, d.prospect_email),
         company        = coalesce(k.company, d.company),
         note           = case
                            when nullif(trim(coalesce(d.note, '')), '') is null then k.note
                            when nullif(trim(coalesce(k.note, '')), '') is null then d.note
                            when position(trim(d.note) in k.note) > 0 then k.note
                            else k.note || ' · ' || trim(d.note)
                          end
   where id = p_keep;

  update meetings
     set deleted_at = now(),
         removed_reason = format(
           'the same conversation as the meeting kept for %s on %s — merged, and this row''s note went with it',
           coalesce(nullif(trim(coalesce(k.prospect_name, '')), ''), k.prospect_email, 'that prospect'),
           to_char(k.meeting_date, 'DD Mon'))
   where id = p_drop;
end $$;

grant execute on function public.merge_meetings(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5 · log_call's guard learns `deleted_at`.
--
-- Everything else in this function is unchanged. Its key stays name + email +
-- date rather than moving to meeting_clash: the call door does not retype
-- anybody, it copies a contact row, so the spelling it writes is the spelling
-- it read. The door where a human types a name from memory is the other one.
create or replace function public.log_call(
  p_contact uuid, p_rep text, p_call_date date, p_outcome text, p_note text,
  p_callback date, p_meeting_date date default null
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text; v_label text; v_note text; v_email text; v_org text; v_call uuid;
begin
  if p_outcome not in ('booked_meeting', 'follow_up', 'not_interested', 'not_reached') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;
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

  if exists (
    select 1 from phone_calls
     where contact_id = p_contact
       and call_date  = p_call_date
       and outcome    = p_outcome
       and coalesce(note, '') = coalesce(v_note, '')
       and deleted_at is null
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into phone_calls (campaign_label, prospect_name, call_date, outcome, note,
                           contact_id, rep, callback_date)
  values (v_label, v_name, p_call_date, p_outcome, v_note,
          p_contact, nullif(trim(coalesce(p_rep, '')), ''), p_callback)
  returning id into v_call;

  if p_outcome = 'booked_meeting' then
    if not exists (
      select 1 from meetings
       where lower(trim(coalesce(prospect_name, ''))) = lower(trim(coalesce(v_name, '')))
         and lower(trim(coalesce(prospect_email, ''))) = lower(trim(coalesce(v_email, '')))
         and meeting_date = p_meeting_date
         and status <> 'cancelled'
         -- A removed row is not on the board, and a guard that reads one is a
         -- guard that refuses on the authority of something nobody can see.
         and deleted_at is null
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

grant execute on function public.log_call(uuid, text, date, text, text, date, date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6 · v_conflicts gains the fourth kind, and one column.
create or replace view v_conflicts as
 select 'reply_split'::text as kind,
    c.campaign_id,
    c.day as conflict_date,
    null::uuid as subject_id,
    format('%s inbound on %s — Instantly counts %s real / %s auto, we read %s / %s',
           c.msgs, to_char(c.day::timestamp with time zone, 'DD Mon'),
           c.their_real, c.their_auto, c.ours_real, c.ours_auto) as title,
    'Confirm each message below and the difference resolves itself.'::text as detail,
    c.msgs as items,
    null::uuid as partner_id
   from v_reply_conflicts c
union all
 select 'meeting_detail'::text as kind,
    m.campaign_id,
    m.meeting_date as conflict_date,
    m.id as subject_id,
    format('Meeting on %s has no name recorded', to_char(m.meeting_date::timestamp with time zone, 'DD Mon')) as title,
    'Logged by hand with the prospect left blank. Only you know who this was.'::text as detail,
    1 as items,
    null::uuid as partner_id
   from meetings m
  where coalesce(nullif(trim(both from m.prospect_name), ''::text), null::text) is null
    -- A removed meeting is off the board, and asking forever for the name of a
    -- row nobody can see is a question with no answer. Phase 3 named four
    -- readers of `deleted_at` and this view was not among them; it is now.
    and m.deleted_at is null
union all
 select 'needs_review'::text as kind,
    r.campaign_id,
    (r.received_at at time zone 'America/New_York'::text)::date as conflict_date,
    r.id as subject_id,
    format('%s replied and nobody has read it yet',
           coalesce(nullif(trim(both from r.lead_name), ''::text), r.lead_email, 'Someone'::text)) as title,
    'Unclassified for over 48 hours. Read it, classify it — and if it is a booked call, log the meeting.'::text as detail,
    1 as items,
    null::uuid as partner_id
   from replies r
  where r.sentiment = 'unclassified'::text and r.received_at < (now() - '48:00:00'::interval)
union all
 -- Two rows for one conversation. Live and counted on both sides, because a
 -- cancelled or removed row is already off the board and merging it would
 -- settle nothing.
 select 'duplicate_meeting'::text as kind,
    coalesce(a.campaign_id, b.campaign_id) as campaign_id,
    a.meeting_date as conflict_date,
    a.id as subject_id,
    format('%s is on the board twice for %s',
           coalesce(nullif(trim(both from a.prospect_name), ''::text), a.prospect_email, 'Somebody'::text),
           to_char(a.meeting_date::timestamp with time zone, 'DD Mon')) as title,
    'One conversation, two rows, and the primary KPI counts it twice. Keep whichever is right — the other comes off the board with its note carried across.'::text as detail,
    2 as items,
    b.id as partner_id
   from meetings a
   join meetings b
     on b.meeting_date = a.meeting_date
    and b.id <> a.id
    and (
          -- The address is identity wherever both rows have one.
          (a.prospect_email is not null and b.prospect_email is not null
           and lower(a.prospect_email) = lower(b.prospect_email))
          -- Otherwise the name, normalised for case and whitespace and nothing
          -- else. Two rows with no name at all do not pair: that is the
          -- meeting_detail conflict above, and it has its own answer.
       or ((a.prospect_email is null or b.prospect_email is null)
           and nullif(trim(both from a.prospect_name), ''::text) is not null
           and lower(regexp_replace(trim(both from a.prospect_name), '\s+', ' ', 'g'))
             = lower(regexp_replace(trim(both from coalesce(b.prospect_name, '')), '\s+', ' ', 'g')))
        )
  where a.deleted_at is null and b.deleted_at is null
    and a.status = any (array['booked'::text, 'held'::text])
    and b.status = any (array['booked'::text, 'held'::text])
    -- One row per pair, not two. The call's meeting is named first because
    -- merge_meetings will not drop it; after that, whichever was written down
    -- first, and the id only to break a tie that cannot otherwise happen.
    and row(case when a.origin = 'call' then 0 else 1 end, a.created_at, a.id)
      < row(case when b.origin = 'call' then 0 else 1 end, b.created_at, b.id);
