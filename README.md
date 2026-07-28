# QEA Campaign HQ

Live outreach results across Instantly and lemlist, in one place.

## How it works

Two services, deliberately decoupled.

**Supabase** is the database, the sync job and the scheduler. A Deno edge function
(`supabase/functions/sync`) pulls both vendor APIs and upserts into Postgres. `pg_cron`
invokes it on three schedules: every 30 minutes (today + yesterday), nightly at 03:00 ET
(last 14 days, plus sequence copy, step metrics and mailbox health), and Sunday at 04:00 ET
(last 90 days, a self-healing full re-pull). Every write is an upsert keyed on
(campaign, date), so running twice equals running once and a missed run catches up on its own.

**Vercel** hosts this Next.js app, which only ever reads from Supabase. It never calls
Instantly or lemlist, so pages load instantly and no vendor rate limit can break the dashboard.

## Clicking through a number

Every figure on the dashboard is a link to the people behind it, at `/list?metric=…`,
scoped by `&group=` or `&campaign=` and by the same date window as the page you came
from. Page size is 25 / 50 / 100.

Two tables feed it, because the vendors expose two different shapes:

- `activities` — a dated event stream. lemlist timestamps every event, so its rows
  survive a date filter exactly. Instantly only reports a lead's *most recent* send,
  so its contribution is `sent` rows and nothing else.
- `people` — one row per person per campaign, with lifetime counters. Instantly will
  say a lead opened three times but never when, so opens and clicks can only be
  answered from here. When a date window is selected for one of those, the page says
  outright that it is showing the lifetime list rather than silently returning
  the wrong people.

`sent`, `bounced`, `linkedin_sent` and `linkedin_accepted` read the event stream.
`opened` and `clicked` read `people`. `contacted` is a first touch, keyed on
`people.first_contacted_at`. `replied`, `meetings` and `proposals` read their own
tables, which already hold a richer record.

lemlist's per-person counters are rebuilt by `refresh_lemlist_people()` after each
sync rather than accumulated in the loop: an incremental run only sees two days, and
upserting that would overwrite a lifetime count with a partial one.

## Leads

`leads` is a person-level table, one row per targeted contact across the priority campaign
lists (Resellers, LBER, Justin's Canada list, Hospitals — Canada, Chicago Retrofit). Unlike
everything else in this app, it isn't kept current by the sync job — it was a one-time import
from each campaign's source spreadsheet, with `status` (`prospect` / `assigned` / `sent` /
`held` / `no_email`) set by checking each person's email against Instantly/lemlist's actual
send/contact activity, not just campaign-roster membership or the spreadsheet's own claims.
Re-import by hand if a source list changes. Browse it at `/leads`.

## Data notes

- All dates are normalised to America/New_York.
- Instantly's lifetime analytics endpoint is authoritative and used as-is.
- lemlist's `/stats` endpoint is window-sensitive and disagrees with itself across windows, so
  only `leadTotal` is taken from it; every message metric is derived from the `/activities`
  event stream. This also surfaces replies that `/stats` under-reports.
- Reply counts are a floor. Replies sent outside the original sequence, and CC'd third-party
  replies, never appear in lemlist at all.
- Campaign grouping is auto-derived by splitting each campaign name on the first em dash.
  Any membership row marked `assignment_source = 'override'` is never touched by the sync.
- Opens and clicks are structurally low, not broken. Most campaigns run text-only with
  `open_tracking` and `link_tracking` off, which is a deliberate deliverability trade:
  a tracking pixel and rewritten redirect links both cost inbox placement in cold email.
  A campaign with tracking off cannot register an open or a click even in principle.
- A LinkedIn profile view is not a connection request, so `linkedinVisitDone` is no longer
  counted towards `linkedin_sent`.

## Environment

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both have hardcoded fallbacks
in `lib/db.js` — the anon key is a public read-only credential; every table is behind RLS with
a select-only policy and all writes go through the service role, which lives only inside the
edge function.

## Local

    npm install
    npm run dev
