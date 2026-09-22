-- ============================================================
-- A person can be put on the lead list by hand.
--
-- Tanay, 21 August 2026: "I don't have any way of adding a person in the lead
-- spot. If I add, I should have an option of setting all the parameters as
-- well — if I have booked a meeting, what the current status is."
--
-- /leads had no writer at all. Everyone on it arrived one of three ways: the
-- vendor sync into `people`, a spreadsheet import into `leads` back in July, or
-- — since 20260821130000 — as a side effect of logging a meeting. Somebody met
-- at a conference, handed over by a client, or dug up by hand could not be put
-- on the page whose entire job is to be the thing you check before you contact
-- somebody.
--
-- ---------------------------------------------------------------------------
-- Which table, and why the answer is the same as last time
--
-- `people` is the VENDOR copy: Instantly and lemlist own the key
-- (campaign_id, email) and sync into it every half hour. Nothing in this
-- repository writes to it and this does not start.
--
-- `leads` is the HUMAN copy — "somebody put this person on a list, from a named
-- source". source_list = 'hand', the same value log_meeting uses, so the two
-- hand-written routes produce one kind of row and its unique key
-- (source_list, email) deduplicates them against each other for free.
--
-- ---------------------------------------------------------------------------
-- Three decisions
--
-- 1. AN ADDRESS IS REQUIRED. Asked and answered on 21 Aug: v_lead_people builds
--    its email side from `where vl.email is not null`, so a lead with no address
--    would be written and then never appear on the page it was written for.
--    Refusing with a sentence beats writing a row into a hole.
--
-- 2. SOMEBODY ALREADY KNOWN IS REFUSED, BY NAME. If the address is already in
--    `people` or in `leads`, they are already on /leads and there is nothing to
--    add — writing anyway would attach this form's status to a human whose
--    status came from somewhere else, which is a visible number moving as a
--    side effect. The exception is silent-conflict: the message names where
--    they already are so the answer is "go and look at them", not "it didn't
--    work".
--
-- 3. THE MEETING TICK MAKES A REAL MEETING. It calls log_meeting in this same
--    transaction rather than setting a flag of its own. `meetings` is the one
--    definition of a meeting — the KPI, the date windows, the booked/held
--    lifecycle all read it — and a second boolean saying "we met" would be a
--    second answer to a question that already has one, free to disagree with
--    it. log_meeting revalidates everything and can still refuse (a duplicate,
--    an agreed-on date after the meeting date); if it does, the lead is not
--    written either, because the two are one transaction.
--
--    log_meeting will then try to insert the same person into `leads` itself.
--    It cannot double: our row is already in, under the same
--    (source_list, email) key, and its insert is `on conflict do nothing`.
--
-- `phone` is new on `leads`. `people` has never had one — the column existed
-- only on the call side — and a hand-added lead reached by telephone had
-- nowhere to put the number. Threaded through to the page by the next
-- migration.
-- ============================================================

alter table public.leads add column if not exists phone text;

create or replace function public.add_lead(
  p_name       text,
  p_email      text,
  p_company    text default null,
  p_title      text default null,
  p_phone      text default null,
  p_group      uuid default null,
  p_status     text default 'prospect',
  p_added_by   text default null,
  p_met        boolean default false,
  p_date       date default null,
  p_booked_on  date default null,
  p_evidence   text default 'chat',
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text; v_email text; v_status text; v_where text;
begin
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'the person''s name is required'; end if;

  -- Decision 1. Not optional here the way it is on a meeting: a lead with no
  -- address is written into a hole.
  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null then
    raise exception 'an email address is required to put somebody on the lead list — the list is keyed on it, so a lead without one would be saved and then never appear';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" does not look like an email address', v_email;
  end if;

  v_status := coalesce(nullif(trim(coalesce(p_status, '')), ''), 'prospect');
  if v_status not in ('prospect', 'assigned', 'sent', 'held', 'no_email') then
    raise exception 'status must be prospect, assigned, sent, held or no_email — not "%"', v_status;
  end if;

  if p_group is not null and not exists (select 1 from campaign_groups where id = p_group) then
    raise exception 'no campaign group with that id';
  end if;

  -- Decision 2. Named, so the answer is "go and look at them".
  select case when exists (select 1 from people p where lower(p.email) = v_email)
              then 'already in the tools' else null end
    into v_where;
  if v_where is null and exists (select 1 from leads l where lower(l.email) = v_email) then
    select 'already on the lead list, from ' || coalesce(l.source_list, 'an import')
      into v_where from leads l where lower(l.email) = v_email limit 1;
  end if;
  if v_where is not null then
    raise exception '% is % — open them on /leads and change that record instead of adding a second one', v_email, v_where;
  end if;

  insert into leads (source_list, source_file, group_id, name, email, company, title, phone, status)
  values ('hand',
          nullif(trim(coalesce(p_added_by, '')), ''),
          p_group, v_name, v_email,
          nullif(trim(coalesce(p_company, '')), ''),
          nullif(trim(coalesce(p_title, '')), ''),
          nullif(trim(coalesce(p_phone, '')), ''),
          v_status);

  -- Decision 3. One definition of a meeting, in one transaction with the lead.
  if coalesce(p_met, false) then
    if p_date is null or p_booked_on is null then
      raise exception 'a meeting needs both dates — the day it happens and the day it was agreed, which is what every date window on the dashboard counts by';
    end if;
    perform log_meeting(
      p_name      => v_name,
      p_email     => v_email,
      p_company   => p_company,
      p_date      => p_date,
      p_group     => p_group,
      p_evidence  => coalesce(nullif(trim(coalesce(p_evidence, '')), ''), 'chat'),
      p_note      => coalesce(p_note, ''),
      p_logged_by => coalesce(p_added_by, ''),
      p_booked_on => p_booked_on
    );
  end if;
end $$;

grant execute on function public.add_lead(text, text, text, text, text, uuid, text, text, boolean, date, date, text, text)
  to anon, authenticated;
