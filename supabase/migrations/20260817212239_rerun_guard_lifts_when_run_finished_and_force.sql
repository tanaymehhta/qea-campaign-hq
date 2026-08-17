-- The live definition of `inbound_request_rerun`, after two refusals were found
-- to be wrong within an hour of the first one shipping.
--
-- It also carries the change applied minutes earlier as
-- `rerun_refuses_on_node_level_credit_errors` (20260817211639): that one has no
-- file of its own because this statement replaces the whole function, so a
-- separate file would only describe a definition nothing runs any more.
--
-- The three things this fixes, all found by pressing the button:
--
-- 1. The credit test read `inbound_graph_runs.error`, which is NULL for exactly
--    the failure it was looking for. A research run whose LLM nodes all 402
--    records status `needs_review` with no run-level error — the 402s live only
--    on `inbound_graph_node_events`. So the guard never fired, and a press on
--    17 August ran all three stages in 33 seconds, spent $0.70 on search, and
--    learnt nothing.
--
-- 2. "Already queued" counted ten minutes from the press rather than from the
--    work. The run asked for at 21:13 finished at 21:14, and the next press at
--    21:20 was still refused — the guard was protecting a request that had
--    already been served.
--
-- 3. The credit refusal could not see a top-up. A balance is not in this
--    database, so refusing for 24 hours on the last 402 locks out precisely the
--    person who has just filled the account. `p_force` is that person saying so
--    — the UI only offers it where the page has already named the empty account
--    — and it waives that one check. A run in flight still refuses, because
--    that is not a judgement call.

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
  -- have decided it is not what they wanted.
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

-- The three-argument signature is gone rather than left as an overload: two
-- functions of the same name, one of which silently skips the force parameter,
-- is how a caller ends up on the wrong one.
drop function if exists inbound_request_rerun(uuid, int, text);
