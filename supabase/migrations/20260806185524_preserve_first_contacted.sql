-- ============================================================
-- "Leads contacted" windows people on first_contacted_at and promises
-- first touch. The sync writes Instantly's timestamp_last_contact into
-- that column and the upsert overwrites it every 30 minutes, so the
-- metric partially measures follow-up flow. This trigger keeps the
-- earliest value no matter what any writer sends.
--
-- Known limitation, on purpose: Instantly never exposes historical
-- first-touch, so rows already overwritten stay wrong — there is
-- nothing to backfill from (activities holds only each Instantly
-- lead's most recent send, same vendor gap). The trigger only stops
-- further drift. lemlist rows are rebuilt from the activity stream
-- with a true minimum; least() is also correct for that path.
-- ============================================================

create or replace function public.preserve_first_contacted() returns trigger
language plpgsql
as $$
begin
  new.first_contacted_at := least(
    coalesce(old.first_contacted_at, new.first_contacted_at),
    coalesce(new.first_contacted_at, old.first_contacted_at));
  return new;
end $$;

drop trigger if exists people_preserve_first on public.people;
create trigger people_preserve_first before update on public.people
  for each row execute function public.preserve_first_contacted();
