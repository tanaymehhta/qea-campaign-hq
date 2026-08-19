# Can the numbers be trusted — 18 August 2026

A provenance review of every figure on this dashboard: where it comes from, what it
actually counts, which ones are wrong, and why.

`README.md` explains how the system is meant to work. `STATE.md` records what was built
and when. **This file records what is true about the data right now, and how it got that
way.** If you are a new agent picking this up, read this file before touching a number.

Every figure below was read out of the live Supabase project (`yfnqszwlyoyfhuwfmcyl`) on
18 August 2026, not inferred from code. Where something is inference rather than
measurement, it says so in the line.

---

## Contents

1. [The one-page verdict](#1-the-one-page-verdict)
2. [The architecture, from first principles](#2-the-architecture-from-first-principles)
3. [The root cause, in one line of schema](#3-the-root-cause-in-one-line-of-schema)
4. [The mirrored bug](#4-the-mirrored-bug)
5. [Findings, worst first](#5-findings-worst-first)
6. [Every variable and how it updates](#6-every-variable-and-how-it-updates)
7. [Campaign lifecycle — born, kept, ended](#7-campaign-lifecycle--born-kept-ended)
8. [The other two systems: calls and inbound](#8-the-other-two-systems-calls-and-inbound)
9. [Decided, so it need not be re-argued](#9-decided-so-it-need-not-be-re-argued)
10. [Genuinely unknown](#10-genuinely-unknown)
11. [The work, in order](#11-the-work-in-order)
12. [How to verify any of this yourself](#12-how-to-verify-any-of-this-yourself)
13. [Live counts as of this review](#13-live-counts-as-of-this-review)

---

## 1. The one-page verdict

**The sync is not broken.** 1,037 of 1,040 runs finished `ok`. Every campaign synced at
15:00 today. No credential is stale, no job has stopped, no API call is failing. That
entire category of explanation is empty and should not be re-investigated.

**What is broken is that the same word means different things on different pages, and no
page says which one it is showing you.**

| Trust level | Figures |
|---|---|
| **Trust it** | Emails sent · Opened · Clicked · Replied (the count) · Leads · Campaign status · Daily limits · Tracking flags · Sender mailboxes · Sequence copy · Warmup scores · Per-mailbox daily sends |
| **Do not trust it** | **Bounced** and **Delivered** on the Overview, and the Bounce % derived from them. Every Instantly campaign reads a perfect 0% bounce rate on the homepage and a real one two clicks away. |
| **Trust as a floor only** | **Meetings** (4 recorded, 6 real) · **Proposals** (0 ever) · **Positive replies** (1, against 40 replies nobody has read) |
| **Read the label again** | **Leads contacted** (Instantly only — 554 lemlist people invisible) · **Emails replied** drill-down (includes out-of-office; the tile does not) · **Reply %** (denominator is *leads loaded*, not *emails sent*) |
| **Not results at all** | Everything under `/inbound`. 835 drafts exist. **Zero have ever been emailed**, including the 21 whose status column literally reads `sent`. |

**Rule of thumb for a human reading the dashboard today:** when the Overview and a
campaign page disagree, **believe the campaign page**. It reads the vendor's own
authoritative lifetime figures. The Overview reads a table with holes in it.

---

## 2. The architecture, from first principles

### There is no single source of truth. There are three.

This is the thing to understand before anything else makes sense. Three tables hold
overlapping copies of the same facts. They were built at different times for different
reasons, and — critically — **they are not calculated from each other.**

Think of them as three notebooks.

**Notebook 1 — the diary.** `daily_metrics`. One row per campaign per day.
> *Tuesday, Chicago Retrofit: sent 300, opened 12, replied 1.*

**Notebook 2 — the running total.** `campaign_totals`. One row per campaign, no dates.
> *Chicago Retrofit, since the beginning: 3,574 sent, 48 bounced, 215 leads.*

**Notebook 3 — the address book.** `people`, `activities`, `replies`, `meetings`.
One row per human, or per event.
> *Ravi Menon, ravi@acme.com, bounced, last contacted 22 July.*

And here is the part that produces every disagreement on the dashboard:

| Page | Reads |
|---|---|
| `/` Overview, the daily chart, the by-campaign table | **Notebook 1 only** |
| `/campaigns`, `/campaigns/[slug]`, `/c/[id]`, `/health`, `/meetings` | **Notebook 2 only** |
| `/list` (every drill-down), `/person/[email]`, `/replies` | **Notebook 3 only** |

No page tells you which notebook it read. They all print the same words.

### Why three copies exist, and why it is not stupid

The vendors expose their data in different shapes. Instantly will give you a **lifetime
total per campaign** from one endpoint, and a **day-by-day breakdown** from a completely
different endpoint. They are separate downloads returning separate numbers. If you want
both "all time" and "last 7 days" on the same dashboard, you have to store both.

That is a defensible design. The failure is that once you own two copies of a fact,
**nothing keeps them in step unless you write something that does.**

### The asymmetry that explains everything

Someone on this project already hit this problem — with lemlist — and fixed it properly.

lemlist's `/stats` endpoint was found to disagree with itself across date windows. The
fix, recorded in `20260728153344_derive_lemlist_totals.sql` with its reasoning attached,
was a rule:

> **For lemlist, only the activity stream is truth. Every other number is derived from it.**

So `refresh_lemlist_daily_metrics()` rebuilds Notebook 1 from the event stream, and
`refresh_lemlist_totals()` rebuilds Notebook 2 by summing Notebook 1. One source,
everything computed downstream.

**That rule was never extended to Instantly** — because Instantly's lifetime endpoint
looked reliable, so nobody saw the need. Instantly still keeps three independent
downloads.

| | lemlist | Instantly |
|---|---|---|
| Sources of truth | **one** (the activity stream) | **three** (three endpoints) |
| Everything else | derived from it in SQL | downloaded separately |
| Can the pages disagree? | **no, structurally** | yes, and they do |

This is the honest one-line architectural diagnosis:

> **Half the dashboard has one source of truth and is internally consistent. The other
> half has three, and they have drifted. The discipline already exists in this codebase —
> it was simply never applied to Instantly.**

---

## 3. The root cause, in one line of schema

### The question a new reader always asks

*Why does a column exist, with exactly the right name, wired to the front end — and stay
empty?*

### The answer

`daily_metrics` was written on day one (`20260728152635_core_schema.sql`, the first
migration in the repository), before either sync existed. Look at what it holds:

```
sent, contacted, new_leads_contacted, delivered, bounced,
opened, unique_opened, replied, unique_replied, replies_automatic,
clicked, unique_clicked, linkedin_sent, linkedin_accepted, opportunities
```

That is not Instantly's vocabulary. It is not lemlist's. It is **both lists added
together** — a superset. `linkedin_sent` exists only because lemlist does LinkedIn.
`opportunities` exists only because Instantly has that concept.

The intent was sound: one shape that fits any tool, each tool fills in the parts it knows.

Then comes the line that caused everything downstream:

```sql
delivered int default 0,
bounced   int default 0,
```

**`default 0`. Not `default null`.**

`syncInstantly()` names eleven columns when it writes a day
(`supabase/functions/sync/index.ts:249-260`). The other four are never mentioned, so
Postgres fills them with the column default — **zero**.

Measured, not assumed: **289 Instantly day-rows. `bounced` is `0` in all 289 and `null`
in none.** Same for `delivered`.

### The consequence, said plainly

> **"We do not know" and "it was zero" were made the same value.**

Had the column been `default null`, the Overview would have printed `—` instead of `0`,
and someone would have asked about it on day one.

### Three layers, not one

This matters enormously for whoever fixes it. **Changing the schema default alone will
change nothing on screen**, because two more layers repeat the same coercion:

```
1. supabase/migrations/20260728152635_core_schema.sql:79-89
   bounced int default 0                    →  unwritten becomes 0

2. lib/db.js:89   addInto()
   acc[k] = (acc[k] ?? 0) + (row[k] ?? 0)   →  null becomes 0

3. lib/db.js:50   num()
   (n ?? 0).toLocaleString("en-US")         →  null renders as "0"
```

Any real fix touches all three or none of them.

### Where the break is, and where it is not

A common misreading, worth stating explicitly because it sends people to the wrong file:

- **Vendor → database is fine**, apart from the four missing columns. Proof: `sent`
  matches to the unit across both notebooks (7,542 = 7,542), as does `replied` (39 = 39)
  and `opened` (796 = 796). You do not get three exact matches through a bad connection.
- **Database → front end is fine.** The query runs, asks for `bounced`, receives `0`,
  prints `0`. Every step did its job. **Fixing the front-end "connection" would change
  nothing** — zero is genuinely what is stored.

There is **one** break, upstream, in a transcription. The front end is faithfully
reporting a hole made elsewhere.

### Why nothing caught it

Not carelessness. **Nothing in the system was capable of noticing.**

- Writing 11 columns instead of 15 is **valid SQL**. No error, no warning, no failed run.
- `rows_upserted` counts *rows*, not columns. It looked healthy because it was healthy.
- `v_metric_drift` — the canary on `/health` — is scoped `where c.source = 'lemlist'`,
  the one vendor where this cannot happen. It has also been structurally empty since
  `20260730140000` made a single SQL function the sole writer of both sides it compares.
- And the decisive reason: **zero is a believable number for bounces.** Nobody blinks at
  a low bounce rate. Had the same bug hit `sent`, it would have been caught within an
  hour. **The bug survived because its output was plausible.**

---

## 4. The mirrored bug

The same mistake was made twice, once per vendor, in opposite columns. This single table
explains two separate user-visible symptoms.

| Column | Instantly rows | lemlist rows | Why |
|---|---|---|---|
| `sent` | filled | filled | both write it |
| `bounced` | **0 — never written** | filled (77) | `index.ts:249-260` omits it |
| `delivered` | **0 — never written** | filled (1,844) | same omission |
| `new_leads_contacted` | filled (1,839) | **0 — never written** | `20260730140000:40-46` omits it from the rebuild's column list |
| `linkedin_sent` / `linkedin_accepted` | 0 — **correct**, Instantly has no LinkedIn | filled | genuine |
| `opportunities` | filled | 0 — **correct**, lemlist has no opportunities | genuine |

So:

- **Bounced is lemlist-only** on the Overview → the homepage shows 77 while reality is 149.
- **Leads contacted is Instantly-only** → the tile shows 1,839 while 554 real lemlist
  people are invisible.

And note the bottom two rows: **some of those zeros are correct.** Instantly genuinely
has no LinkedIn data.

Which leaves the cleanest possible statement of the root cause:

> **The number `0` in `daily_metrics` currently means three different things — "it really
> was zero", "this tool cannot measure it", and "we forgot to copy it" — and there is no
> way to tell them apart.**

---

## 5. Findings, worst first

Severity key: **LIVE** = wrong on screen right now. **SYSTEMIC** = a class of failure, not
one instance. **LATENT** = will break, has not yet.

---

### F1 · LIVE · The deliverability alarm is wired to half the data

The Overview's Bounced tile turns red above 5% of sent. It reads **1.0%** (77 ÷ 7,542).
The true figure is **2.0%** (149 ÷ 7,542). The gap is every Instantly bounce, and
Instantly is 75% of volume.

Per group, homepage vs `/campaigns`:

| Group | Tool | Sent | Homepage | Campaigns page |
|---|---|---|---|---|
| Chicago Retrofit | Instantly | 3,574 | **0** | **48** |
| Canada — Justin's list | Instantly | 1,504 | **0** | **12** |
| Roof Campaign — Mark Dolan | Instantly | 545 | **0** | **12** |
| QEA Resellers | lemlist | 1,721 | 70 | 70 |
| LBER — Boston | lemlist | 198 | 7 | 7 |

Read the top three rows again: **5,623 Instantly emails have produced zero bounces on the
homepage.** That is not a measurement.

**Cause:** §3. **Fix:** §11 step 1.

**The data already exists, dated.** `email_account_daily` — pulled from Instantly's
per-mailbox daily endpoint on every deep run — holds all 72 Instantly bounces with dates:

```
20 Jul   138 sent   11 bounced
21 Jul   115 sent    7 bounced
22 Jul   166 sent   18 bounced      ← an 11% bounce day, shown as 0 on the chart
23 Jul   108 sent   10 bounced
24 Jul     5 sent    1 bounced
28 Jul   100 sent    2 bounced
29 Jul   150 sent    5 bounced
30 Jul   167 sent    6 bounced
11 Aug     5 sent    1 bounced
12 Aug   175 sent    8 bounced
13 Aug    26 sent    3 bounced
                    ── 72 total, 20 Jul – 17 Aug
```

**Important limitation on using it:** `email_account_daily` is keyed on
`(source, email, metric_date)` and carries **no campaign id** — one mailbox sends for
several campaigns. So it can fix the **company-wide Bounced tile and the daily chart**,
but it **cannot** fix the per-group Bounced column in the by-campaign table. That one
needs either the campaign-daily endpoint to hand over bounces (unknown, see §10) or a
fallback to lifetime totals, labelled as lifetime.

---

### F2 · LIVE · Clicking a number gives you a different number

The stated promise of this dashboard is that every figure opens the people behind it.
Four of them open a list that does not match, and only one explains itself.

```
Sent       7,542  →  list of 6,786    Instantly logs only a lead's most recent send.
                                      Honest — noted at lib/db.js:173 — but the tile
                                      does not repeat it.

Replied       39  →  list of   193    Tile excludes out-of-office (39 real).
                                      List includes everything inbound (193 rows).

Contacted  1,839  →  list of 2,393    Tile is daily_metrics.new_leads_contacted,
                                      Instantly-only. List is people.first_contacted_at,
                                      both vendors. 554 lemlist people appear only in
                                      the list.

Bounced       77  →  list of    77    Agree with each other, both wrong. Truth is 149.
```

**On the bounce list specifically:** `lib/db.js:181` declares a fallback that would find
all 149 —

```js
bounced: { label: "Emails bounced", table: "activities", event: "bounced",
           altTable: "people", altFilter: { bounced: true }, ... }
```

— but **no code path in the repository reads `altTable`.** `app/list/page.jsx:82` consults
`altFilter` only inside the `m.table === "people"` branch, and `bounced`'s table is
`activities`. It is dead configuration. The list can only ever query the event stream,
which holds **zero Instantly bounce rows** (`activities` has `sent`, `auto_reply` and
`replied` for Instantly, and nothing else).

Verified: `select count(*) from people where bounced` → **149**, exactly matching the sum
of `campaign_totals.bounced`.

---

### F3 · LIVE · The primary KPI is missing two meetings

"Meetings booked" is the headline number and the only thing the company steers on. It
reads **4**. There are **6**.

```
meetings table   4 rows, all evidence = 'chat', newest created 30 Jul 14:20
phone_calls      2 rows with outcome = 'booked_meeting', both dated 4 Aug
                 Baris Acar   (logged by Mark Vasu, 4 Aug 17:40)
                 Bashkim Caci (logged by Mark Vasu, 4 Aug 17:52)
                 neither appears in the meetings table
```

**Cause:** the code that turns a booked call into a meeting lives *inside* the `log_call`
function (`20260806120000_log_call_creates_meeting.sql:73-85`), added **6 August** — two
days after those calls. It was never backfilled. There is **no trigger on `phone_calls`**;
verified against `pg_trigger`, the only triggers in this database are
`replies_fill_identity`, `meetings_fill_identity` and `people_preserve_first`.

**And it fails the other way too, from 6 August onward.** The migration's own header
states it: *"edit_call / delete_call do NOT retro-update or remove the meeting row."*

- Delete a mis-logged booked call → the `phone_calls` row is soft-deleted, the Calls tile
  drops by one, **the meetings row survives forever** and keeps feeding the KPI. There is
  no route to it from the interface.
- Edit an outcome *away from* `booked_meeting` → same orphan.
- Edit an outcome *to* `booked_meeting` → **no meeting is ever created.** `edit_call`
  only updates `phone_calls`.

**Two human paths, two different matching rules.** `log_call` compares
`prospect_name`/`prospect_email` **raw and case-sensitive**; `log_meeting`
(`20260806130000:51-52`) compares them **lowered and trimmed** and stores the email
lowered. Any casing difference between the two paths produces a duplicate meeting, and
`meetings` has no unique constraint.

**Rep attribution hole.** A call-created meeting has `campaign_id = null` and
`group_id = null`, so `ownerOfMeeting` returns null. It counts under "All reps" and
**vanishes the moment any rep filter is applied** (`app/page.jsx:65-67`,
`app/meetings/page.jsx:33`). Rep totals will never sum to the all-reps total.

---

### F4 · LIVE · "1 positive reply" describes the backlog, not the market

Sentiment on a reply is a human judgement, and nobody has been making it.

```
193 replies total
  152  auto_reply         (43 Instantly guessed by subject line, 109 lemlist outOfOffice)
   41  real
    1  classified 'interested' by a human
   40  unclassified for more than 48 hours
```

Those 40 are already queued on `/conflicts` — the `needs_review` kind. Until someone reads
them, every "positive replies" figure is a lower bound of unknown looseness, and any
meeting hiding inside them is uncounted (compounding F3).

**Note the provenance difference, which the UI does not show.** An Instantly `auto_reply`
label is a **subject-line regex guess** made by the sync (`index.ts:106-121`) and stamped
`classified_by = 'ai'`. A lemlist one is the vendor's own `outOfOffice` event type and has
`classified_by = null`. Both render as the same pill on `/replies`.

The one thing this system gets *right*: a human label stamps `classified_by = 'human'`,
and `replies` is inserted with `ignoreDuplicates: true`, so the sync can never overwrite a
human judgement. That guarantee holds.

---

### F5 · SYSTEMIC · Nothing checks that the writes worked

Every database write in the sync is `const { data } = await db.from(...).upsert(...)`.
The `error` half is discarded — at `index.ts:87, 162, 202, 230, 260, 266, 321, 386, 400,
427, 481, 499, 555`, without exception. A row rejected by a constraint vanishes, the run
still counts it in `rows_upserted`, and the run log still says `ok`.

The same shape governs reads. Nearly every page query ends `.then(r => r.data ?? [])`.
**There is no visual difference on this dashboard between "nothing happened" and "the
query failed."** Both render as `0`.

Two literal silent catches, each with a lasting consequence:

- `index.ts:504` — around lemlist `/stats`. A campaign with no sequence returns an error
  and is skipped. It therefore never gets a `campaign_totals` row, and
  `refresh_lemlist_totals()` is an `UPDATE ... FROM` which cannot create one. That campaign
  has no totals, permanently.
- `index.ts:424` — around the per-mailbox daily pull. A whole batch of 20 mailboxes
  silently loses its day.

Partial-failure reporting is asymmetric and lossy:

- Instantly throws → `status = 'partial'`.
- lemlist throws → `'error'` if Instantly also failed, else `'partial'`.
- `regroup()`, `refresh_lemlist_totals()` and `refresh_lemlist_people()` failures are
  recorded **only** in the `detail` JSON. **`status` stays `ok`.** A run where every
  lemlist derivation failed reports success.
- If the invocation dies — crash, wall-clock, or the 280-second `pg_net` timeout — the
  closing update never runs and the row is **stuck at `running` forever**. Nothing reaps
  it. **There is one such row right now, started 8 August 20:30.** `/health` shows only
  the last 12 runs, so it is invisible.

---

### F6 · SYSTEMIC · Both drift canaries are blind

`/health` carries two checks. Both return zero rows today, which reads as "all clear" and
means "not looking".

- **`v_metric_drift`** is scoped `where c.source = 'lemlist'` and compares `daily_metrics`
  against `activities`. Since `20260730140000` made one SQL function the sole writer of
  the daily table *from* that same activity stream, the two cannot disagree. **Empty by
  construction.** Instantly — the vendor with the actually-missing columns — has no
  canary at all.
- **`v_group_status_drift`** fires only on a group marked `planned` or `abandoned` that
  *is* sending. It never fires on the opposite and far more common case: a group marked
  `live` that quietly finished. See F8.

**What is missing is a canary that compares Notebook 1 against Notebook 2 per campaign.**
It would have caught the bounce gap on the day it appeared.

---

### F7 · LATENT · A 1,000-row ceiling, roughly three to six weeks out

PostgREST caps any response at 1,000 rows regardless of what `.limit()` asks for. This
codebase discovered that and fixed it in exactly three places, each with a comment
explaining why — `app/leads/page.jsx:9-17`, `lib/calls.js:30-31` (`contactsFor` pages
until a short page comes back), and `lib/inbound/queue.js:42-48` (`everyRow`). It was not
fixed anywhere else.

**Already broken today:**

- `lib/inbound/queue.js:929-937` — `loadDrafts` reads `inbound_people_view` with
  `.limit(1000)` **and no `.order()`**. That view holds **2,652 rows**. So roughly 60% of
  drafts on `/inbound/drafts` show no person attached, and *which* 60% is whatever
  Postgres returns.

**Coming, and dateable:**

- `lib/db.js:73-80` — `dailyRange()` has no limit and no paging. It is the source of
  **every Overview tile and the chart**, and it is called twice per page load.
  `daily_metrics` holds **520 rows** and grows 13–28 rows per sending day. At that rate it
  crosses 1,000 in **roughly three to six weeks**, after which the homepage silently
  starts dropping days. No error, no warning — the numbers just get smaller.

**Not yet a problem but on the same list:** `app/replies/page.jsx:21` (193 rows today),
`app/meetings/page.jsx:22,24` (4 and 19), `app/calls/page.jsx:13` (19),
`lib/calls.js:50-57` `callsFor` (19), `lib/pipeline.js:208-212` `researchOverview`.

---

### F8 · LIVE · Campaign group status is typed once and never revisited

Seven fields on `campaign_groups` are hand-kept and the sync never writes them: `owner`,
`platform`, `geography`, `segment`, `list_source`, `sequence_shape`, `description`.
**`status` is an eighth.** `20260730150000` states it outright: *"a one-time manual field,
never touched again by the sync."*

```
group  qea  —  "Canada — Justin's list", 11 campaigns, 1,504 sent
       stored status:              live
       campaigns actually running: 0
```

And there is no history to fall back on: **`campaigns.status_changed_at` is NULL on all 43
rows.** The column exists in the core schema and nothing has ever written to it. *"When
did this campaign stop?"* is not answerable from this database.

Six campaigns currently read `running` or `paused` with no send in weeks —
`QEA Resellers — LinkedIn (68)` has never sent at all, and `LBER — Batch 6` last sent on
23 June. **That is the vendor's own state, faithfully copied.** It is not our error, but
the dashboard presents it as current truth.

Distinguish carefully, because these get conflated:

| | Source | Refresh | Trust |
|---|---|---|---|
| **Campaign** status (`running`/`paused`/`completed`) | the vendor | every 30 min | Yes — as *"what the tool currently says"* |
| **Group** status (`live`/`ended`/`abandoned`) | a human, once | never | **No** |

---

### F9 · LIVE · Opens and clicks are read against the wrong denominator

The Overview's Opened tile shows `796` and *"10% of sent"* — that is 796 ÷ 7,542. But
2,049 of those emails **physically cannot report an open**. Most campaigns run text-only
with tracking off, deliberately, because a tracking pixel and rewritten links both cost
inbox placement in cold email.

Measured split:

```
Instantly, open_tracking = true    10 campaigns   3,574 sent   246 opened    6.9%
Instantly, open_tracking = false   12 campaigns   2,049 sent     0 opened    unmeasurable
lemlist                            20 campaigns   1,919 sent   550 opened   28.7%
```

Proposed tile — no schema change, one line of arithmetic and one line of copy:

> **Opened** · **796**
> 14.5% of the 5,493 emails that could be measured
> *2,049 sent with tracking off — cannot register an open*

**Blocker to know before building it:** `open_tracking`, `link_tracking`, `text_only` and
`daily_limit` are **NULL on all 20 lemlist campaigns** — `syncLemlist` never writes them
(`index.ts:481-486`). `link_tracking` is also null on 13 of 23 Instantly campaigns. So the
measurable denominator can only be computed for Instantly today.

Two options: ship it for Instantly and treat lemlist as measurable (it demonstrably
records opens), noting the assumption; or add the fields to the lemlist sync first. The
first is smaller and honest if the note says so.

**Knock-on:** `/health` computes "sent today against a configured cap" by summing
`daily_limit` over running campaigns. Since `daily_limit` is null for every lemlist
campaign, the **numerator counts both tools and the denominator counts one**.

---

### F10 · LIVE · The `people.first_contacted_at` corruption, partially unrecoverable

The Instantly people sync wrote `timestamp_last_contact` into **both**
`first_contacted_at` and `last_contacted_at` (`index.ts:311`), every 30 minutes. So the
"first touch" field was being overwritten with the *latest* touch, forever.

Patched on 6 August by the `people_preserve_first` trigger (`20260806121000:16-28`), which
takes `least(old, new)` on update. But the migration header is explicit: *"rows already
overwritten stay wrong — there is nothing to backfill from."*

**Consequence:** the `contacted` drill-down, which windows on `first_contacted_at`, is
only correct for rows first seen after 6 August 2026.

This is the one place where the project's own append-never-clobber discipline failed. It
holds correctly in the two places it was applied deliberately: `classified_by = 'human'`
on replies, and `assignment_source = 'override'` on campaign grouping — both of which the
sync is built to skip permanently.

---

### F11 · LIVE · Fifty phantom mailboxes

`email_accounts` holds **23** live Instantly mailboxes, synced this morning, and **50**
hand-seeded `source = 'standby'` rows last touched 6 August that nothing updates. No email
appears twice, so nothing is double-counted. The warmup panel filters correctly to
`source === 'instantly'` (`app/inboxes/page.jsx:91`), but the mailbox table below it
(`:145`) lists all 73.

Historical note worth keeping: when the Roof campaign launched on pre-seeded standby
mailboxes, `/inboxes` drew all ten twice, because the unique key is `(source, email)`.
`20260812180000` deleted those ten. The other 50 remain.

---

### F12 · SYSTEMIC · Silent hard caps in the sync

None are close to being hit, but all are silent when they are:

- **3,000 leads per campaign** — 30 pages × 100 on the Instantly people pull
  (`index.ts:285`).
- **4,000 emails** on the Unibox reply pull (`index.ts:342`). Worse, `/emails` is **not
  campaign-filtered and not date-filtered** — it pages the whole workspace inbox
  newest-first and stops at the first message older than the window. On a weekly run
  (90 days) that ceiling is real, and campaigns not in scope still burn pages.
- **100 mailboxes** — `/accounts?limit=100` has **no pagination at all**
  (`index.ts:397`). Mailbox 101 onward is invisible, and therefore absent from
  `email_account_daily` too, since that batching is seeded from this list. **23 today.**
- **2,000 lemlist campaigns**, **20,000 lemlist activities** per run.

Also: the lemlist activity pull uses `offset` against a live, actively-appended feed
(`index.ts:512`), so rows can be skipped or repeated between pages. It self-heals only
because the unique key makes re-reads idempotent and later runs re-cover the window.

---

### F13 · Timezone handling is inconsistent across sources

- `activities.activity_date` is normalised to `America/New_York` via `etDate()`
  (`index.ts:80-81`).
- **Instantly `daily_metrics.metric_date` is `d.date` straight from the vendor**
  (`index.ts:250`), never re-normalised. `campaigns.schedule_timezone` is stored and never
  consulted.
- `email_account_daily.metric_date` — likewise.
- `v_reply_conflicts` joins an ET-derived date (`replies.received_at at time zone
  'America/New_York'`) against a vendor-derived date (`daily_metrics.metric_date`). Any
  day-boundary difference surfaces as a permanent phantom conflict. **Two `reply_split`
  conflicts are open right now**; whether either is this artefact has not been checked.

Separately, the lemlist fetch window is UTC (`index.ts:513`) while its date column is ET,
so under EDT the last ~4 ET hours of the newest day are not fetched in that run. It heals
on the next run once the date rolls over.

---

## 6. Every variable and how it updates

### The synced figures — nobody types these

| Variable | What it actually counts | Source of truth | Refresh |
|---|---|---|---|
| **Sent** | Delivery attempts, including follow-ups to the same person. Not unique people. | Instantly daily analytics; lemlist rebuilt from its activity stream | 30 min |
| **Contacted** | For lemlist this is **set equal to `sent`** (`20260730140000:44`) — it is not a distinct fact. Never displayed anywhere. | both | 30 min |
| **Leads contacted** | First touch per person. **Instantly only** — lemlist writes 0. | `daily_metrics.new_leads_contacted` | 30 min |
| **Delivered** | Computed locally as `sent − bounced`. Not reported by either vendor. | Notebook 2 only; 0 in Notebook 1 for Instantly | 30 min |
| **Bounced** | Receiving server rejected it. **The only completely certain metric here** — the server says so. | Notebook 2 for Instantly; Notebook 1+3 for lemlist | 30 min |
| **Opened** | A tracking pixel loaded. Weak — scanners trip it, images-off misses it. | both notebooks agree (796) | 30 min |
| **Clicked** | Someone clicked a link. Strong signal, deliberate act. Needs link tracking on. | both agree (4) | 30 min |
| **Replied** | Real replies. Out-of-office counted separately as `replies_automatic`. **The only unambiguous positive signal.** | both agree (39) | 30 min |
| **Reply %** | Replies ÷ **leads loaded into the campaign** — including people never emailed. Not replies ÷ sent. Mixes two vendors' definitions of "lead" in one denominator. | Notebook 2 | 30 min |
| **LinkedIn sent / accepted** | Connection requests only. Profile views were deliberately removed (`linkedinVisitDone` is not in `ACTIVITY_MAP`). | lemlist activity stream | 30 min |
| **Campaign status** | Whatever the vendor last said. Mapped from Instantly's integer codes (0 draft, 1 running, 2 paused, 3 completed, 4 running, −1 errored). | vendor | 30 min |
| **Daily limit, tracking flags, sender mailboxes, schedule timezone** | Campaign settings. **NULL for all lemlist campaigns.** | Instantly only | 30 min |
| **Sequence copy & per-step results** | The actual email text and per-step performance. New copy creates a **new version row**, keyed on a content hash — the old one is kept with its old `last_seen`. | Instantly only | **nightly** |
| **Mailboxes & warmup scores** | Per-mailbox health. Capped at 100, no paging. | Instantly only | **nightly** |
| **Per-mailbox daily sends and bounces** | The dated bounce data that F1 needs. | Instantly only | **nightly** |

### The hand-kept figures — these change only when a person types

| Variable | Who fills it | State today |
|---|---|---|
| **Meetings** | Typed into the database, or created by `log_call` since 6 Aug | 4 rows, all `evidence='chat'`. Two more exist as phone calls and were never counted. |
| **Proposals** | Nobody. There is no way to log one from the interface. | **Zero rows, ever.** The tile and its drill-down are empty by definition, not by fault. The table has **no migration in this repo** — it exists only in the live database. |
| **Reply sentiment** | A subject-line guess by the sync, then confirmed or corrected on `/conflicts` | 40 unread past 48h. One human-confirmed `interested`. |
| **Group owner / platform / geography / segment / list_source / sequence_shape / description** | Typed once at group creation | Complete for four groups. `list_source` blank on Roof. `Ungrouped` has none — and an owner-less group **disappears from the rep layer entirely** (`repList()` skips it, so no rep filter, no calls roster entry). |
| **Group status** | Typed once. Never revisited. | `qea` reads `live` with zero running campaigns. |
| **Leads list** (`leads` table) | A one-time spreadsheet import, reconciled against real send activity | 1,950 rows, **frozen**. 1,897 of them now duplicate `people`, which is live. Only 24 people exist in `leads` and nowhere else. |
| **Call outcomes, callbacks, DNC** | Reps, in the calls workspace | 19 calls, 18 of them on a single day (4 August). |
| **`campaigns.hidden`** | Set by migration for the 7 shadow lemlist drafts | The sync never writes this column, which is exactly why it survives a re-sync. |

### Two facts about the metrics themselves, worth internalising

**Low opens are not a bug.** A campaign with tracking off cannot register an open even in
principle. See F9 for the honest denominator.

**Reply counts are a floor, structurally.** A reply sent outside the original sequence, or
a CC'd third party, never reaches either tool. No local fix exists.

---

## 7. Campaign lifecycle — born, kept, ended

### Born — automatic, within 30 minutes

There is no "create campaign" screen and no allowlist. `syncInstantly()` pages
`/v2/campaigns` and takes whatever comes back, so **discovery is a side effect of
listing**. Every write is an upsert keyed on the vendor's own id, so re-running is
harmless.

Group membership is derived by `regroup()` (`index.ts:137-164`), which splits the campaign
name on the **first em dash** `—`. `Chicago Retrofit — Operations` files under Chicago
Retrofit. Matching an existing prefix exactly files it inside that group; a new prefix
creates a new one with `status = 'live'` and nothing else filled in.

**A name with no em dash lands in `Ungrouped` and stays there.** This has already happened
once: `Roof Campaign - Mark Dolan` was hyphenated, went to Ungrouped, and inherited that
group's `abandoned` status along with a null owner — which then tripped the status-drift
canary, correctly, but pointing at the wrong row. Fixed by
`20260812180000_group_mark_dolan_roof.sql`, which pins membership with
`assignment_source = 'override'` so the sync can never re-file it.

**Type the em dash.**

### Named — manual, once, directly in the database

A freshly auto-created group has a slug, a display name and `status = 'live'`. Everything
else is blank. Worst first:

1. **`owner` null** — the group disappears from the rep layer entirely. No rep avatar, no
   rep filter on the Overview, no entry in the `/calls` roster. This is the only one that
   costs a feature.
2. **`platform` empty** — `/campaigns` draws the volume bar in the lemlist colour, because
   `toolColor()` tests for `"instantly"` in that array. Derivable from `campaigns.source`
   and currently is not.
3. **`sequence_shape` null** — "Emails in sequence" reads `—` even though
   `template_versions` holds the real steps after the nightly run.

**Owner cannot be pulled from Instantly.** Checked against a real stored payload: the only
ownership-ish field is `organization`, the workspace UUID, identical on every campaign.
That fact exists only in someone's head.

**There is still no screen for this.** The intended fix — a block on `/health` listing
groups missing an owner, with a dropdown built from existing reps — was agreed 10 August
and has not been built. Roughly one migration plus one form, following the pattern in
`app/conflicts/actions.js`.

### Maintained — automatic, three cadences

| Cadence | Window | What it refreshes |
|---|---|---|
| Every 30 min | today + yesterday | campaigns, lifetime totals, Instantly daily metrics, **all** Instantly people, Unibox replies, lemlist campaigns/stats/activities, then `regroup()` + the three lemlist rebuild functions |
| 03:00 ET nightly | last 14 days | everything above, **plus** sequence copy, per-step metrics, mailboxes, per-mailbox daily |
| 04:00 ET Sunday | last 90 days | the same deep set — a self-healing full re-pull |

Driven by `pg_cron` → `pg_net` → the edge function, with the invoke token in Vault.
The Next.js app **never calls a vendor API** — it only reads Supabase.

**Every page is `force-dynamic` and `lib/db.js:19` pins every read to `cache: "no-store"`.
So a database change is visible on a browser refresh. No deploy, no cache to clear, no
waiting.** This was learned the hard way: Next's fetch cache was serving stale PostgREST
GETs, and a call logged in `/calls` failed to appear on the page that logged it.

### Ended — nothing ends anything

This is the weakest link in the lifecycle.

- **Campaign** status mirrors the vendor and is refreshed. Fine.
- **Nothing records when it changed.** `status_changed_at` is NULL on all 43 rows.
- **Group** status is a hand-typed word no code has ever updated. Ending a campaign in
  Instantly does not end its group here.
- **Nothing is ever deleted.** There is no `.delete()` anywhere in the sync. A campaign,
  lead, mailbox or reply removed at the vendor keeps its row, its last-known status and
  its totals indefinitely. Deleting locally does not hold either — `syncLemlist` upserts
  every campaign lemlist lists, so a deleted row returns within the half hour. **That is
  precisely why the seven shadow drafts are hidden behind a `hidden` flag the sync never
  names, rather than removed.**

---

## 8. The other two systems: calls and inbound

Neither shares data with the Instantly/lemlist campaigns. A new email campaign changes
nothing in either.

### Calls — `/calls`, four levels deep

Phone-first workspace for Campaign 02 (NYC LL11 SAFE / Reliable). Source is 2,119
buildings but **1,252 people** — a rep dials the engineer who carries 65 buildings once,
not 65 times.

**There is deliberately no second call table.** The Overview Calls tile reads
`phone_calls`, and the workspace writes the same rows. `phone_calls` gained `contact_id`,
`rep` and `callback_date` rather than gaining a sibling.

**Identity is name-only, and this is the weak point.** `scripts/import_call_list.mjs:80`
keys each contact on `role + ':' + lowercased, whitespace-collapsed name`.

- Two different engineers sharing a name **merge into one contact**, and their building
  books add together — which then feeds the "Buildings covered" tile and the sort order
  of the entire call list. The QEWI licence number **is imported and stored, and never
  used as a key.**
- The same human appearing as both engineer and owner becomes **two contacts**, dialled
  twice, counted twice.

Other hazards worth knowing before touching this area:

- **"Calls made" counts rows, not dials.** `logCall` writes one row per ticked checkbox,
  so "no answer + left voicemail" on one dial is **2 calls made**.
- **`OUTCOME_PRIORITY` does the opposite of what its comment says.** The comment
  (`app/calls/actions.js:38-46`) says a voicemail with a stray "booked meeting" click
  should still read as a voicemail. Rows are inserted in array order, the pill reads the
  newest row, and `booked_meeting` is **last** in the array — so it wins. And that stray
  tick also fires the meetings insert, which F3 shows can never be removed through the UI.
- **The dedup guard ignores soft deletes.** `log_call`'s one-minute guard has no
  `deleted_at is null`, so deleting a mis-logged call and immediately re-logging it is
  **silently swallowed** — `return`, not an error.
- **Denominators are inconsistent between tiles.** `followupsDue` and `neverCalled`
  exclude DNC contacts; `peopleReached`, `noAnswer`, `notInterested` and `buildingsCovered`
  include them. Every tile is also a filter link, and the list beneath excludes DNC — so a
  tile's number routinely does not equal the rows it opens.
- **Re-import re-flags DNC.** `dnc` is `old.dnc || new.dnc` — sticky true. A contact
  restored via `restore_contact` is re-flagged on the next import if the source still says
  NYCHA. The restore is logged in `call_contact_edits` and silently reverted.

### Inbound — `/inbound` and `/pipeline`, the website-visitor system

A separate LangGraph pipeline in a sibling repo (`qea-inbound`) writes these tables via
GitHub Actions. **This repo contains no writer for inbound data except four server
actions.**

**The single most important thing to say out loud: nothing has ever been emailed.**

```
inbound_emails            835 drafts
  validator_status='sent'      21     ← means "passed the quality gate"
  validator_status='blocked'  814
  send_status='not_sent'      835     ← means "never emailed"
  pushed_at IS NULL           835
```

The send step was **deliberately deleted** from the graph, so that "it cannot send" is a
property of the code rather than a flag someone could flip. That decision is sound. The
vocabulary left behind is not — a column whose value reads `sent` on a system that has
never sent is the single most misleading string in this database.

Queue state: **110 companies — 73 at `needs_review`, 22 `not_icp`, 14 `ready`, 1 `new`.**
`v_inbound_stranded` returns **85**. The 3-hourly schedule runs `--all-new`, which selects
`research_status = 'new'` — **one company.** Almost nothing is reachable by automation;
per-company re-runs are the only route back for most of the queue.

Known hazards, in the order I would fix them:

1. **A crashed run locks a company out permanently.** `busyOf` (`lib/inbound/queue.js:517`)
   treats any run with `status = 'running'` as live **with no age check**, while the SQL
   guard behind the same button bounds it at **two hours**. So the database would accept a
   restart the interface refuses to offer. One-line fix.
2. **`loadDrafts` reads 1,000 of 2,652 people rows with no sort order** — see F7. The
   `everyRow` helper already exists two lines above it.
3. **`p_force` is decided by the client.** The credit-refusal guard is skipped when
   `p_force` is true, and that value comes from a hidden form field. The site has **no
   login**, and `inbound_request_rerun` is granted to `anon` — so a scripted POST can
   bypass the refusal and spend real API credits.
4. **LLM output is stored and rendered as fact** — `account_type`, the "% sure"
   confidence figure (the model's own self-report), `summary`, researched buildings, and
   compliance hits attributing laws to companies. 35 of the compliance hits carry no
   `rule_id` at all. The pipeline records its verdict twice and the two disagree on 11 of
   42 companies; three companies were filed `not_icp` off an HTTP 402.
5. **The stage schema is not in this repo.** `stage_no`, `pipeline_id`, `total_cost_usd`,
   `inbound_emails`, `v_inbound_stranded`, `inbound_set_company_relevant` and others are
   read here and defined in the sibling repo. Nothing in this checkout can validate that
   those columns exist or mean what the interface says.
6. **Pipeline tiles present `LIMIT` results as totals** — companies `.limit(100)`, events
   `.limit(40)`, runs `.limit(300)`, then rendered as "Companies seen", "RB2B events" and
   "Pipeline spend".

---

## 9. Decided, so it need not be re-argued

- **The bounce fix uses `email_account_daily`, not a new API call.** The dated Instantly
  bounces are already in the database. Adding a fetch would be a second copy of a fact we
  already own — the exact mistake that caused this.
- **But it can only fix the company-wide tile and the chart.** That table has no campaign
  id. The per-group Bounced column needs a separate answer, and falling back to lifetime
  totals *labelled as lifetime* is acceptable.
- **The three null→zero layers must be fixed together or not at all.** Changing the schema
  default alone changes nothing on screen.
- **`/campaigns` is the more trustworthy page.** When it disagrees with the Overview,
  believe it. It reads the vendor's authoritative lifetime endpoint.
- **`log_call` writing a meetings row is correct in principle.** Two tiles labelled
  "Meetings booked" that disagree forever is worse. The bug is the missing backfill and
  the missing reverse path on edit/delete, not the design.
- **Human labels must survive the sync**, and this already works: `classified_by='human'`
  on replies and `assignment_source='override'` on grouping are both permanently skipped
  by the sync. Any new human-entered field should follow the same pattern.
- **Sending stays deleted in the inbound pipeline.** Its absence is a property of the
  graph, not a flag's default.
- **`leads` and `people` overlap almost entirely** (1,897 of 1,921 shared emails) and
  should eventually collapse into one, keeping `leads` only for the 24 people never loaded
  into a tool. Not urgent.

---

## 10. Genuinely unknown

Written down so nobody re-derives them, and so nobody states them as fact.

1. **Does `/campaigns/analytics/daily` return a bounce field?** Unknown, and it is the one
   question that decides whether the F1 fix is one line or three. The code names eleven
   fields and **stores no raw copy of that response**, so the answer is not recoverable
   from the database. *One authenticated GET would settle it.* Note: the lifetime endpoint
   definitely has `bounced_count` — confirmed from the stored `raw` payload, whose 25
   fields include it.
2. **Is Instantly's `/emails` feed really newest-first?** The reply pull stops at the first
   message older than the window on that assumption, and **sends no sort parameter**. If
   the default ordering ever changes, replies are silently truncated.
3. **Does this workspace have more than 100 mailboxes?** `/accounts?limit=100` has no
   paging and the code reads only `.items`, so the call gives no signal either way.
   23 today, so not urgent.
4. **Instantly's timezone for the daily `date` field**, and whether `start_date`/`end_date`
   are inclusive. The code stores whatever it gets. See F13.
5. **Why `contacted` differs by 10** between the notebooks (7,176 vs 7,166). Small, real,
   unexplained. The column is never displayed, so it has no user-visible effect today.
6. **`get_secret()` is not defined in this repo.** Called by the edge function and by
   `trigger_sync`. `supabase/README.md` asserts it is `security definer` and granted to
   `service_role` only; that cannot be verified from this checkout.
7. **The edge function's `verify_jwt` setting is not in the repo** — there is no
   `supabase/config.toml`. The cron invokes it with an anon-class bearer token, which
   *implies* anyone holding the public anon key can trigger a full sync. Unconfirmed.
8. **`proposals` has no migration.** The table, its columns and its constraints exist only
   in the live database. Every "Proposals sent" figure reads a table not in version
   control.
9. **Migration `20260817211639` is referenced by a later migration and has no file here.**
   Anyone reconstructing the schema from `supabase/migrations/` alone is missing a step.
10. **Are the two open `reply_split` conflicts real, or the timezone artefact from F13?**
    Not checked.
11. **The inbound `apollo_sweep` no-re-search behaviour.** Recorded in
    `INBOUND_RESTART_STATE.md`: all 70 recoverable companies already have a prior sweep, so
    a bulk re-run may produce beautifully classified companies with **no new contacts** and
    still look like success. Nothing in this repo can detect that state.

---

## 11. The work, in order

Ranked by damage-per-unit-of-effort, not by difficulty.

1. **Make the Overview and `/campaigns` agree on "bounced".** Fill the tile and chart from
   `email_account_daily` (already populated, already dated). For the per-group column,
   either settle §10 item 1 or fall back to lifetime totals with an honest label.
   *Removes the single most misleading number on the dashboard.*

2. **Backfill the two missing meetings, and decide what `delete_call` owes the meetings
   table.** Two rows to insert. Then close the reverse path in `edit_call`/`delete_call` —
   today it does nothing in either direction, so the KPI can only ever drift upward.

3. **Read the 40 unclassified replies.** Not an engineering task. It is the only thing
   standing between the team and a real positive-reply rate, and any meeting hiding inside
   them is compounding item 2.

4. **Page `dailyRange()` before `daily_metrics` crosses 1,000 rows.** Three to six weeks of
   runway. The paging helper already exists in three other files — this is a copy, not a
   design.

5. **Stop rendering "unknown" as "0".** All three layers: schema defaults to null for
   vendor-optional columns, `addInto`, and `num()`. This is the change that pays forever —
   the *next* forgotten column announces itself on screen instead of hiding as a plausible
   zero for three weeks.

6. **Read the error on every sync write, and mark the run `partial`.** Converts an entire
   class of silent corruption into a red row on `/health`. Also reap runs stuck at
   `running` — there is one from 8 August sitting there now.

7. **Add a canary comparing Notebook 1 against Notebook 2, per campaign, both vendors.**
   The existing one only checks lemlist, where the two sides cannot disagree. This would
   have caught the bounce gap on day one.

8. **Fix the opens/clicks denominator** (F9), and put the tracking-off explanation on the
   tile rather than in a document.

9. **Decide what a group's status is for.** If it describes reality, derive it from whether
   any campaign inside is running. If it records intent, keep it typed but surface the
   contradiction on `/health` in **both** directions.

10. **Add the owner-setting block to `/health`** so a new group stops being invisible to
    the rep layer until someone edits the database by hand.

11. **Inbound: bound `busyOf`'s running branch by age**, matching the SQL guard's two
    hours. One line, and it is the only stuck state a user can hit today with no way out.

---

## 12. How to verify any of this yourself

Do not take this file's word for anything. These are the queries behind it.

**Is the sync alive?**
```sql
select mode, status, started_at, finished_at, rows_upserted, error
from sync_runs order by started_at desc limit 20;

-- and the one nobody sees:
select * from sync_runs where status = 'running' and started_at < now() - interval '1 day';
```

**Do the two notebooks agree?** (the master reconciliation)
```sql
select
 (select sum(sent)      from daily_metrics)   dm_sent,
 (select sum(sent)      from campaign_totals) ct_sent,
 (select sum(bounced)   from daily_metrics)   dm_bounced,
 (select sum(bounced)   from campaign_totals) ct_bounced,
 (select sum(delivered) from daily_metrics)   dm_delivered,
 (select sum(delivered) from campaign_totals) ct_delivered,
 (select sum(replied)   from daily_metrics)   dm_replied,
 (select sum(replied)   from campaign_totals) ct_replied;
```

**Which campaigns disagree, and by how much?**
```sql
with agg as (select campaign_id, sum(sent) s, sum(bounced) b from daily_metrics group by 1)
select c.source, c.name, t.sent, a.s, t.bounced, a.b
from campaigns c
join campaign_totals t on t.campaign_id = c.id
left join agg a on a.campaign_id = c.id
where coalesce(t.bounced,0) <> coalesce(a.b,0)
order by coalesce(t.bounced,0) - coalesce(a.b,0) desc;
```

**Prove the column is zero, not null:**
```sql
select count(*) rows,
       count(*) filter (where bounced is null) as nulls,
       count(*) filter (where bounced = 0)     as zeros
from daily_metrics d join campaigns c on c.id = d.campaign_id
where c.source = 'instantly';
```

**Find the missing bounces:**
```sql
select metric_date, sum(sent) sent, sum(bounced) bounced
from email_account_daily where bounced > 0 group by 1 order by 1;
```

**The reply backlog:**
```sql
select source, sentiment, classified_by, count(*) from replies group by 1,2,3;
select kind, count(*) from v_conflicts group by 1;
```

**Meetings vs booked calls:**
```sql
select pc.prospect_name, pc.call_date, pc.rep,
       exists(select 1 from meetings m where m.prospect_name = pc.prospect_name) in_meetings
from phone_calls pc where pc.outcome = 'booked_meeting';
```

**Stale group status:**
```sql
select g.slug, g.status stored, v.running_count, v.campaign_count, v.sent
from campaign_groups g join v_group_summary v on v.id = g.id
where g.status = 'live' and v.running_count = 0;
```

**Both canaries (should be treated with suspicion when empty):**
```sql
select count(*) from v_metric_drift;         -- lemlist only, empty by construction
select count(*) from v_group_status_drift;   -- one direction only
```

**The 1,000-row clock:**
```sql
select count(*) as rows_now from daily_metrics;
select metric_date, count(*) from daily_metrics group by 1 order by 1 desc limit 14;
```

---

## 13. Live counts as of this review

18 August 2026, 15:00 UTC, project `yfnqszwlyoyfhuwfmcyl`.

| Table | Rows | Note |
|---|---|---|
| `campaigns` | 43 | 36 visible, 7 hidden. 23 Instantly, 20 lemlist. |
| `campaign_groups` | 6 | see below |
| `daily_metrics` | **520** | the 1,000-row clock |
| `campaign_totals` | 42 | one campaign has none — see F5 |
| `people` | 2,756 | 2,150 Instantly, 606 lemlist. 2,707 distinct emails. |
| `activities` | 7,723 | Instantly: `sent` 4,867, `auto_reply` 43, `replied` 15, **`bounced` 0** |
| `replies` | 193 | 152 auto, 41 real, **1** human-confirmed interested |
| `meetings` | 4 | newest created 30 Jul. Real count is 6. |
| `proposals` | 0 | ever |
| `leads` | 1,950 | frozen import |
| `phone_calls` | 19 | 18 of them on 4 Aug |
| `email_accounts` | 73 | 23 Instantly + 50 stale `standby` |
| `email_account_daily` | 244 | **holds the 72 missing bounces** |
| `sync_runs` | 1,040 | 1,037 ok, 2 partial, **1 stuck `running` since 8 Aug** |
| `events` | 0 | the conflicts feature became a view instead; table unused |
| `inbound_companies` | 110 | 73 needs_review, 22 not_icp, 14 ready, 1 new |
| `inbound_people` | 2,652 | |
| `inbound_emails` | 835 | **0 ever sent** |
| `inbound_graph_runs` | 621 | 513 ok, 98 needs_review, 7 cancelled, 3 error |

**Groups:**

| Slug | Display | Status | Owner | Campaigns | Running | Sent | Meetings |
|---|---|---|---|---|---|---|---|
| `chicago-retrofit` | Chicago Retrofit | live | Mark Vasu | 10 | 2 | 3,574 | 2 |
| `qea` | Canada — Justin's list | live | Justin | 11 | **0** | 1,504 | 1 |
| `qea-resellers` | QEA Resellers | live | Tanay | 7 | 2 | 1,721 | 1 |
| `lber` | LBER — Boston | ended | Tanay | 6 | 1 | 198 | 0 |
| `roof-campaign-mark-dolan` | Roof Campaign — Mark Dolan | live | Mark Dolan | 1 | 1 | 545 | 0 |
| `ungrouped` | Ungrouped | abandoned | **none** | 1 | 0 | 0 | 0 |

Note that `qea` — displayed as "Canada — Justin's list" — holds the eleven Instantly QEA
campaigns (P1–P5 F&B, Datacenter, Roofing, Referral). Grouping is derived from the name up
to the first em dash, so anything named `QEA — …` lands there. **Deleting that group would
remove the main outreach from the dashboard.**

**The master reconciliation, all time:**

| | Notebook 1 (daily) | Notebook 2 (lifetime) | Notebook 3 (names) |
|---|---|---|---|
| Sent | 7,542 | 7,542 | 6,786 |
| Bounced | **77** | **149** | 77 *(activities)* / 149 *(people)* |
| Delivered | **1,844** | **7,395** | — |
| Replied | 39 | 39 | 193 rows *(41 non-auto)* |
| Opened | 796 | 796 | 349 people |
| Contacted | 7,176 | 7,166 | 2,393 people |
| Leads contacted | 1,839 *(Instantly only)* | — | 2,393 |

---

## A closing note for whoever picks this up

The instinct on reading the list above is that something is badly broken and needs
rebuilding. It does not. Nearly every finding here traces to **one word in one line of the
first migration** — `default 0` where `default null` belonged — and to the fact that
nothing was ever built to notice when two copies of a number drift apart.

The project already contains the right answer to this problem, applied correctly to
lemlist and written down with its reasoning. Extending that same discipline to Instantly
is most of the work.

And do not skip item 5 in §11 because it fixes nothing visible today. It is the only item
on the list that prevents the *next* version of this document from being written.
