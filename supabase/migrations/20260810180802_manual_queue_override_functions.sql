-- Every write validates its own arguments, so a hostile POST fails in the
-- database rather than because the UI happened to be well-behaved. Same shape as
-- submit_feedback / set_feedback_status.

-- Move one person up or down within their own company.
create or replace function inbound_move_person(p_person uuid, p_dir text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_me int;
  v_other_id uuid;
  v_other int;
begin
  if p_dir is null or p_dir not in ('up', 'down') then
    raise exception 'direction must be up or down, got %', coalesce(p_dir, 'null');
  end if;

  select company_id into v_company from inbound_people where id = p_person;
  if v_company is null then
    raise exception 'no such person, or they belong to no company';
  end if;

  -- Freeze the current order into manual_rank first: a swap needs two concrete
  -- numbers, and most rows start with manual_rank NULL and share a priority.
  with ordered as (
    select id, row_number() over (
      order by coalesce(manual_rank, priority, 99), created_at, id) as rn
    from inbound_people where company_id = v_company)
  update inbound_people p set manual_rank = o.rn
    from ordered o
   where o.id = p.id and p.manual_rank is distinct from o.rn;

  select manual_rank into v_me from inbound_people where id = p_person;

  if p_dir = 'up' then
    select id, manual_rank into v_other_id, v_other from inbound_people
     where company_id = v_company and manual_rank < v_me
     order by manual_rank desc limit 1;
  else
    select id, manual_rank into v_other_id, v_other from inbound_people
     where company_id = v_company and manual_rank > v_me
     order by manual_rank asc limit 1;
  end if;

  -- Already top or bottom. Not an error — the button is simply spent.
  if v_other_id is null then return; end if;

  update inbound_people set manual_rank = v_other where id = p_person;
  update inbound_people set manual_rank = v_me    where id = v_other_id;
end $$;

-- Override the Ready / Needs-a-check verdict. NULL hands the row back to the
-- classifier rather than freezing a stale human answer forever.
create or replace function inbound_set_person_ready(p_person uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update inbound_people set manual_sendable = p_ready, updated_at = now()
   where id = p_person;
  if not found then raise exception 'no such person'; end if;
end $$;

-- Move a company between the queue and the ruled-out lane. Marking one relevant
-- re-queues it for research, which is what makes the button do anything: the
-- runner picks up research_status = 'new' and nothing else.
create or replace function inbound_set_company_relevant(p_company uuid, p_relevant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_relevant is null then
    raise exception 'relevant must be true or false';
  end if;

  update inbound_companies set
    research_status = case when p_relevant then 'new' else 'not_icp' end,
    -- Clearing the type on re-queue stops a stale not_icp verdict from
    -- contradicting the lane the row now sits in.
    account_type = case when p_relevant then null else account_type end,
    account_type_confidence = case when p_relevant then null else account_type_confidence end,
    -- One marker, replaced each time, so repeated clicks cannot stack prefixes.
    account_type_reason =
      (case when p_relevant then '[re-queued by hand]' else '[marked not relevant by hand]' end)
      || case when coalesce(regexp_replace(account_type_reason, '^\[[^\]]*\]\s*', ''), '') = ''
              then '' else ' ' || regexp_replace(account_type_reason, '^\[[^\]]*\]\s*', '') end,
    updated_at = now()
  where id = p_company;
  if not found then raise exception 'no such company'; end if;
end $$;

revoke all on function inbound_move_person(uuid, text) from public;
revoke all on function inbound_set_person_ready(uuid, boolean) from public;
revoke all on function inbound_set_company_relevant(uuid, boolean) from public;
grant execute on function inbound_move_person(uuid, text) to anon;
grant execute on function inbound_set_person_ready(uuid, boolean) to anon;
grant execute on function inbound_set_company_relevant(uuid, boolean) to anon;
