# Current state — 28 July 2026

Where the dashboard stands, what changed in this session, and what is still open.
`README.md` explains how the system works; this file records what is actually true right now.

---

## The one-line summary

Every number on the dashboard used to be a dead end. Now every number is a link to the
people behind it, and everything the two vendors disagree about surfaces on a Conflicts
tab for a person to settle rather than being guessed at silently.

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

## Open items

1. **Jeffrey Hohenstein, 22 Jul** — `/conflicts`. Instantly counts it automatic, the subject
   heuristic read it as genuine. One click settles it.
2. **The 28 Jul meeting has no name.** One of the two logged meetings is blank — no
   prospect, no company. Only you know who it was.
3. **Proposals has never been used.** Zero rows, so the tile and its drill-down are empty
   by definition, not by fault.

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

---

## Where things live

    app/page.jsx              overview, all-time by default, every tile a link
    app/list/page.jsx         the drill-down behind every number
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
