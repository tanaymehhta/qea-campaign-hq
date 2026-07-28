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

## Environment

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both have hardcoded fallbacks
in `lib/db.js` — the anon key is a public read-only credential; every table is behind RLS with
a select-only policy and all writes go through the service role, which lives only inside the
edge function.

## Local

    npm install
    npm run dev
