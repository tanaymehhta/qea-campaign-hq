# Current state — 28 July 2026

Where the dashboard stands, what changed in this session, and what is still open.
`README.md` explains how the system works; this file records what is actually true right now.

---

## The one-line summary

Every number on the dashboard used to be a dead end. Now every number is a link to the
people behind it, and everything the two vendors disagree about surfaces on a Conflicts
tab for a person to settle rather than being guessed at silently.

---

## Contact stages — the funnel, per person — 6 August 2026

Each contact in the Calls workspace now shows **where they are in the funnel** and
**how they got there**, both derived — never typed in, so neither can disagree with
what was actually logged.

**The stage strip.** A six-rung strip at the top of every expanded contact:
`New → Attempted → Connected → Meeting → Proposal → Closed`. The filled rungs are the
ones the history reaches, each dated; the current rung is ringed; a Closed node reads
green for Won, crimson for Lost. `stageOf()` in `lib/calls.js` computes the rung as the
furthest point the touches prove — a later follow-up never drags someone back a stage,
and Won/Lost are terminal ("then ended"). The contact's summary pill now shows this
stage instead of the last raw call outcome.

**The Journey timeline.** Beneath it, every touch oldest-first — phone calls *and*
matched email replies in one stream (`timelineFor()` merges them; `repliesForContacts()`
joins the email world by address, the only link there is between the two worlds). This is
the narrative the strip summarises; the editable history table stays below it for
corrections.

**Two new signals a call log couldn't hold.** `phone_calls` becomes the one per-contact
activity log it already half was: a `channel` column (`phone`/`email`/`proposal`/`system`,
defaulting to phone so every existing row's meaning is unchanged) and four new outcomes —
`email_sent`, `proposal_sent`, `won`, `lost`. Reps set the last four from an **Advance the
deal** button row. Still no second table: the timeline, the strip and the Overview Calls
tile all read the same `phone_calls`, so nothing new to reconcile. `log_call` gained a
`p_channel` argument (the 6-arg signature is dropped); `edit_call` accepts the widened
outcome set so a stage marker can still be corrected.

**Cleanup.** The call-outcome list lived in three places that had to be kept in sync by
hand; it now has one home (`CALL_OUTCOMES` / `OUTCOME_PRIORITY` / `ACTIVITY_LABEL` in
`lib/calls.js`), imported by `actions.js` and the workspace page.

Migration: `20260807120000_contact_stages.sql`. **Not yet applied to production** — the
schema change (new column, widened enum, function replacements) needs to run against
Supabase before the UI has data to read; run it and reload the workspace to see the
strips populate.

Open: outbound *sent* emails still aren't in Postgres (lemlist owns them), so "email 1
sent" to a specific person only appears when a rep logs it via **Log email sent** or when a
*reply* comes back; inbound replies are matched best-effort by address. `edit_call` /
`delete_call` still don't retro-touch a `booked_meeting`'s `meetings` row — unchanged, and
noted here so it isn't mistaken for new.

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

## The Calls section — 3 August 2026

A phone-first workspace at `/calls`, built for Campaign 02 (NYC LL11 SAFE / Reliable).
Four levels: `/calls` is names only — clicking a name is how you say who you are, the
same no-login contract as `?rep=` elsewhere; `/calls/[rep]` is that rep's call lists as
cards; `/calls/[rep]/[campaign]` is the workspace — Context prose from a `summary_md`
column (editable in the database, no deploy), call-metric tiles that each filter the
list beneath them, and one `<details>` row per **person**. Not per building: the source
is 2,119 buildings but 1,252 people, and a rep dials Christopher Krepcio once.

- **No second call table.** The Overview Calls tile reads `phone_calls`; the workspace
  writes the same rows. `phone_calls` gained `contact_id`, `rep` and `callback_date`;
  `campaign_label` stays free text and existing rows are untouched.
- **Three new tables** — `call_campaigns`, `call_contacts` (buildings carried as jsonb,
  `best_rank`, `dnc`, `callback_date`), `call_contact_edits` (audit trail for
  hand-corrected phone/email/linkedin: who changed what, when, from what).
- **Four new writes**, all `security definer` functions mirroring `classify_reply()`:
  `log_call`, `set_contact_dnc`, `update_contact_detail` (whitelisted to
  phone/email/linkedin, writes the audit row), `set_callback`. Verified by test, not
  assumed:

  | Test | Result |
  |---|---|
  | Valid `log_call` | row in `phone_calls` with contact_id, rep, campaign label, callback |
  | Invalid outcome `"hacked"` | rejected — `not a valid outcome: hacked` |
  | Nonexistent contact id | rejected — `no contact with id …` |
  | Non-whitelisted field `"dnc"` | rejected — `not an editable field: dnc` |
  | Valid detail edit | new phone saved **and** audit row with old value + rep |
  | Blank DNC reason | rejected — `a do-not-call needs a reason` |
  | Direct `PATCH` / `INSERT` with the anon key | **zero rows changed**, RLS held |

  Test fixtures were deleted afterwards; the list carries no synthetic calls.
- **Ordering is the strategy.** Follow-ups due today or earlier sort first with a
  marker; beneath them, buildings carried descending — the top 32 engineers reach 50%
  of the buildings. Default view filters to people with a phone or email (only 63 of
  1,252 have either yet), with a toggle for the rest.
- **Import** is `scripts/import_call_list.mjs` (re-runnable; upserts on
  `(call_campaign_id, source_key)`; hand-edited details and dnc/callback state survive
  a re-run — verified by running it twice: second run reported all 1,252 already
  existed, counts unchanged). No service key was available locally, so writes went
  through a token-guarded `import-call-list` edge function (which holds the key
  server-side); it is now a `410` tombstone. The script also supports `EMIT_SQL=<dir>`
  and a local `SUPABASE_SERVICE_ROLE_KEY` for future runs. Reconciliation against
  `data/Campaign02_SAFE_Reliable_2119.xlsx`, confirmed row-for-row in Postgres:
  2,119 ranked rows → **1,252 contacts (253 engineers, 999 owners)** — matching the
  source README exactly — 48 buildings skipped (no name on either channel), 44 with
  phone, 61 with email, 63 dialable, 5 NYCHA names tagged `dnc` (README says 4: two are
  `lic`-token variants of Morrison and Patel that whitespace normalization cannot
  collapse), buildings covered 2,071 engineer-channel / 2,067 owner.
- `xlsx` added as a devDependency for the script only; no page imports it.

Migration applied and import run against production on 3 August; the pages render 63
dialable people, Christopher Krepcio (65 buildings) at the top.

**Open:** the engineer referral script seeded into `summary_md`
(`data/campaign02_summary.md`) is a first draft, untested on a real call; only 63 of
1,252 people are dialable until the free name harvest and enrichment wave run.

---

## Calls, end-to-end tested — 3 August 2026

The Calls section was exercised against production the way a rep would: real form
POSTs through the server actions, not RPC calls made to look like them. The write path
held on every probe. The **read** path did not, and the way it failed was the dangerous
kind — silent, and only on the pages actually being used.

### The stale-read bug

Log a call and the Overview tile moved from 3 to 4. The workspace the rep was standing
in still said 3. So did the roster and the rep page. A phone number saved mid-call did
not appear on the row. The call was always really in the database; the page was showing
a saved copy.

Two causes, both now fixed in one place each:

- **Next was caching every PostgREST GET on disk** (`.next/cache/fetch-cache`) and
  serving it after writes. It survived a server restart, which is what ruled out the
  obvious explanations. `force-dynamic` does not prevent it. Only `/` and `/meetings`
  looked live, because `app/calls/actions.js` explicitly revalidates exactly those two
  paths. The fix is one option on the shared client in `lib/db.js` —
  `global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) }` — which
  covers every page, not just Calls. **This affected the whole dashboard**, not only the
  new section: the sync job writes every 30 minutes and any page could serve a stale
  copy of that too.
- **`revalidatePath` was being handed an encoded path.** The form carries
  `/calls/Mark%20Vasu/…`; `revalidatePath` matches real pathnames, so it looked for a
  page by that literal name, found nothing, and silently did nothing. Decoded.

Worth remembering as a habit: when one page updates and another does not, the
difference between them is the clue. Here it was which paths someone had remembered to
revalidate.

### Four gaps found by testing, all closed

| Gap | What it cost | Fix |
|---|---|---|
| Double-submit logged the call twice | The Overview tile counts calls, so a misclick inflated a steering number — and the stale page above was actively training people to click again | `log_call` ignores an identical (contact, date, outcome, note) inside one minute. A different note still lands. |
| Do-not-call was one-way | A misclick removed a contact from the working list until someone wrote SQL | `restore_contact()` + a "Put back on the list" button, audited in `call_contact_edits` like any other correction |
| Every rejected write was a crash screen | The database raised a readable sentence; the rep saw a stack trace | Writes end in a redirect carrying the message. `?open=<contact>` reopens the row so logging a call no longer collapses the person you are on the phone with, and a reload never re-posts. |
| Any text saved as a phone number | The whitelist checked *which* field, never *what* | Loose shape check: seven digits for a phone, an `@` and a dot for an email. `(718) 445-9200 x12` and `+16462620425` both pass. |

Verified after the change, against production:

| Test | Result |
|---|---|
| Three identical submits, seconds apart | **one** row |
| Same contact, different note | second row, as intended |
| Retire → restore | `dnc` cleared, both directions in the audit trail |
| `asdf` as a phone / `notanemail` as an email | refused, message shown in a banner, no crash |
| Invalid outcome, missing date, bogus contact, `full_name` as a field, `phone", dnc=true --` injection, blank DNC reason | all refused in Postgres, **zero rows written** |
| Direct insert / update / delete with the anon key | refused or matched nothing; RLS held |

### Checked and deliberately left alone

- **Latency after removing the cache.** Every page now really queries on every render.
  Worst is `/leads` and the rep page at ~0.8s; the workspace is ~0.5s. The one slow view
  is "never called, show everyone" at 1.8s — 1,246 rows behind a deliberate opt-in click.
- **The import does not clobber hand-edits.** `old?.phone ?? c.phone`, `dnc` OR'd,
  `callback_date` preserved. Re-verified by dry run: still reconciles to the source
  exactly (1,252 contacts, 253 engineers, 999 owners, 44 phone, 61 email, 63 dialable).
- **Indexes.** The unique key on `(call_campaign_id, source_key)` already covers contact
  lookups. `phone_calls.contact_id` is unindexed and that is fine at a few thousand calls.
- **Supabase security advisors.** Every warning is this app's deliberate design — no
  login, so writes go through validating `security definer` functions. Changing them
  would break the thing that makes it safe.

Test fixtures were removed afterwards and the numbers put back to the import's own
reconciliation (3 calls, 0 edits, 5 dnc, 44 phone, 61 email, 63 dialable). One real
phone number was nulled during cleanup and restored from the source workbook.

---

## Feedback — 3 August 2026

A folded box at the foot of **every page**, and `/feedback` to read what comes in. Built
so that noticing something and saying it are the same moment: the box is already on the
page you are complaining about.

- **Nothing to fill in but the sentence.** The page and the selected rep are read from
  the `Referer` header on the POST, so a report from `/inboxes?rep=Mark Vasu` files
  itself as exactly that. No "which page?" field for anyone to skip or get wrong. Each
  item links back to where it was written.
- **Screenshots go to a Storage bucket**, not a column — 2 MB of PNG does not belong in
  a row selected on every page load. `feedback` bucket, public read, **images only, 5 MB
  each, enforced by storage rather than by us remembering to check**.
- **One table, two states.** `feedback` (page, rep, body, screenshot path, status,
  created_at) with `open` / `done`, one click between them, and the open count on a tile
  at the top where it nags. A suggestion box nobody reads is worse than none.
- **Writes are `submit_feedback()` and `set_feedback_status()`** — same validating
  `security definer` pattern as everything else here.
- **Native, per DESIGN.md.** A `<details>` and a plain file input; no new client
  component. Screenshots attach by file, not paste — paste would need JavaScript. On a
  Mac, `Cmd+Shift+4` saves to the Desktop and you pick it.

Verified: box renders on all ten pages; text + PNG from `/inboxes?rep=Mark Vasu` saved
with page and rep captured automatically and the image publicly served; empty body,
5,001 characters, a 6 MB file and a `.txt` renamed as an image all refused with a
readable sentence and **no junk row or file left behind**; mark done / reopen works;
invalid status and bogus id refused. One bug found and fixed during testing: a valid
screenshot with an invalid body used to upload the file and *then* reject the row,
orphaning it — the text is now checked first.

**Known limits.** The anon key is what uploads, the same trust model as every other
write here; the bucket's own mime and size limits are what bound it. If it is ever
abused, move the upload behind a token-guarded edge function holding the service key,
the way `import-call-list` already did. There is no delete in the UI, so a screenshot
can only be orphaned by deleting a row by hand in SQL — one test PNG in the bucket is
exactly that, and can be removed from the Supabase dashboard.

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

## Seven shadow campaigns hidden — 29 July 2026

Seven lemlist campaigns sat in draft having sent nothing: two named
`QEA Resellers — Chicago`, two named `QEA Resellers — Seattle`, and one each for
Denver / Boulder, LA and LBER BEUDO Batch 2. The campaigns that actually send are the
`(Referral)` ones, which are running.

They held nothing of their own. All 39 replies filed against them had a twin filed against
a live campaign in the same minute, and not one of their 24 people existed only there.
What they did was inflate every total that sums across campaigns, and put two identically
named rows on a person's page.

**They were the entire source of the duplicate-reply problem.** Of the 88 replies now
visible, zero are duplicates on (email, minute). The read-time deduplication this file
used to call for is not needed.

`campaigns.hidden` is how they stay gone. Deleting the rows would not have held — the
lemlist sync upserts every campaign the vendor lists, keyed on
`(source, source_campaign_id)`, so they would have returned within the half hour. The
upsert names its columns and `hidden` is not one of them, so the flag survives a re-sync.

The filter is applied in two places, because the app reaches the data both ways:

- **The views** carry `where not c.hidden` by hand. A view runs as its owner and so ignores
  row security; writing the filter into `v_campaign_summary`, `v_daily_totals` and
  `v_group_daily` is the only way it applies there. `v_group_summary` reads
  `v_campaign_summary` and inherits it.
- **Row security** covers every direct table read — `campaigns`, `people`, `activities`,
  `replies`, `meetings`, `daily_metrics`, `proposals`, `campaign_group_members`. This is
  the part that matters: no query in the app, present or future, has to remember the rule.

The test is `is_hidden_campaign()`, a `security definer` function, and it has to be. A plain
`not exists (select 1 from campaigns …)` inside a policy runs as the querying role, which
by then cannot see hidden campaigns either — so the check would come back true for
everything and filter nothing. The function reads the table as its owner, outside row
security, which is the only way to ask the question honestly.

The sync writes as the service role, which row security does not apply to, so a hidden
campaign still syncs. It is simply never read. To bring one back:
`update campaigns set hidden = false where source_campaign_id = '…'`.

Visible after the change: 35 campaigns, 1,898 people, 2,826 activities, 88 replies.

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
| Campaigns | 35 visible (42 synced, 7 hidden) |
| Campaign groups | 5 |
| People | 1,898 |
| Activity events | 2,826 |
| Replies | 88 (59 lemlist, 29 Instantly), no duplicates |
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
    app/calls/                the phone workspace, four levels deep
    app/feedback/             what the team has asked for, and the writes behind it
    components/feedback.jsx   the box at the foot of every page
    lib/db.js                 METRICS registry, window/paging helpers, the no-store client
    components/ui.jsx         Tile, DrillCell, PeopleTable
    supabase/functions/sync/  the edge function, deployed at version 4

Migrations added this session:

    20260728232005_person_level_drilldowns.sql
    20260728232200_refresh_lemlist_people.sql
    20260728234500_conflicts_and_human_classification.sql
    20260729110000_hide_shadow_draft_campaigns.sql
    20260803120000_call_campaigns_workspace.sql
    20260803160000_calls_hardening.sql
    20260803170000_feedback.sql
    20260807120000_contact_stages.sql

Commits:

    07533c3  Link the wordmark home, and stop calling the overview "Today"
    c86ffae  Lay conflicts out as messages, not table rows
    5e74082  Import Instantly replies, and let a person settle what the tools cannot
    c8197bd  Make every number on the dashboard open the people behind it
