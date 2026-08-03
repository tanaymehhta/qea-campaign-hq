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

## Conflicts

`/conflicts` is everywhere the tools contradict themselves, or leave a gap only a person
can close. It is a **view, not a table** — a conflict is a fact about the current data, so
it appears when the data disagrees and disappears the moment it agrees. There is nothing to
mark as done and nothing that can sit there stale.

Two kinds today:

- **reply_split.** Instantly states, per campaign per day, how many inbound were real replies
  and how many were auto-replies. Nothing in its message payload marks an individual message
  as automatic — `i_status` and `ai_interest_value` are *interest* labels, so an unlabelled
  real reply is indistinguishable from an out-of-office. The sync guesses from the subject
  line and is honest that it is guessing: when that labelling and Instantly's own count
  disagree, the day surfaces here with every message listed for a person to settle.
- **meeting_detail.** A meeting logged by hand with no prospect name.

### How the dashboard writes

Reading is the bulk of this app, but it is no longer read-only: conflicts, calls and
feedback all write. Every one of them goes the same way, and the pattern is the point —
a `security definer` function that validates its own arguments, so a malformed or hostile
POST fails in the database rather than being trusted because it came from our own UI. RLS
still blocks direct writes to every table.

Confirming a conflict goes through
`classify_reply()` or `record_meeting_detail()` — `security definer` functions that validate
their own arguments: the label must be one of the six the schema allows, and the row must
already exist. Neither can insert, delete, or touch another table, and RLS still blocks
direct writes to `replies` and `meetings`. A confirmed row is stamped `classified_by = 'human'`
and the sync never overwrites it, the same guarantee `assignment_source = 'override'` gives
campaign grouping.

Note the trade: the site has no login, so anyone with the URL can confirm a conflict, just as
anyone with the URL can already read every figure. To lock that down, add a service-role key
to the Vercel environment and point `app/conflicts/actions.js` at it instead of the anon
client — the database functions stay exactly as they are.

## Calls

`/calls` is a phone-first workspace, four levels deep: names only → that rep's call lists →
the workspace → a contact expanded in place. The workspace holds the campaign context
(prose from a `summary_md` column, so it is edited in the database without a deploy),
metric tiles that each filter the list beneath them, and one row per **person** — not per
building. The source is 2,119 buildings but 1,252 people, and a rep dials the engineer who
carries 65 of them once, not 65 times. Sorted by follow-ups due, then buildings carried:
the top 32 engineers reach half the list.

**There is no second call table.** The Overview Calls tile reads `phone_calls`, and the
workspace writes the same rows — `phone_calls` gained `contact_id`, `rep` and
`callback_date` rather than gaining a sibling. Nothing to reconcile, no way for the two
pages to disagree.

Writes: `log_call`, `set_contact_dnc`, `restore_contact`, `update_contact_detail`
(whitelisted to phone / email / linkedin, and each edit writes an audit row naming who
changed what, when, and from what) and `set_callback`. `log_call` ignores an identical
call logged inside a minute, so a double-clicked submit cannot inflate a number the
company steers on.

Load it with `scripts/import_call_list.mjs`, which is re-runnable: it upserts on
`(call_campaign_id, source_key)` and lets the existing value win for anything a rep may
have corrected by hand, so a re-import fills blanks and never overwrites a number someone
earned on a call.

## Feedback

A folded box at the foot of every page, and `/feedback` to read what comes in. The page it
was sent from and the rep selected on it are taken from the `Referer` header on the POST,
so a report costs one sentence and nothing else — there is no "which page?" field to skip
or get wrong. Screenshots are optional and go to a Supabase Storage bucket (`feedback`,
images only, 5 MB each, enforced by the bucket) rather than into a column that would be
selected on every page load. Two states, `open` and `done`, because a suggestion box nobody
works through is worse than not having one.

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
- Instantly's daily analytics report *that* a reply happened but never hand over the message,
  so the person behind it comes from `/api/v2/emails` (the Unibox) instead. Until that was
  wired up the `replies` table was Instantly-blind: the count moved, the names never existed.
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
in `lib/db.js` — the anon key is public by design: every table is behind RLS with a
select-only policy, so it cannot write to one directly. The sync writes with the service
role, which lives only inside the edge function; the app's own writes go through the
validating functions described under Conflicts.

`lib/db.js` also pins every read to `cache: "no-store"`. Next's fetch cache would otherwise
store each PostgREST GET on disk and keep serving it after a write — which it did, silently,
until a call logged in `/calls` failed to appear on the page that logged it. Nothing this
database holds is safely cacheable: the sync rewrites it every 30 minutes.

## Local

    npm install
    npm run dev
