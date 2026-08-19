# The plan — 18 August 2026

`TRUST.md` says what is wrong. This says what we are doing about it, in order, and what
the system looks like when we stop.

Written after three independent reviews of `TRUST.md` (this one, and two external). Where
they disagreed, the disagreement is settled here with a reason, so it is not re-argued.

---

## 0. The two guarantees this is built to deliver

Everything below exists to make these two sentences true. If a step does not serve one of
them, it is not in this plan.

**One — an edit in one place is an edit everywhere.**
The delivery half of this is **already true**: every page is `force-dynamic` with
`cache: "no-store"`, so a database change shows up on the next refresh with no deploy.
The hole is narrower and entirely real — **one fact written to two unlinked rows.** A
meeting lives in `meetings`, the call that created it lives in `phone_calls`, and nothing
joins them, so editing one leaves the other wrong forever. Phase 2 is this guarantee.

**Two — "live" answers itself.**
Nobody types whether a campaign group is still running. The dashboard derives it, every
time it is read, from what the campaigns inside are actually doing.

---

## 1. The model: one owner per fact, one read path

Not one table. One **owner** per fact, and exactly one route the front end takes to reach
it. Three kinds of fact, three owners:

| Kind | Examples | Owner | Our copy is |
|---|---|---|---|
| **Vendor** | sent, bounced, opened, replied, campaign status | Instantly / lemlist | a cache, and must be rebuildable from a re-pull |
| **Human** | a meeting happened, this reply is interested, who owns this group | the person who typed it | **the original.** No vendor can supply it. Must survive every sync. |
| **Derived** | delivered = sent − bounced, every rate, group `actual` status | a formula | computed at read time, **never stored** |

The failure `TRUST.md` documents is one rule broken in one place: a derived fact
(`delivered`) and a vendor fact (`bounced`) were **stored** in `daily_metrics` instead of
derived, and then not written. Stored copies drift. Derived ones cannot.

### The read path, measured

Counted across `app/` and `lib/`: 37 distinct tables and views are read directly. Two of
them are the metric views.

```
vendor metrics, per campaign / per group   →  v_campaign_summary, v_group_summary
vendor metrics, per day                    →  daily_metrics   ← raw, and the only lie
human facts                                →  people, replies, meetings, phone_calls
                                              read as themselves, because they ARE the owner
```

**The rule is not "no page reads a base table."** Forcing `meetings` and `replies` through
a view would add a layer over data that has exactly one copy already. The rule is narrower
and follows from §1:

> **Vendor metrics are read through a view. Human tables are read as themselves.**

Only two callers break it, and they are the two pages that disagree with `/campaigns`
about bounce: `app/page.jsx:18,79` and `app/health/page.jsx:12`, both via
`dailyRange()` → `daily_metrics`. That is the whole of Phase 1's read-side change.

---

## 2. The phases

Ordered by damage removed per hour spent. Each one is shippable alone and leaves the
dashboard more honest than it found it.

---

### Phase 0 · The data judgment — before any code

Two rows and one question. None of this is engineering, and all of it blocks Phase 2 from
being verifiable.

- **Insert Baris Acar** — 4 Aug, `baris@pacenpc.com`, PACE, logged by Mark Vasu.
- **Do not insert Bashkim Caci.** Verified against the live database: logged 4 Aug 17:52,
  soft-deleted 19:00 the same evening. The call was withdrawn. `TRUST.md`'s "6 meetings"
  counted it and is wrong; the real number is 5 rows / 4 distinct people.
- **Decide the two Jeffrey Hohenstein rows.** 22 Jul `held`, 30 Jul `booked`, same email,
  same campaign. Both were written by a single insert (`created_at` identical to the
  microsecond), so this is a deliberate two-stage record, **not an accidental duplicate**.
  The question is whether one relationship should count twice in a headline KPI. That is
  a business call, not a bug. **Answer it, write the answer here, and move on.**

---

### Phase 1 · Make the Overview stop lying about bounce

The only actively misleading number on the dashboard. 5,623 Instantly emails currently
report zero bounces on the homepage.

**The grain problem, stated before anything is built.** `email_account_daily` is keyed on
`(source, email, metric_date)` and carries no campaign id. Measured today: **13 of 23
Instantly mailboxes send for more than one campaign.** So those 72 bounces can be placed
on a *date*, and cannot be placed on a *campaign*. Ten mailboxes do serve exactly one
campaign, which makes partial attribution technically possible — and we are **not** doing
it, because it reproduces the exact failure being fixed: some campaigns showing a real
bounce number and the rest showing 0, with nothing on screen saying which is which.

What the data can honestly support:

| Grain | Instantly bounce | Source |
|---|---|---|
| Company-wide, any date window | **real** | `email_account_daily`, dated |
| Per campaign / group, all time | **real** | `campaign_totals.bounced`, labelled *lifetime* |
| Per campaign / group, one day or a window | **unknown** → render `—` | unattributable until the daily API write lands (Phase 1b) |

**Build `v_daily_facts`** on that basis — `daily_metrics` plus a company-wide Instantly
bounce overlay, and **`bounced` left null at campaign-day grain for Instantly** rather
than 0. `delivered` is **derived as `sent − bounced`** in the view and never stored again.

**Point `dailyRange()` at it.** Both callers — `app/page.jsx:18,79` and
`app/health/page.jsx:12` — pick it up at once. The **Bounced tile** goes from 77 to 149
and agrees with `/campaigns`. The **by-campaign Bounced column** shows lifetime-labelled
or `—`, never a fabricated 0. The **daily chart plots `sent`** (`app/page.jsx:81`) and was
never wrong; it does not change.

**Fix the drill-down.** `lib/db.js:181` already declares `altTable: "people"` and nothing
in the repository reads it. Wire it, so clicking Bounced opens 149 people rather than 77
activities.

**Page the two broken readers, in this phase, because one is already failing.**
`loadDrafts` (`lib/inbound/queue.js:929`) reads 1,000 of 2,652 rows with no `.order()` —
roughly 60% of `/inbound/drafts` shows no person attached **today**. `dailyRange()` has no
paging and `daily_metrics` is at 520 of a 1,000-row ceiling, three to six weeks out. The
`everyRow` helper already exists two lines above `loadDrafts`. This is a copy, not a
design.

---

### Phase 1b · Write the Instantly bounce at source — after one GET

Gated on the open question below, and the only thing that can ever make per-campaign
windowed bounce real.

- Add **`bounced` only** to the Instantly daily write
  (`supabase/functions/sync/index.ts:249-260`). **Not `delivered`** — that is derived in
  the view now, and writing it again would re-create the drift this plan exists to remove.
- After the next weekly deep run backfills 90 days, drop the overlay from `v_daily_facts`
  and let `daily_metrics` be the source again.

> **ANSWERED, 18 Aug 2026 — the field does not exist. This phase is closed, not deferred.**
> Two authenticated reads of `/campaigns/analytics/daily`: the workspace aggregate for
> 22 July, a day with 18 recorded bounces, and `Chicago Retrofit — Property Mgmt —
> Variation A` (17 lifetime bounces) across 20–24 July. Both return the same thirteen
> fields — `sent`, `contacted`, `new_leads_contacted`, `opened`, `unique_opened`,
> `replies`, `unique_replies`, `replies_automatic`, `unique_replies_automatic`, `clicks`,
> `unique_clicks`, `opportunities`, `unique_opportunities` — and **no bounce field under
> any name.**
>
> Consequences, all permanent:
> - There is nothing to add to the Instantly daily write. Do not reopen this.
> - The `v_daily_facts` overlay is load-bearing forever, not a stopgap to be dropped
>   after a backfill.
> - Per-campaign, per-window Instantly bounce is **unavailable, not merely unbuilt.**
>   The `—` on the by-campaign table is the final answer.
> - The lifetime endpoint is the only Instantly bounce source carrying a campaign;
>   `email_account_daily` is the only one carrying a date. No source has both, and none
>   can be assembled from these APIs.
>
> See `PROGRESS.md` Step 3 for the raw responses.

---

### Phase 1c · `/leads` stops being a July snapshot

A new campaign reaches every page within 30 minutes **except this one**, and nothing on
screen says so.

Measured 18 Aug:

```
leads    1,950 rows, newest created_at  28 Jul 2026   — no writer anywhere in the repo
people   2,756 rows, synced every 30 min
newest campaign discovered               11 Aug       — leads did not gain a row

1,897 emails in both
   24 in leads only        a spreadsheet row never loaded into a tool
  810 in people only       invisible on /leads, and growing with every campaign
```

Applying §1's model: `people` is the **vendor** copy and is live; `leads` holds a
**human** fact — that someone put this person on a list, with a source file and a quality
grade — for 24 people who exist nowhere else. Neither is redundant; only one is current.

**Build `v_leads`** — live rows from `people`, plus the 24 orphans, plus the human-only
columns (`source_list`, `source_file`, `email_quality`) joined on email where they exist.
Point `app/leads/page.jsx` at it. The head-count pattern already there
(`countWhere`/`countIn`, which reads `Content-Range` rather than counting a truncated
body) is correct and stays.

> **One decision needed before building it.** `leads.status` uses a vocabulary
> (`sent`, `assigned`, `prospect`, `held`, `no_email`) that does not exist on `people`
> and describes a human pipeline, not vendor state. Either map it, or keep it as a
> human-owned column that only the 1,950 imported rows carry and new people join with
> null. **Ask before choosing — do not infer it.**

---

### Phase 2 · One meeting, one row, one edit

This is the phase that delivers **guarantee one**. Today a meeting and the call that
created it are two unlinked rows, and `edit_call` / `delete_call` touch neither — verified
by reading all three function bodies.

- **Add `meetings.source_call_id` and `meetings.origin`.** `evidence` is hardcoded to
  `'chat'` inside `log_call`, so a call-created meeting is currently indistinguishable
  from a hand-typed one. Without this column there is nothing to match on but the name —
  the same fragile key that caused the problem.
- **`log_call`** sets it on insert.
- **`edit_call`** away from `booked_meeting` cancels the linked meeting; **to**
  `booked_meeting` creates one. Today it does neither, so the KPI can only ever rise.
- **`delete_call`** cancels the linked meeting. Today the meeting outlives the call
  forever with no route to it from the interface.
- **Cancel, do not delete.** A withdrawn meeting keeps its row with a status, so the
  history stays readable.
- **Backfill** the link for existing rows, then Phase 0's insert is verifiable.
- **Match case-insensitively**, the way `log_meeting` already does, so the two human paths
  stop being able to produce a duplicate.
- **Count call-created meetings under `logged_by`** when `campaign_id`/`group_id` are
  null. Today they vanish the moment any rep filter is applied, so rep totals never sum to
  the all-reps total.

---

### Phase 3 · Stop rendering "unknown" as "0"

Purely preventive. **It does not fix today's bounce number — Phase 1 does that.** Changing
a column default is DDL: it governs future inserts and leaves all 289 existing Instantly
rows storing `0` exactly as they are. What this phase buys is that the *next* forgotten
column announces itself on screen instead of hiding as a plausible zero for three weeks.

`0` currently means three different things — *it really was zero*, *this tool cannot
measure it*, and *we forgot to copy it* — with no way to tell them apart.

**Step one, before any DDL: write the classification down.** One line per column per
vendor, and the migration follows from it rather than being reasoned out mid-flight:

```
instantly + bounced          measured     → null when absent
instantly + delivered        derived      → not stored at all (Phase 1)
instantly + linkedin_sent    n/a          → 0 is correct, leave it
lemlist   + new_leads_contacted  measured → null when absent
lemlist   + opportunities    n/a          → 0 is correct, leave it
```

Then all three layers together — the schema default alone changes nothing on screen:

```
1. schema default 0 → null   for the columns classified "measured"
2. lib/db.js:89   addInto()  keep null null; do not coalesce on the way in
3. lib/db.js:50   num()      render null as "—", never "0"
```

**Do not blindly null every zero.** Instantly's `linkedin_sent = 0` is *correct* —
Instantly has no LinkedIn. Nulling it would print "—" for a number we genuinely know: a
new lie in the opposite direction.

---

### Phase 4 · Make the system catch the next one itself

This is what replaces "write more documentation" as the answer to drift. A view that goes
red is a contract that enforces itself and cannot rot.

- **`v_reconciliation`** — per campaign, per metric: daily total vs lifetime total, the
  difference, a severity. Both vendors. The existing `v_metric_drift` is scoped
  `where source = 'lemlist'`, the one vendor where the two sides are written by the same
  SQL function and therefore *cannot* disagree. It is empty by construction and reads as
  all-clear. This one would have caught the bounce gap on day one.
- **Invariants**, as cheap SQL that either holds or does not:
  `bounced <= sent`, `opened <= sent`, `clicked <= sent`, `delivered = sent - bounced`,
  and `sync status = ok AND write_errors > 0` must never be true.
- **Read the error on every sync write.** All thirteen sites discard the `error` half
  today, so a rejected row still counts in `rows_upserted` and the run still logs `ok`.
  Mark the run `partial` instead.
- **Reap stuck runs.** One row has been `running` since 8 August. Mark leftover `running`
  rows `error` after 30 minutes.
- **Bound inbound `busyOf`'s running branch by age** (2 hours), matching the SQL guard
  behind the same button. One line, and it is the only stuck state a user can reach today
  with no way out.

**What we are deliberately not building:** a metric registry, and a written per-writer
contract document. Both were proposed. Both are prose that rots exactly the way
`TRUST.md`'s live row counts rotted between two reviews on the same day. A reconciliation
view *is* the contract, and it is the version that fails loudly when someone breaks it.

---

### Phase 5 · Live answers itself

This is **guarantee two**.

Split the one overloaded word into two fields that answer two different questions:

| | `actual` | `intent` |
|---|---|---|
| Question | is anything inside running right now | are we still investing in this |
| Source | derived in SQL from `campaigns` | a human, deliberately |
| Stale? | **impossible — not stored** | allowed, and that is fine |

`/campaigns` and the Overview show `actual`. `/health` shows where `actual` and `intent`
disagree — **in both directions.** The current canary fires only on a `planned` or
`abandoned` group that is sending, and never on the far more common opposite: a group
marked `live` that quietly finished. `qea` is that case today.

- **Add a trigger writing `campaigns.status_changed_at`.** It is NULL on all 43 rows and
  nothing has ever written it, so *"when did this stop?"* is currently unanswerable.
- **Also derive `platform`** from `campaigns.source` rather than leaving it hand-typed —
  a blank one draws Instantly campaigns in the lemlist colour.
- **Add the owner-setting block to `/health`.** A group with a null owner disappears from
  the rep layer entirely — no filter, no avatar, no calls roster entry — and the only
  current fix is editing the database by hand.

**The honest limit:** if the vendor still reports a campaign `running`, nothing here can
know it is dead. Six campaigns read running or paused with no send in weeks. Derived
`actual` plus a last-send date makes that visible. It cannot make the judgment for you.

---

### Phase 6 · Make the database reproducible from git

Not what is lying today, which is why it is last — but it is a real governance hole and it
stays open until it is closed.

- `proposals` exists in production with **no migration** in this repository.
- Migration `20260817211639` is referenced by a later migration and **has no file here**.

The standard: **a fresh database built from `supabase/migrations/` alone must match
production.** After that, schema change → migration → git → production, with no
production-only DDL.

---

## 3. The end state

```
                    Instantly          lemlist          humans
                        │                 │                │
                        ▼                 ▼                ▼
                  raw vendor pulls   activity stream   meetings, replies,
                  (kept, dated)      (the one truth)   owners, sentiment
                        │                 │                │
                        └────────┬────────┘                │
                                 ▼                         │
                          DERIVED IN SQL  ◄────────────────┘
                     v_daily_facts · v_campaign_summary · v_group_summary
                                 │
                        ┌────────┴────────┐
                        ▼                 ▼
                 v_reconciliation      every page
                 + invariants      (metrics via views;
                                    human tables direct)
                        │
                        ▼
                     /health
```

**What is true in that picture and is not true today:**

1. Every page reads the same numbers, because there is one route to them.
2. A human edit lands in one row, and every page sees it on the next refresh.
3. "Live" is computed, never typed. It cannot be stale.
4. `delivered` and every rate are formulas, so they cannot drift from their inputs.
5. An unknown renders `—`. A forgotten column is visible the day it is forgotten, instead
   of hiding as a plausible zero for three weeks.
6. Two copies of the same number are compared by a view, and disagreement is red on
   `/health`.

## 4. Will it stay true?

Not by discipline, and not because this file says so — `TRUST.md`'s own row counts were
stale within hours of being written. It stays true because of three mechanical properties,
none of which need anyone to remember them:

- **Derived facts cannot drift**, because there is only ever one copy.
- **Stored duplicates are compared automatically**, and the comparison is on a page
  someone looks at.
- **Silence is visible.** Unknown prints as `—`, a failed write marks the run `partial`,
  and a stuck run gets reaped.

The standard we are building to, stated so it can be tested:

> **A wrong number may still occur. The system cannot silently pretend it is right.**

---

## 5. Explicitly not doing yet

Each of these was proposed and is being declined on purpose, so it is not re-proposed:

- **Full sync error-handling rewrite.** Right idea, easy to break the cron. Phase 4 reads
  the errors without restructuring the function.
*(`leads` / `people` was here, declined as cleanup. Promoted to Phase 1c on 18 Aug after
measuring that `/leads` has been frozen since 28 July and is missing 810 people. A page
that silently stopped updating is not cleanup.)*
- **Auth / locking `anon`.** Real, and it is `AUTH_PLAN.md`'s job, not this one.
- **Changing the inbound `sent` vocabulary.** Genuinely misleading, but nothing has ever
  been emailed and that is deliberate. Cosmetic next to the rest.
- **Rebuilding anything.** The bounce bug does trace to one word in one migration, but
  that line is `TRUST.md`'s rhetoric and this plan's own Phases 2–6 disprove it as a
  general claim — unlinked meeting writes, silent pagination, discarded write errors and
  hand-typed status are four independent faults. None of them needs the architecture
  replaced. All of them need a specific thing fixed.

- **Automatic meeting capture** (calendar or CRM). Decided 18 Aug: **meetings stay
  manual for now.** The `/meetings` form and the `/calls` tick already cover both doors;
  `log_meeting` already accepts `evidence = 'calendar'`, so the hook exists when we want
  it. Revisit once it is clear how meetings actually get booked.

## 6. Not engineering, and still blocking

**Read the 40 unclassified replies.** One human-confirmed `interested` against 40 replies
nobody has opened means every positive-reply figure is a lower bound of unknown looseness.
No code fixes this, and any meeting hiding inside those 40 is compounding Phase 2.
