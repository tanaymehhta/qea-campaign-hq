-- The seed order has to be the order on screen, or the first click looks like a
-- shuffle: the company page leads with whoever actually visited the site and
-- only then falls back to the pipeline's priority. Seeding from priority alone
-- would renumber the list against what the reader is looking at.
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

  with ordered as (
    select p.id, row_number() over (
      order by
        -- visitors first, matching loadCompany's sort
        (not exists (select 1 from inbound_visits v where v.person_id = p.id)),
        coalesce(p.manual_rank, p.priority, 99),
        p.created_at, p.id) as rn
    from inbound_people p where p.company_id = v_company)
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

  if v_other_id is null then return; end if;

  update inbound_people set manual_rank = v_other where id = p_person;
  update inbound_people set manual_rank = v_me    where id = v_other_id;
end $$;
