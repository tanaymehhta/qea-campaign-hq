# Current state — 28 July 2026

Where the dashboard stands, what changed in this session, and what is still open.
`README.md` explains how the system works; this file records what is actually true right now.

---

## The one-line summary

Every number on the dashboard used to be a dead end. Now every number is a link to the
people behind it, and everything the two vendors disagree about surfaces on a Conflicts
tab for a person to settle rather than being guessed at silently.

---

## Design refresh — 29 July 2026

The Claude Design pass, applied to the live pages. Frontend only: no schema change, no
query rewritten except where a new control needed scoping.

- **Tokens and dark mode.** `app/globals.css` carries the full token set. Dark is opt-in via
  `[data-theme="dark"]` on `<html>`, toggled in the nav and remembered in `localStorage`;
  an inline script in `<head>` applies it before first paint. Untouched, the OS preference wins.
- **Nav** is a client component (`components/nav.jsx`) so it can mark the current page and
  hold the theme switch. Meetings joined it.
- **Rep picker.** Reps are derived from `campaign_groups.owner` — there is no rep table, and
  group level is the only place an owner is recorded. Selecting one scopes the Overview and
  Meetings pages, and `?rep=` carries into `/list` so a tile and the list behind it count the
  same people.
- **Overview tiles re-ordered** to the design's four-then-five: sent, contacted, replied,
  meetings on top; LinkedIn sent, LinkedIn accepted, bounced, opened, proposals below.
- **Meetings** is a new page: rep stats, one expandable row per meeting, and the replies that
  have not become one yet (matched by email against the meetings table).
- **Campaigns** is group cards with a delivered/bounced bar and a sort control
  (priority / reply rate / volume / bounce risk — worst sub-campaign, not the group average).
- Expand/collapse is native `<details>` throughout, so it works without JavaScript. The only
  JS on the page is the nav, the theme boot, and the count-up on figures — all decoration.

---

## The person hub — 29 July 2026

Every number opened onto a list of people, and every person in that list was a dead end.
`/person/[email]` closes it: one page per human, keyed on the address rather than the
campaign, holding their campaigns, their whole event stream, and every reply they sent.

- **Email is the key**, matched with `eq` on the lowercased address, not `ilike`. Twenty-nine
  addresses contain an underscore and `ilike` would read it as a wildcard. Nothing in
  `people` differs from its own lowercase, so `eq` is both correct and cheaper.
- **No tabs.** Only 24 of 1,898 people are in more than one campaign, and the average person
  has 1.6 recorded events. Sections stack, as they do on the campaign page.
- **Sibling duplicates are collapsed and labelled.** lemlist files one out-of-office against
  every campaign a person sits in, so Michael Kramer's two messages were six rows. The page
  shows two, names all three campaigns on each, and the Replied tile says
  "2 distinct messages, filed against 6 campaigns" rather than a 6 that matches nothing below.
- **Blank reply bodies say so.** Eighty of the ninety-eight lemlist replies carry a subject
  and a single space for a body. Both this page and `/replies` now name that instead of
  rendering an empty block.
- **Proposals are absent on purpose** — that table records a prospect name and no email, so
  there is no key to join a person on. Give it an email column and it belongs here.
- **Person names are links everywhere they appear**: the people tables, all four row shapes
  on `/list`, `/replies`, `/meetings`, `/leads`, `/conflicts` and the campaign page. A row
  with no email stays inert text rather than linking somewhere that cannot resolve — which
  is why neither of the two meetings links today: both have a null `prospect_email`.

No new CSS. Every class is one that already existed, so dark mode came free.

---

## What changed

### 1. The dashboard opens on All time

It used to default to Today. `windowFrom()` in `lib/db.js` now falls through to all time,
and Today is one of the range options rather than the landing state.

Knock-on: the nav item that said "Today" now says **Overview**, because it no longer
describes what the page shows. The wordmark "QEA Campaign HQ" links home.

### 2. Tiles re-ordered to follow the funnel

Emails sent → Leads contacted → LinkedIn requests sent → LinkedIn accepted → Emails
bounced → Emails opened → Emails replied → Meetings booked → Proposals sent.

**LinkedIn requests sent** is new on the front page. The data was already in
`daily_metrics.linkedin_sent`; it had simply never been surfaced.

Clicked came off the front page. It is structurally zero on most campaigns (see the
tracking note below) and now lives on the campaign detail pages.

### 3. Every figure is clickable

Both tile rows, every cell in the by-campaign table, and the totals on the campaigns
index. They all open `/list?metric=…`, scoped by `&group=` or `&campaign=`, carrying the
date window from the page you came from. Page size 25 / 50 / 100 with paging.

Campaign group pages and sub-campaign pages each gained an **Everyone in this campaign**
table — paginated, so a 946-person group loads instantly.

### 4. A person-level layer, because counts alone could never answer "who"

`daily_metrics` stores per-campaign per-day totals and nothing else. Two new tables:

| Table | What it holds | Rows now |
|---|---|---|
| `activities` | A dated event stream, one row per person per event | 2,607 |
| `people` | One row per person per campaign, lifetime counters | 1,935 |

The two vendors expose two different shapes and the code does not pretend otherwise:

- **lemlist** timestamps every event, so its rows filter by date exactly. The old sync
  already looped over every activity with the person's name attached and threw the human
  away, keeping only the count. It now keeps the row.
- **Instantly** reports lifetime per-lead counters but no per-event timestamps. It will
  say a lead opened three times and never say when. So it fills `people`, and contributes
  only `sent` to the event stream — the one thing it does timestamp
  (`status_summary.lastStep`).

Where a date window cannot be honoured, `/list` says so in a banner instead of quietly
returning the wrong people. That affects **Opened** and **Clicked** only.

### 5. Instantly replies now exist at all

The `replies` table was Instantly-blind. `syncInstantly` pulled campaigns, analytics,
steps, people and mailboxes but never inbound mail, so all 98 reply rows came from
lemlist. Instantly's daily analytics report *that* a reply happened without handing over
the message — which is why the reply count moved while the names never existed. This
predated the session's work; the drill-down just made the hole visible.

`/api/v2/emails?email_type=received` is the only endpoint that carries the person, the
subject and the body. It is now pulled every sync. **23 Instantly replies** imported
across April–July, including Bharat Mudgal's Lactalis reply.

Names and companies are not in that payload, so a `before insert` trigger on `replies`
fills them from `people`, matched on campaign and email.

### 6. Conflicts

Nothing in Instantly's payload marks a message as an auto-reply. `i_status` and
`ai_interest_value` are *interest* labels, so an unlabelled real reply is indistinguishable
from an out-of-office. The sync labels from the subject line and is honest that it is
guessing: it reconciles its labelling against Instantly's own per-day real/auto split, and
every disagreement surfaces on `/conflicts` with the messages listed.

`v_conflicts` is a **view, not a table**. A conflict is a fact about the current data, so it
appears when the data disagrees and disappears the moment it agrees. Nothing to mark
resolved, nothing that can sit there stale and wrong.

Two kinds today: `reply_split` (counts disagree) and `meeting_detail` (a meeting logged by
hand with no prospect name).

### 7. The first write path in the app

Everything else is read-only. Confirming a conflict goes through `classify_reply()` or
`record_meeting_detail()` — `security definer` functions that validate their own arguments.

Verified by test, not assumed:

| Test | Result |
|---|---|
| Valid label | `204`, row updated, stamped `classified_by = 'human'` |
| Invalid label `"hacked"` | rejected — `not a valid sentiment: hacked` |
| Nonexistent meeting id | rejected — `no meeting with id …` |
| Direct `PATCH` on `replies` with the public key | **zero rows changed**, RLS held |

A confirmed row is never overwritten by a later sync — the same guarantee
`assignment_source = 'override'` already gives campaign grouping.

### 8. Two data corrections

- **LinkedIn profile views were being counted as connection requests.**
  `linkedinVisitDone` was mapped to `linkedin_sent` alongside actual invites, inflating the
  figure. Removed. That number may now read lower than you remember; it is correct now.
- **Hospitals — Canada removed**, group and all 737 leads, as requested.
  Justin's list is untouched.

---

## Current data

| | Count |
|---|---|
| Campaigns | 42 |
| Campaign groups | 5 |
| People | 1,935 |
| Activity events | 2,607 |
| Replies | 121 (98 lemlist, 23 Instantly) |
| Leads (hand-imported) | 1,950 |
| Meetings | 2 |
| Proposals | 0 |
| Open conflicts | 2 |

**Groups:** Chicago Retrofit · QEA Resellers · LBER — Boston · Canada — Justin's list ·
Ungrouped.

Note that the group displayed as **"Canada — Justin's list" has slug `qea` and holds the
eleven live Instantly QEA campaigns** (P1–P5 F&B, Datacenter, Roofing, Referral). Grouping
is auto-derived from the campaign name up to the first em dash, so anything named `QEA — …`
lands there. Deleting that group would remove the main outreach from the dashboard.

---

## What the metrics actually mean

These four sound alike and are not. They are four different events at four different stages.

| Metric | What physically happened | How trustworthy |
|---|---|---|
| **Bounced** | The receiving server rejected it. It never reached a human — bad address, full mailbox, or the domain was blocked. | Certain. The server says so. Above 5%, stop and re-verify the list. |
| **Opened** | Their mail client loaded a 1×1 invisible tracking pixel. | Weak. Inflated by security scanners that open on the recipient's behalf; missed entirely by anyone with images off. |
| **Clicked** | They clicked a link inside the email body. | Strong — a deliberate act. But requires link tracking to be on. |
| **Replied** | They wrote back. | The only unambiguous signal. Out-of-office is counted separately as `replies_automatic` so it cannot inflate this. |

**Open and Click are not the same thing.** An open can be a corporate spam filter that no
human ever saw. A click is a person deciding to act. Passive and noisy versus active and real.

**Link tracking** is the setting that makes clicks measurable at all. With it on, every URL
is rewritten to route through a tracking redirect first. That is the cost: rewritten
redirect links in a plain-text cold email are a known spam signal. `link_tracking = true` on
the ten Chicago Retrofit campaigns, off on the eleven QEA text-only ones. Same reason
`open_tracking = false` on those eleven — they are text-only precisely to maximise inbox
placement, so two-thirds of the campaigns cannot record an open even in principle.

---

## Open items

1. **Jeffrey Hohenstein, 22 Jul** — `/conflicts`. Instantly counts it automatic, the subject
   heuristic read it as genuine. One click settles it.
2. **The 28 Jul meeting has no name.** One of the two logged meetings is blank — no
   prospect, no company. Only you know who it was.
3. **Proposals has never been used.** Zero rows, so the tile and its drill-down are empty
   by definition, not by fault.
4. **There is no way to log a meeting or a proposal from the dashboard.** The conflicts tab
   can fill in a meeting that already exists, but creating one still means a hand-written
   database row. Both are the primary KPI and both are hand-kept, so this is the most
   obvious next thing to build.

---

## Known limits and debt

Everything below is understood and deliberate or simply not yet done. None of it is a
mystery; it is written here so it does not get rediscovered as a bug in three months.

### Reply counts are inflated by sibling campaigns

**25 of the 121 replies are duplicates** — the same person, the same minute, logged against
two or three campaigns at once. It happens where a campaign was split into a main and a
referral variant: `QEA Resellers — Seattle` and `QEA Resellers — Seattle (Referral)` both
record the same out-of-office from `andy@a-rsolar.com`. lemlist genuinely files the event
against each campaign, so the rows are not wrong individually, but any total that sums
across campaigns counts that person more than once. Deduplicating on
(email, minute) at read time would fix the totals without losing the per-campaign truth.

### `leads` and `people` now overlap almost entirely

| | Distinct emails |
|---|---|
| `leads` (frozen, hand-imported) | 1,921 |
| `people` (live, synced every 30 min) | 1,898 |
| In both | **1,897** |
| Only in `leads` | 24 |
| Only in `people` | 1 |

`leads` was a one-time import from the source spreadsheets and does not update. `people` is
rebuilt from the vendors every sync. They now describe nearly the same humans, and `/leads`
and the campaign people tables show overlapping views of the same list. Worth collapsing
into one, with `leads` kept only for the 24 people never loaded into a tool.

### Hard caps in the sync

None are close to being hit, but they are silent when they are:

- **3,000 leads per campaign** (30 pages × 100) on the Instantly people pull.
- **40 pages** on the Unibox reply pull, and it stops early at the first message older than
  the window.
- **20,000 activities** per lemlist run.

### Timing

Instantly's daily analytics lag its own sending by a few minutes, so a send at 19:58 may
not appear in the 20:00 sync but will be there by 20:30. Upserts are keyed on
(campaign, date), so this corrects itself rather than double-counting.

### Opened and Clicked cannot be filtered by date

Neither vendor timestamps an open or a click, so `/list` shows the lifetime list for those
two and displays a banner saying so. This is a vendor limitation, not something to fix
locally.

### Casing

`people` is unique on `(campaign_id, email)` while `refresh_lemlist_people()` groups by
`lower(email)`. If the same address ever arrives in two different cases, they would land as
two rows. Not observed so far.

### Dead or unused

- **`events` table: 0 rows.** It has `is_flagged_conflict` and `resolved_at` columns that
  anticipated the conflicts feature; conflicts ended up as a view instead, so the table is
  still unused.
- **`app/timeline/` is an empty directory.** No page, no route. Safe to delete.
- **`ungrouped` group holds 1 campaign** — anything whose name has no em dash.
- **The `inbound_*` tables** (7 companies) live in the same Supabase project but belong to
  the separate inbound agent, not this dashboard.

### Deployment

The repo is **not linked to Vercel locally** — `vercel link` has never been run, so
`vercel env` and CLI deploys do not work from this checkout. Deploys happen from GitHub on
push to `main`. The Supabase side is deployed directly: migrations applied and the edge
function at version 4.

---

## Things worth remembering

**Opens and clicks are structurally low, not broken.** Most campaigns run text-only with
`open_tracking` and `link_tracking` off. That is a deliberate deliverability trade — a
tracking pixel and rewritten redirect links both cost inbox placement in cold email. A
campaign with tracking off cannot register an open or a click even in principle. Of the
Instantly campaigns, only the Chicago Retrofit ones have tracking on.

**Reply counts are a floor.** Replies sent outside the original sequence, and CC'd
third-party replies, never reach either tool.

**The sync is healthy and automatic.** Every 30 minutes for today and yesterday, 03:00 ET
nightly for 14 days plus sequence copy and mailboxes, 04:00 ET Sunday for 90 days. Every
write is an upsert, so a double run equals one run and a missed run heals itself. The
Instantly people-and-replies pull runs on every mode, not just the deep ones, so names
refresh every half hour.

**Security trade to revisit.** The site has no login, so anyone with the URL can confirm a
conflict — the same people who can already read every figure on it. To close that, add
`SUPABASE_SERVICE_ROLE_KEY` to the Vercel environment and point
`app/conflicts/actions.js` at it instead of the anon client. The database functions do not
change.

**The sync had no error, and never did.** When the Instantly replies looked missing, every
run was returning `status: ok` with `error: null` on schedule. It was not a failure, a
credential, a table or a broken foreign key — it was a code path that had never been
written. Worth remembering as a diagnostic habit: check whether the thing is failing before
assuming it is failing, because "the number moved but the names are absent" points at a
missing writer, not a broken one.

---

## Where things live

    app/page.jsx              overview, all-time by default, every tile a link
    app/list/page.jsx         the drill-down behind every number
    app/person/[email]/       one human, across every campaign
    app/conflicts/page.jsx    what only a person can settle
    app/conflicts/actions.js  the only two writes in the app
    app/campaigns/[slug]/     group page + everyone in the group
    app/c/[id]/               sub-campaign page + everyone in it
    lib/db.js                 METRICS registry, window/paging helpers
    components/ui.jsx         Tile, DrillCell, PeopleTable
    supabase/functions/sync/  the edge function, deployed at version 4

Migrations added this session:

    20260728232005_person_level_drilldowns.sql
    20260728232200_refresh_lemlist_people.sql
    20260728234500_conflicts_and_human_classification.sql

Commits:

    07533c3  Link the wordmark home, and stop calling the overview "Today"
    c86ffae  Lay conflicts out as messages, not table rows
    5e74082  Import Instantly replies, and let a person settle what the tools cannot
    c8197bd  Make every number on the dashboard open the people behind it
