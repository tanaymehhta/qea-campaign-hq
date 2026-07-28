create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Store the invoke token in Vault rather than inlining it in the cron command.
-- The invoke token is redacted here. Set it once per environment:
--   select vault.create_secret('<your-anon-key>', 'SYNC_INVOKE_TOKEN', 'Bearer token used by pg_cron to invoke the sync edge function');
select vault.create_secret(
  '<SUPABASE_ANON_KEY>',
  'SYNC_INVOKE_TOKEN', 'Bearer token used by pg_cron to invoke the sync edge function');

create or replace function public.trigger_sync(p_mode text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  req_id bigint;
begin
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

-- Every 30 minutes: today + yesterday.
select cron.schedule('qea-sync-30min',  '*/30 * * * *', $$select public.trigger_sync('incremental')$$);

-- 03:00 America/New_York: last 14 days, plus sequence copy, step metrics and mailbox health.
select cron.schedule('qea-sync-nightly', '0 7 * * *',   $$select public.trigger_sync('nightly')$$);

-- Sunday 04:00 America/New_York: last 90 days, self-healing full re-pull.
select cron.schedule('qea-sync-weekly',  '0 8 * * 0',   $$select public.trigger_sync('weekly')$$);;