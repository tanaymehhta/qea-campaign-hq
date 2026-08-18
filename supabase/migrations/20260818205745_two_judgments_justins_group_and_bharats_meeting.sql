-- Two decisions a query cannot make, both taken by Tanay on 18 Aug 2026.
--
-- ---------------------------------------------------------------------------
-- 1 · "Canada — Justin's list" is ended, and Instantly is what says so.
--
-- All eleven of its campaigns carry Instantly's own status `completed` - not
-- paused, not stopped by anyone. They finished: the lists ran out of people.
-- 1,504 sent, last send 14 Aug, 6 replies, one real conversation.
--
-- The typed word here is intent ("are we still investing in this"), which is
-- why the sync has never written it. It said `live` while the vendor said every
-- campaign was done. `actual_status` - what every page actually renders - has
-- read `ended` throughout, because it requires a campaign the vendor still
-- calls running and this group has none. So this changes nothing on any screen.
-- It clears the drift row on /health, which is the whole point of that row: it
-- exists to be answered, not to be lived with.
--
-- Deliberately NOT done: making the sync write this column from vendor status.
-- lber is the counter-example and it is in this database right now - typed
-- `ended` by a human, with one campaign Instantly still calls `running` that
-- last sent 27 days ago. Vendor status goes stale; the human was right. The
-- vendor already has the deciding vote in the direction that matters, because
-- zero running campaigns forces `ended` no matter how recently anything sent.
--
-- ---------------------------------------------------------------------------
-- 2 · Bharat Mudgal's meeting never got scheduled, so it is not a meeting.
--
-- The row was created 30 Jul with the note "placeholder date, Thu Aug 6 -
-- confirm and correct once scheduled". Nobody set that date because a meeting
-- was booked; it was a guess at "next week" from his 28 Jul reply. Twelve days
-- past its own placeholder it was still counting as booked in the headline KPI,
-- and it was one of only two meetings company-wide sitting at `booked`.
--
-- He is not being deleted, only re-classified as what he is. His 28 Jul reply
-- ("Do you have time next week?") is marked `interested` through classify_reply
-- in the same breath as this, so he reads as a live opportunity on /replies and
-- his person page rather than as a meeting that happened. If it is scheduled
-- later, log it then with a real date.
--
-- His other two replies (29 Jul, 4 Aug) stay unclassified on purpose. Both are
-- quoted-header fragments of this same thread, and `positive_replies` counts
-- reply rows with sentiment `interested` - labelling all three would count one
-- conversation three times in every positive-reply figure on the dashboard.
-- The label set has no word for "same thread, nothing new"; inventing one is a
-- bigger decision than this migration.

update campaign_groups
   set status = 'ended'
 where slug = 'qea';

delete from meetings
 where prospect_email = 'bharat.mudgal@ca.lactalis.com'
   and meeting_date = '2026-08-06'
   and status = 'booked';
