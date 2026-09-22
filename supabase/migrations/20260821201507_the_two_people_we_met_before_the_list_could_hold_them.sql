-- ============================================================
-- Catching up the two people we met before a meeting could put them on a list.
--
-- 20260821130000 made log_meeting write a `leads` row for somebody who is not
-- already in `people`. Two meetings were logged before it existed:
--
--   Baris Acar      baris@pacenpc.com            logged 18 Aug
--   Krishnan Gowri  kgowri@energy-solution.com   logged 19 Aug
--
-- Both are on /meetings, in neither `people` nor `leads`, and therefore on
-- nobody's lead list — which is precisely the failure that migration was
-- written to end. Everyone met since then is already handled by it, so this is
-- a one-off catch-up and not a mechanism.
--
-- Written exactly as log_meeting would write them today: source_list 'hand',
-- status 'prospect' (the meeting is the meeting; the status is a pipeline
-- column and does not get to say "we met"), and the group taken from the
-- meeting row rather than guessed. `on conflict do nothing` so re-running this
-- is a no-op.
-- ============================================================

insert into leads (source_list, source_file, group_id, campaign_id, name, email, company, status)
select distinct on (lower(m.prospect_email))
       'hand',
       nullif(trim(coalesce(m.logged_by, '')), ''),
       m.group_id,
       m.campaign_id,
       m.prospect_name,
       lower(trim(m.prospect_email)),
       m.company,
       'prospect'
from meetings m
where m.deleted_at is null
  and nullif(trim(coalesce(m.prospect_email, '')), '') is not null
  and not exists (select 1 from people p where lower(p.email) = lower(trim(m.prospect_email)))
  and not exists (select 1 from leads l  where lower(l.email) = lower(trim(m.prospect_email)))
order by lower(m.prospect_email), m.created_at
on conflict (source_list, email) do nothing;
