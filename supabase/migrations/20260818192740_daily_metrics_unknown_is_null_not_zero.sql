-- Stop the table inventing measurements nobody took.
--
-- `daily_metrics` was written on day one, before either sync existed, as the
-- union of both vendors' vocabularies. Every metric column got `default 0`.
-- syncInstantly() names eleven of them, so the other four were filled in by
-- Postgres, and "we did not copy it" became indistinguishable from "it was
-- zero". That is how 5,623 Instantly emails reported a perfect 0% bounce rate
-- for a month: the number was plausible, so nobody asked.
--
-- This changes nothing on screen today. It is DDL: it governs future inserts and
-- leaves all 521 existing rows exactly as they are. What it buys is that the
-- *next* forgotten column shows up as an em dash the day it is forgotten,
-- instead of hiding as a believable zero for three weeks.
--
-- ---------------------------------------------------------------------------
-- The classification, measured on 18 Aug 2026 by counting non-zero rows per
-- vendor and reading both writers — syncInstantly (functions/sync/index.ts:249)
-- and refresh_lemlist_daily_metrics (20260730135341:40). Written down first, so
-- the migration follows from it rather than being reasoned out mid-flight.
--
--   column                instantly   lemlist    verdict
--   sent                  written     written    measured -> null when absent
--   contacted             written     written    measured -> null when absent
--   opened                written     written    measured -> null when absent
--   replied               written     written    measured -> null when absent
--   replies_automatic     written     written    measured -> null when absent
--   clicked               written     written    measured -> null when absent
--   bounced               MISSING     written    measured -> null when absent
--   new_leads_contacted   written     MISSING    measured -> null when absent
--   unique_opened         written     MISSING    measured -> null when absent
--   unique_replied        written     MISSING    measured -> null when absent
--   unique_clicked        written     MISSING    measured -> null when absent
--   delivered             MISSING     written    derived  -> nobody should store it
--   linkedin_sent         n/a         written    0 IS CORRECT - keep the default
--   linkedin_accepted     n/a         written    0 IS CORRECT - keep the default
--   opportunities         written     n/a        0 IS CORRECT - keep the default
--
-- Three findings in that table are not in TRUST.md, which lists only
-- `new_leads_contacted` on the lemlist side: the rebuild function also never
-- writes **unique_opened, unique_replied or unique_clicked**. Same bug, three
-- more instances, invisible for the same reason - no page displays them.
--
-- The bottom three rows are why this is not "null every zero". Instantly has no
-- LinkedIn, so its `linkedin_sent = 0` is a fact we know. Nulling it would print
-- "—" for a number we are certain of: a new lie pointing the other way.
--
-- `delivered` is sent - bounced. It is derived in v_daily_facts now and no page
-- reads the stored column - checked across app/, lib/ and every view. Its
-- default goes too, so nothing invents one; the column itself is left in place
-- because refresh_lemlist_daily_metrics still writes it and removing it is a
-- separate change with no user-visible payoff.
--
-- Verified before running: every column below is nullable, so dropping the
-- default cannot make an insert fail.
alter table daily_metrics alter column sent                drop default;
alter table daily_metrics alter column contacted           drop default;
alter table daily_metrics alter column new_leads_contacted drop default;
alter table daily_metrics alter column delivered           drop default;
alter table daily_metrics alter column bounced             drop default;
alter table daily_metrics alter column opened              drop default;
alter table daily_metrics alter column unique_opened       drop default;
alter table daily_metrics alter column replied             drop default;
alter table daily_metrics alter column unique_replied      drop default;
alter table daily_metrics alter column replies_automatic   drop default;
alter table daily_metrics alter column clicked             drop default;
alter table daily_metrics alter column unique_clicked      drop default;

-- linkedin_sent, linkedin_accepted and opportunities keep `default 0`
-- deliberately. See the table above.
