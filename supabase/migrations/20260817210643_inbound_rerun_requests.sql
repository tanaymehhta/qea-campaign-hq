create table if not exists inbound_rerun_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references inbound_companies(id) on delete cascade,
  stage         smallint not null check (stage between 1 and 3),
  requested_by  text,
  requested_at  timestamptz not null default now(),
  github_run_id bigint,
  state         text not null default 'queued'
                check (state in ('queued', 'dispatched', 'abandoned'))
);

create index if not exists inbound_rerun_requests_company_idx
  on inbound_rerun_requests (company_id, requested_at desc);

alter table inbound_rerun_requests enable row level security;

drop policy if exists "public read" on inbound_rerun_requests;
create policy "public read" on inbound_rerun_requests for select using (true);

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
  if v_last.error is not null
     and v_last.started_at > now() - interval '24 hours'
     and (v_last.error ilike '%insufficient credit%' or v_last.error ilike '%402%')
  then
    raise exception '% last failed on %, which is out of credit — top it up first',
      v_name,
      case when v_last.error ilike '%apollo%' then 'Apollo' else 'OpenRouter' end;
  end if;

  insert into inbound_rerun_requests (company_id, stage, requested_by)
  values (p_company, p_stage, p_actor)
  returning id into v_id;

  return v_id;
end $$;

create or replace function inbound_mark_rerun(
  p_request uuid,
  p_state   text,
  p_run_id  bigint default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('dispatched', 'abandoned') then
    raise exception 'state must be dispatched or abandoned';
  end if;
  update inbound_rerun_requests
     set state = p_state,
         github_run_id = coalesce(p_run_id, github_run_id)
   where id = p_request;
  if not found then raise exception 'no such request'; end if;
end $$;

grant execute on function inbound_request_rerun(uuid, int, text)
  to anon, authenticated, service_role;
grant execute on function inbound_mark_rerun(uuid, text, bigint)
  to anon, authenticated, service_role;
