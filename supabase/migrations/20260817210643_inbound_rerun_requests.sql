-- The restart button's memory.
--
-- Without a row per request the button fires into the dark: the page cannot say
-- "already queued four minutes ago", and nothing stops a rep pressing it eleven
-- times while a runner is already working the account.
--
-- The row is a request, not a result. What actually happened is read from
-- inbound_graph_runs, because a run can finish `ok` having produced nothing —
-- a stage 2 whose reveals were all refused by the Apollo daily cap records ok
-- with no error. Reporting from this table would report that as success.
--
-- NOTE: `inbound_request_rerun` below is the first version. It was replaced
-- twice the same evening — see 20260817212239, which holds the live definition.
-- Both refusals it makes here were wrong in the same way, and the later file
-- says why.

create table if not exists inbound_rerun_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references inbound_companies(id) on delete cascade,
  -- 1 research, 2 people, 3 draft. Always runs through to the end from here.
  stage         smallint not null check (stage between 1 and 3),
  -- Null until there is a login. The dashboard has no session today, so a value
  -- here could only ever be a guess; the column exists so the answer has a home
  -- the day sign-in lands rather than a migration then.
  requested_by  text,
  requested_at  timestamptz not null default now(),
  github_run_id bigint,
  state         text not null default 'queued'
                check (state in ('queued', 'dispatched', 'abandoned'))
);

create index if not exists inbound_rerun_requests_company_idx
  on inbound_rerun_requests (company_id, requested_at desc);

alter table inbound_rerun_requests enable row level security;

-- Same shape as the other 35: readable, never writable except through the
-- security definer functions.
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

/**
 * Record what became of the request.
 *
 * 'abandoned' is what a failed dispatch writes, and it is why the ten-minute
 * guard ignores that state: GitHub refusing the POST must not lock the company
 * out of being retried immediately.
 */
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

-- anon is what the dashboard holds today. When sign-in lands and anon is
-- revoked across the schema, these two go with it — the grant to authenticated
-- is already here so that pass is a revoke and not a rewrite.
grant execute on function inbound_request_rerun(uuid, int, text)
  to anon, authenticated, service_role;
grant execute on function inbound_mark_rerun(uuid, text, bigint)
  to anon, authenticated, service_role;
