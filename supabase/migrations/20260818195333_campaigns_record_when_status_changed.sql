-- "When did this campaign stop?" becomes answerable.
--
-- `campaigns.status_changed_at` has existed since the first migration and
-- **nothing has ever written to it**. It is NULL on all 43 rows. So the database
-- can say a campaign is paused and cannot say since when - which is the question
-- anyone actually asks when volume drops.
--
-- The sync upserts every campaign every 30 minutes, so this fires on the change
-- and not on the re-write: `is distinct from` rather than `<>`, because either
-- side can be NULL and `null <> 'running'` is null, not true.
--
-- No backfill is possible. There is no history anywhere in this database to
-- recover a past transition from - the sync keeps only the current status and
-- has never kept anything else. Every row stays NULL until its campaign next
-- changes state, and a NULL here means "not observed since this was added",
-- not "never changed". That distinction matters and there is no way to remove
-- it retroactively.
create or replace function public.campaigns_stamp_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists campaigns_stamp_status_change on campaigns;

create trigger campaigns_stamp_status_change
  before update on campaigns
  for each row
  execute function public.campaigns_stamp_status_change();
