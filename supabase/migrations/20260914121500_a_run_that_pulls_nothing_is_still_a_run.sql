-- ============================================================
-- A run that pulls nothing is still a run.
--
-- `mode=hubspot` pushes interested leads to HubSpot and calls Instantly not
-- once. It is how the push is exercised by hand, one named lead at a time,
-- before it rides the thirty-minute schedule.
--
-- It still opens a `sync_runs` row, because the point of that table is that
-- every invocation is accounted for. Without this the row was rejected by the
-- mode check and the run reported `partial` over a logging failure while the
-- work it was asked to do had succeeded — a false alarm, which is the kind of
-- alarm that teaches people to ignore alarms.
-- ============================================================

alter table public.sync_runs drop constraint sync_runs_mode_check;

alter table public.sync_runs add constraint sync_runs_mode_check
  check (mode = any (array['incremental','nightly','weekly','backfill','manual','hubspot']));
