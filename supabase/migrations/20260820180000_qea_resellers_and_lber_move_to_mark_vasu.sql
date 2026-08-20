-- ============================================================
-- Tanay's two groups move to Mark Vasu.
--
-- Asked for by Tanay, 20 August 2026: his name off the campaigns, and everything
-- under it reassigned rather than blanked. An ownerless group is invisible to
-- the rep layer entirely — no avatar, no filter, no /calls roster entry — which
-- is the fault 20260818201502 exists to prevent, so "remove" here has to mean
-- "hand over", never "set null".
--
-- What moves:
--   QEA Resellers   13 campaigns   Denver/Boulder, Seattle, Chicago, LA
--   LBER — Boston    7 campaigns   Boston / Cambridge
--
-- Mark Vasu already owns Chicago Retrofit, so he ends up with three groups and
-- the rep list goes from four names to three. His subtitle changes from a
-- geography to "3 groups" on its own — `repList()` derives that from the count,
-- and there is nothing to update by hand.
--
-- This is not a cosmetic change to a label. `owner` is the only place this
-- database records who a campaign belongs to; every rep filter on the Overview,
-- /replies, /campaigns and /calls is derived from it. Measured immediately
-- before this ran, all time: the Tanay filter showed 22 responses and 12
-- interested — the lemlist groups, whose replies had only just been read and
-- labelled by 20260820160000. All of that arrives under Mark Vasu now, and the
-- all-reps totals do not move: 31 and 15 before, 31 and 15 after.
--
-- Keyed on the owner name rather than on group ids, so nothing generated is
-- hardcoded here and re-running it is a no-op once no group is owned by Tanay.
--
-- Written through `set_group_owner` rather than by UPDATE. It is the validating
-- path this schema already offers for exactly this column — it refuses a blank
-- name and it can touch nothing else — and using it keeps one way of changing an
-- owner rather than two.
-- ============================================================

select set_group_owner(id, 'Mark Vasu')
from campaign_groups
where owner = 'Tanay';

-- The one meeting Tanay typed in himself: Mark Attard, Point6, 28 July, held.
--
-- `logged_by` is provenance — who entered the record — and not ownership, so
-- this row's rep was never read from it. app/meetings/page.jsx:44 resolves a
-- meeting's rep as the owner of its group and only falls back to `logged_by`
-- when there is no group; this meeting sits in QEA Resellers, so it already
-- follows the line above.
--
-- It is updated anyway for two reasons. The meeting detail panel prints "Logged
-- by" on the face of the card, so leaving it would put the name back on screen
-- one click from the campaigns it was just removed from. And the fallback on
-- line 73 of app/page.jsx scopes an unattached meeting to whoever logged it — a
-- name that is no longer a rep can never match, so a future meeting logged under
-- a retired name would belong to nobody at all.
update meetings set logged_by = 'Mark Vasu' where logged_by = 'Tanay';
