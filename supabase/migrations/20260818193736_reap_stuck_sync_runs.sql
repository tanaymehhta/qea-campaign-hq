-- A run that died still says it is running, and nothing has ever cleaned up.
--
-- The sync writes a `running` row, does its work, then updates the row with a
-- final status. If the invocation dies in between - a crash, the wall clock, or
-- the 280 second pg_net timeout on trigger_sync - the closing update never
-- happens and the row stays `running` forever.
--
-- Measured 18 Aug: **one row, incremental, started 8 August 20:30 UTC, still
-- `running` ten days later**, rows_upserted 0, no error. /health lists the last
-- twelve runs, so it scrolled out of sight within a day and nobody could have
-- seen it. Every "is the sync alive" answer this dashboard gives has been
-- reading past it.
--
-- Thirty minutes is the threshold because the sync itself runs every thirty
-- minutes: a run still open when the next one is dispatched is finished, one way
-- or another. It cannot be a long-running job - trigger_sync gives up at 280
-- seconds.
--
-- The reap is called from trigger_sync rather than given its own cron entry, so
-- it happens exactly when it matters: immediately before a new run starts, which
-- is the moment a stale row would otherwise be mistaken for a live one. If the
-- sync stops being dispatched at all, nothing gets reaped - correctly, because
-- at that point the stuck row is not the problem worth reporting.
--
-- A reaped run that later comes back to life and writes its own final status
-- simply overwrites this; no harm either way.
create or replace function public.reap_stuck_sync_runs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update sync_runs
     set status      = 'error',
         finished_at = coalesce(finished_at, now()),
         error       = coalesce(
           error,
           format('no result after 30 minutes - the invocation died before it could '
                  || 'report. Reaped %s after it started.',
                  justify_interval(now() - started_at)))
   where status = 'running'
     and started_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.reap_stuck_sync_runs() from public, anon, authenticated;

-- trigger_sync, unchanged apart from the one added line. Reproduced from the
-- live definition rather than the original migration, so nothing applied to
-- production in between is silently reverted.
create or replace function public.trigger_sync(p_mode text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  req_id bigint;
begin
  -- Close out anything the last dispatch left open, before adding another.
  perform public.reap_stuck_sync_runs();

  select net.http_post(
    url     := 'https://yfnqszwlyoyfhuwfmcyl.supabase.co/functions/v1/sync?mode=' || p_mode,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || public.get_secret('SYNC_INVOKE_TOKEN')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 280000
  ) into req_id;
  return req_id;
end $$;

revoke all on function public.trigger_sync(text) from public, anon, authenticated;
