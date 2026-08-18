create or replace function inbound_request_rerun(
  p_company uuid,
  p_stage   int,
  p_actor   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_last    inbound_graph_runs%rowtype;
  v_credit  text;
  v_pending timestamptz;
  v_id      uuid;
begin
  if p_stage is null or p_stage < 1 or p_stage > 3 then
    raise exception 'stage must be 1 (research), 2 (people) or 3 (draft)';
  end if;

  select name into v_name from inbound_companies where id = p_company;
  if v_name is null then raise exception 'no such company'; end if;

  if exists (
    select 1 from inbound_graph_runs
     where company_id = p_company and status = 'running'
       and started_at > now() - interval '2 hours'
  ) then
    raise exception '% is running right now — wait for it to finish', v_name;
  end if;

  select requested_at into v_pending
    from inbound_rerun_requests
   where company_id = p_company
     and state <> 'abandoned'
     and requested_at > now() - interval '10 minutes'
   order by requested_at desc limit 1;
  if v_pending is not null then
    raise exception 'already queued % ago',
      to_char(now() - v_pending, 'MI:SS');
  end if;

  select * into v_last from inbound_graph_runs
   where company_id = p_company
   order by started_at desc limit 1;

  if v_last.id is not null and v_last.started_at > now() - interval '24 hours' then
    select n.error into v_credit
      from inbound_graph_node_events n
      join inbound_graph_runs r on r.id = n.run_id
     where r.company_id = p_company
       and r.started_at >= v_last.started_at - interval '5 minutes'
       and (n.error ilike '%insufficient credit%' or n.error ilike '%402%')
     limit 1;

    if v_credit is null and v_last.error is not null
       and (v_last.error ilike '%insufficient credit%' or v_last.error ilike '%402%')
    then
      v_credit := v_last.error;
    end if;

    if v_credit is not null then
      raise exception 'the last run of % failed on %, which is out of credit — top it up, then press this again',
        v_name,
        case when v_credit ilike '%apollo%' then 'Apollo' else 'OpenRouter' end;
    end if;
  end if;

  insert into inbound_rerun_requests (company_id, stage, requested_by)
  values (p_company, p_stage, p_actor)
  returning id into v_id;

  return v_id;
end $$;

grant execute on function inbound_request_rerun(uuid, int, text)
  to anon, authenticated, service_role;
