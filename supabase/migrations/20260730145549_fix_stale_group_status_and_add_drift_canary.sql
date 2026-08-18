-- Justin's list has been sending since Jul 28 (11/11 campaigns running,
-- 645 sent) but was hand-labelled 'planned' at setup and nothing ever
-- revisited it — campaign_groups.status is a one-time manual field, never
-- touched again by the sync.
update campaign_groups set status = 'live' where slug = 'qea';

-- A narrow canary, not a full auto-derivation: flags only the unambiguous
-- case (a group marked planned/abandoned that is actually running or has
-- sent mail) rather than trying to algorithmically judge fuzzier states
-- like "one stale campaign still flagged running in a wound-down group" —
-- that call stays human. Catches the exact mistake that sat unnoticed here.
create or replace view v_group_status_drift as
select g.id, g.slug, g.display_name, g.status as stored_status,
       v.running_count, v.campaign_count, v.first_sent_on, v.sent
from campaign_groups g
join v_group_summary v on v.id = g.id
where g.status in ('planned', 'abandoned')
  and (v.running_count > 0 or v.sent > 0);

grant select on v_group_status_drift to anon, authenticated;
