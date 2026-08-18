-- Delete the Ungrouped group.
--
-- It held exactly one campaign: "[AI SDR] QEA Technologies AI Sales Agent -
-- Fully Personalized Campaign", Instantly status `errored`, **0 emails sent**,
-- never started, auto-assigned on 28 Jul. Nothing else pointed at the group -
-- 0 meetings, 0 events, 0 proposals, 0 leads, measured before this ran.
--
-- Deleting the group row alone would not have worked. `regroup()` in the sync
-- files any campaign whose name has no em dash under a parent called
-- "Ungrouped" and creates that group if it is missing, so the group would have
-- come back within thirty minutes, freshly typed `live`. The sync now skips
-- hidden campaigns (deployed alongside this migration), which is why hiding the
-- campaign here is load-bearing and not cosmetic.
--
-- `hidden` is the product's existing word for "invisible to the dashboard": RLS
-- on campaigns, daily_metrics, campaign_totals, people and the rest already
-- filters on it for the anon role the app reads with. The row stays in the
-- table, so if Instantly ever repairs that campaign, un-hiding it is one
-- update and the group comes back on the next sync.
--
-- The permanent fix is to delete the campaign inside Instantly. Until someone
-- does, the sync re-creates the row every 30 minutes and only `hidden` keeps it
-- out of sight.

update campaigns
   set hidden = true
 where source = 'instantly'
   and name = '[AI SDR] QEA Technologies AI Sales Agent - Fully Personalized Campaign';

-- campaign_group_members.group_id is ON DELETE CASCADE, so the membership row
-- goes with the group. Named here so a reader does not have to look it up.
delete from campaign_groups where slug = 'ungrouped';
