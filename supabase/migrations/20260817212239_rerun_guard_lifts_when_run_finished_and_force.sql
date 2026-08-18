create or replace function inbound_request_rerun(
  p_company uuid,
  p_stage   int,
  p_actor   text default null,
  p_force   boolean default false
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

  -- A press is only "already queued" while the work it asked for has not come
  -- back. Once a run started after the request has finished, the request is
  -- spent and the rep is entitled to ask again — they can see the result and
  -- have decided it is not what they wanted. Blocking on the clock alone
  -- refused a press seven minutes after its own run had finished.
  select r.requested_at into v_pending
    from inbound_rerun_requests r
   where r.company_id = p_company
     and r.state <> 'abandoned'
     and r.requested_at > now() - interval '10 minutes'
     and not exists (
       select 1 from inbound_graph_runs g
        where g.company_id = p_company
          and g.started_at >= r.requested_at
          and g.finished_at is not null
     )
   order by r.requested_at desc limit 1;
  if v_pending is not null then
    raise exception 'already queued % ago, and it has not come back yet',
      to_char(now() - v_pending, 'MI:SS');
  end if;

  -- Out of credit is an answer, not a failure — but only the caller knows
  -- whether the account has been topped up since, and no read here can see a
  -- balance. So this refuses once, names the account, and `p_force` is the
  -- rep saying they have dealt with it. The refusal informs; it does not
  -- overrule a human who knows more than the last run does.
  if not p_force then
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
        raise exception 'the last run of % failed on %, which was out of credit — top it up, then press Restart anyway',
          v_name,
          case when v_credit ilike '%apollo%' then 'Apollo' else 'OpenRouter' end;
      end if;
    end if;
  end if;

  insert into inbound_rerun_requests (company_id, stage, requested_by)
  values (p_company, p_stage, p_actor)
  returning id into v_id;

  return v_id;
end $$;

grant execute on function inbound_request_rerun(uuid, int, text, boolean)
  to anon, authenticated, service_role;

drop function if exists inbound_request_rerun(uuid, int, text);
