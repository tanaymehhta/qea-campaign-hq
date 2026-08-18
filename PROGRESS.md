# Progress — executing PLAN.md

Append only. Never rewrite an entry. A new agent should be able to read this file alone
and know exactly where things stand.

`TRUST.md` = the verified diagnosis. `PLAN.md` = the agreed plan. This = what has actually
been done, with the query that proves it.

---

## Step 0 · Baseline, frozen before any change

Measured live against `yfnqszwlyoyfhuwfmcyl` at **2026-08-18 19:05:20 UTC**, one query,
one instant.

```sql
select
  now() as measured_at,
  (select sum(bounced) from daily_metrics)                                as dm_bounced,
  (select sum(bounced) from campaign_totals)                              as ct_bounced,
  (select count(*) from people where bounced)                             as people_bounced,
  (select sum(bounced) from email_account_daily where source='instantly') as ead_instantly_bounced,
  (select sum(sent)    from email_account_daily where source='instantly') as ead_instantly_sent,
  (select count(*) from daily_metrics)                                    as dm_rows,
  (select count(*) from inbound_people_view)                              as inbound_people_view_rows,
  (select sum(sent) from daily_metrics)        as dm_sent,
  (select sum(sent) from campaign_totals)      as ct_sent,
  (select sum(opened) from daily_metrics)      as dm_opened,
  (select sum(opened) from campaign_totals)    as ct_opened,
  (select sum(replied) from daily_metrics)     as dm_replied,
  (select sum(replied) from campaign_totals)   as ct_replied,
  (select sum(clicked) from daily_metrics)     as dm_clicked,
  (select sum(clicked) from campaign_totals)   as ct_clicked,
  (select sum(delivered) from daily_metrics)   as dm_delivered,
  (select sum(delivered) from campaign_totals) as ct_delivered;
```

| Measure | TRUST.md, 18 Aug 15:00 | **Now, 18 Aug 19:05** |
|---|---|---|
| `daily_metrics` bounced (the Overview's number) | 77 | **77** |
| `campaign_totals` bounced (the `/campaigns` number) | 149 | **149** |
| `people where bounced` | 149 | **149** |
| `email_account_daily` instantly bounced | 72 | **72** |
| `email_account_daily` instantly sent | — | **5,620** |
| `daily_metrics` rows (1,000-row ceiling) | 520 | **521** |
| `inbound_people_view` rows | 2,652 | **2,670** |

**Regression guard — the four that are correct today and must not move.** Both notebooks,
same instant:

| Metric | daily (Notebook 1) | lifetime (Notebook 2) | Agree? |
|---|---|---|---|
| sent | 7,542 | 7,542 | yes |
| opened | 797 | 797 | yes |
| replied | 39 | 39 | yes |
| clicked | 4 | 4 | yes |
| **bounced** | **77** | **149** | **no — the fault** |
| delivered | 1,844 | 7,395 | no — known, derived, Phase 1 removes it |

These are a snapshot, not constants. The sync runs every 30 minutes and sent/opened/
replied grow legitimately. **Never test "equals 7,542".** Every test compares two sources
computed at the same instant.

Nothing surprised me. `opened` moved 796 → 797 and `dm_rows` 520 → 521 between TRUST.md's
measurement and this one, which is the sync working as designed.

---

## Step 1 · `v_reconciliation` — the detector, built before the fix

**Changed:** new migration `20260818190838_reconciliation_canary_both_vendors`, applied to
`yfnqszwlyoyfhuwfmcyl` and written to
`supabase/migrations/20260818190838_reconciliation_canary_both_vendors.sql`. No
application code touched. Nothing on any page reads it yet.

**What it compares.** Per campaign, per metric: Notebook 1 (`daily_metrics`, feeds the
Overview / chart / `/health`) against Notebook 2 (`campaign_totals`, feeds `/campaigns`,
`/campaigns/[slug]`, `/c/[id]`). Both vendors — unlike `v_metric_drift`, which is scoped
`where c.source = 'lemlist'`, the one vendor whose two sides are written by the same SQL
function and therefore cannot disagree.

Five metrics: `sent`, `bounced`, `opened`, `replied`, `clicked`.

- **`delivered` is deliberately excluded.** It is `sent - bounced`, a formula. Storing it
  is what let it drift to 1,844 against 7,395. Phase 1 derives it at read time, after
  which there are not two copies to compare.
- **`contacted` is excluded.** Never displayed on any page, so its known 10-row difference
  cannot mislead anyone.

**Grain is not uniform, on purpose.** Instantly bounce reconciles **company-wide**
(one row, `campaign_id` null); everything else reconciles **per campaign**. The only dated
copy of Instantly bounce lives in `email_account_daily`, keyed on the mailbox, and 13 of
23 Instantly mailboxes send for more than one campaign. Reconciling it per campaign would
force an attribution the data cannot support — the exact failure being fixed.

**Severity** is sized, not binary: `high` at ≥10 or >5% of the larger side, `medium` at ≥3
or >1%, else `low`. One send off on a 5,000-send campaign is two vendor endpoints
rounding; ten is data going missing.

### Proof it works — validated against a fault we already understand

```sql
select now() as measured_at, * from v_reconciliation order by abs(difference) desc;
```

**2026-08-18 19:08:41 UTC — exactly one row:**

| source | campaign_id | name | metric | daily_total | lifetime_total | difference | severity |
|---|---|---|---|---|---|---|---|
| instantly | *null* | all instantly campaigns | bounced | **0** | **72** | **72** | high |

This is the before-measurement for Phase 1. Two things it establishes:

1. **The detector is not empty by construction.** It found the known Instantly bounce gap
   on its first run, unprompted, at the right size.
2. **Nothing else disagrees, per campaign.** `sent`, `opened`, `replied` and `clicked`
   returned no rows for any of the 43 campaigns in either vendor — a stronger regression
   guard than the aggregate totals in Step 0, because it holds campaign by campaign.

**Surprises:** one, minor. `both` is a reserved word in Postgres; the CTE named `both`
failed to parse and is now `all_pairs`. No effect on behaviour.

**Not verified:** whether `v_reconciliation` stays green through a sync cycle. It is a
view over live tables, so it is re-evaluated on every read; that will show itself on the
next check.

---

## Step 2 · Phase 1 — the Overview stops lying about bounce

Four changes, one database migration and four files. Every number below was read at the
same instant as the one it is compared against.

### 2a · `v_daily_facts` — migration `20260818191258_v_daily_facts_instantly_bounce_overlay`

Also written to `supabase/migrations/` under the same name.

The daily notebook with the hole named instead of filled:

1. **Instantly campaign-day `bounced` is NULL, never 0.** The column default invented the
   0; nothing ever measured it.
2. **The company-wide Instantly bounce arrives as overlay rows** — one per date,
   `campaign_id` NULL, carrying only `bounced`, summed from `email_account_daily`.
3. **`delivered` is derived as `sent - bounced`**, never stored. NULL bounce gives NULL
   delivered.

**A limit the data forced, which is not in PLAN.md and is now on screen.**
`email_account_daily` is refreshed by the **03:00 ET nightly** run, not the 30-minute one.
Measured: Instantly has sent on **22 distinct days**; `email_account_daily` covers **21**.
The missing one is always **today**.

```sql
-- 22 send days, 21 mailbox days, 1 send day with no mailbox row: today
```

So the overlay emits a row for every date Instantly was active from *either* side, and
that date's `bounced` is **NULL rather than absent**. A missing row would silently read as
"no bounces today" — the same lie one level up. The consequence is visible in the tile: it
prints the total **and the date it is counted through**.

**Proof, 2026-08-18 19:13:06 UTC:**

| | |
|---|---|
| `v_daily_facts` rows | 543 (521 campaign-day + 22 overlay) |
| overlay rows whose bounce is not yet known | **1** (today) |
| `sum(bounced)` from the view | **149** |
| `sum(bounced)` from `campaign_totals` | **149** |
| `count(*) from people where bounced` | **149** |
| Instantly campaign-days claiming a bounce | **0** |
| sent / opened / replied / clicked, view vs lifetime | 7,542 / 797 / 39 / 4 — identical both sides |

Hidden campaigns checked before relying on the equality: the 7 hidden lemlist drafts carry
0 sent and 0 bounced, so they cannot move either side.

### 2b · The canary goes green — migration `20260818191330_reconciliation_reads_v_daily_facts`

`v_reconciliation` was repointed from `daily_metrics` to `v_daily_facts`. The question it
answers changes from "do two stored copies agree" to "does the Overview equal /campaigns".

```
19:08:41 UTC   1 row    instantly · bounced · daily 0 · lifetime 72 · high
19:13:34 UTC   0 rows
```

**Five minutes apart, same view.** That is the point of having built it first: this green
is a state change that was observed, not an empty view assumed to mean health.

### 2c · `dailyRange()` reads the view, and pages — `lib/db.js:73`

- Source changed `daily_metrics` → `v_daily_facts`, plus a `source` column.
- **Paged** via `everyRow`, ordered by `metric_date` then `campaign_id`. It was unbounded
  and unordered against a 1,000-row PostgREST cap, at 521 rows and growing 13–28 a sending
  day. Past the cap there is no error — days simply stop arriving.
- `everyRow` **moved from `lib/inbound/queue.js` to `lib/db.js`**, because `queue.js`
  imports `db.js` and the reverse would be a cycle. `queue.js` imports it and re-exports
  it, so its two existing callers (`queue.js:78`, `system.js:72`) are untouched.

Both callers pick the view up at once: `app/page.jsx:18,79` and `app/health/page.jsx:12`.
**`/health` verified unchanged** — it reads only `sent`, and "Sent today" reads **3** on
the page against **3** in the base table at 19:18:42 UTC.

### 2d · The Overview — `app/page.jsx`, `components/ui.jsx`

Overlay rows carry no `campaign_id`, so the existing aggregation loop already skips them.
They are added afterwards, and **only to totals wide enough to hold them**:

| Scope | Bounce | Why |
|---|---|---|
| no Instantly in scope | real | lemlist writes it per campaign-day; nothing is missing |
| every campaign (rep = all) | real | the overlay *is* the whole-company figure |
| one rep's groups | **—** | a share of a company-wide number is not a thing |
| one group holding any Instantly campaign | **—** | 13 of 23 mailboxes serve several campaigns |

Group vendor mix is **asked of the data, not assumed** — grouping is derived from the
campaign name, so a group is not permanently one vendor. Measured today: no group mixes
vendors, but the code does not depend on that staying true.

`BounceCell` and `DrillCell` now distinguish **null from zero**: null prints an em dash,
carries `title="not known at this grain"`, and opens nothing. `pct()` would have read null
as a part of zero and printed a reassuring 0.0%.

**The page, read from the running dev server (port 3117), 19:16 UTC:**

```
TILE  Emails bounced = 149    note: 2% of sent · Instantly counted to Mon 17 Aug
```

Before: `77`, note `1% of sent · stop above 5%`.

By-campaign table — the three Instantly groups stopped claiming a perfect record:

| Group | Sent | Bounced before | Bounced now | Bounce % now |
|---|---|---|---|---|
| Chicago Retrofit | 3,574 | 0 | **—** | — |
| Canada — Justin's list | 1,504 | 0 | **—** | — |
| Roof Campaign — Mark Dolan | 545 | 0 | **—** | — |
| QEA Resellers | 1,721 | 70 | 70 | 4.1% |
| LBER — Boston | 198 | 7 | 7 | 3.5% |
| **Total** | 7,542 | **77** | **149** | **2%** |

`/campaigns`, scraped at the same instant, sums to 48 + 70 + 7 + 12 + 12 + 0 = **149**.

### 2e · The Bounced drill-down opens 149 people — `lib/db.js:181`

`altTable: "people"` was dead configuration — nothing in the repository read it. Rather
than add a reader for a key used once, the metric now declares `table: "people"` directly
and the `altFilter` line that already worked does the rest. `activities` holds 77 bounce
rows, all lemlist; the Instantly sync writes no bounce activity at all, so a list built
from it could only ever show half the people and would look complete.

**`/list?metric=bounced&range=all` renders: "149 people · all campaigns · all time".**
Tile 149, list 149.

The cost is stated on the page: this list cannot honour a date window, and the note now
says so — the same admission `opened` and `clicked` already carry.

### 2f · `loadDrafts` reads every row — `lib/inbound/queue.js:924`

Both reads paged and ordered. Measured before and after by reproducing the old query:

```
people rows read                  before: 1,000   after: 2,670
drafts with a person attached     before:   342   after:   906
```

**564 of 906 drafts were showing no person**, and which ones was whatever Postgres
returned — there was no `.order()`.

**One thing done beyond the brief, flagged for you to reverse if you disagree.** PLAN.md
names only the `inbound_people_view` read. The `inbound_emails` read two lines above it
had the identical `.limit(1000)` with no `.order()` and is at **906 rows**, not the 835 in
TRUST.md — 91% of the cap. It is fixed in the same edit. One line, same helper, and
leaving it would have meant returning to this function within weeks.

### Acceptance — `scripts/test-phase1.mjs`, all six pass

```
node scripts/test-phase1.mjs
ok — bounce 149 on both pages and in 149 people; 543 daily rows and 2670 inbound people, all of them
```

1. **Overview bounce == /campaigns bounce**, same instant — 149 = 149
2. **Bounced tile == rows in the list it opens** — 149 = 149
3. **`v_reconciliation` is empty** — 0 rows
4. **REGRESSION GUARD** — sent / opened / replied / clicked agree across both notebooks
5. **No Instantly campaign-day invents a bounce** — 0 rows claim one
6. **The ceiling** — `dailyRange` reaches all 543 daily rows, `loadDrafts` all 2,670
   inbound people, with no row returned twice

No test asserts a constant. Every one compares two sources read in the same breath, so the
suite survives the sync.

### Surprises

- **`email_account_daily` is a nightly table, not a 30-minute one.** Not stated in
  TRUST.md or PLAN.md. It means today's Instantly bounce is *always* unknown until 03:00,
  which is why the tile carries a "counted to" date rather than a bare number. Without
  this the default all-time view would have had to render `—`, and the acceptance test
  would have failed for an honest reason.
- **`inbound_emails` is at 906 rows, not 835.** TRUST.md's figure was eight days stale.
- **`both` is a reserved word in Postgres** (noted in Step 1).

### Not verified

- **Whether `v_reconciliation` stays green across a sync.** It is a live view, so this
  shows itself on the next 30-minute run. Worth one look tomorrow after the 03:00 nightly,
  which is the first time the overlay gains a day.
- **`next build`.** Deliberately not run — the dev server is up and a build wipes its
  cache. Verified instead by rendering `/`, `/campaigns`, `/list`, `/health` and
  `/inbound/drafts` off the running server (all HTTP 200) and by the query suite above.
- **Phase 1b is untouched and still gated** on one authenticated GET against
  `/campaigns/analytics/daily`. Until that is answered, per-campaign windowed bounce stays
  `—`. Nothing in this step assumes an answer either way.
- **Meetings, `/leads` (Phase 1c), Phase 0 and Phase 2 — not touched**, as instructed.

---

## Step 3 · The GET that gated Phase 1b — answered, and the answer is no

**The question** (PLAN.md Phase 1b, TRUST.md §10 item 1): does Instantly's
`/campaigns/analytics/daily` return a bounce field? The code stores no raw copy of that
response, so the database could not answer it. It needed one authenticated request.

**Two requests were made, read-only, against the workspace's own analytics.**

**1 · Workspace aggregate, 22 July** — a day `email_account_daily` records **18 bounces**:

```json
{"date":"2026-07-22","sent":221,"contacted":221,"new_leads_contacted":221,
 "opened":0,"unique_opened":0,"replies":0,"unique_replies":0,
 "replies_automatic":3,"unique_replies_automatic":3,
 "clicks":0,"unique_clicks":0,"opportunities":0,"unique_opportunities":0}
```

**2 · Scoped to one campaign** — `Chicago Retrofit — Property Mgmt — Variation A`,
`efe5d81c…`, which carries **17 lifetime bounces**, across its five busiest days
(20–24 July):

Identical thirteen fields on every row. `sent`, `contacted`, `new_leads_contacted`,
`opened`, `unique_opened`, `replies`, `unique_replies`, `replies_automatic`,
`unique_replies_automatic`, `clicks`, `unique_clicks`, `opportunities`,
`unique_opportunities`.

**There is no bounce field. Not named `bounced`, not `bounced_count`, not absent-on-some-days
— not present at all, on the aggregate or the per-campaign call, on days that demonstrably
bounced.**

### What this settles, permanently

- **Phase 1b cannot be built.** There is nothing to add to the Instantly daily write. The
  eleven columns the sync names are all the endpoint offers, minus `date`.
- **The `v_daily_facts` overlay is permanent, not a stopgap.** It was written as the thing
  to drop once the daily API filled the gap. The API does not fill it.
- **Per-campaign, per-window Instantly bounce is permanently unavailable.** The `—` now
  showing on the three Instantly rows of the by-campaign table is the final answer, not a
  placeholder. `/campaigns` continues to carry the lifetime figure, which is real.
- **The lifetime endpoint remains the only Instantly bounce source with a campaign on it,**
  and `email_account_daily` the only one with a date. No single source has both, and none
  can be built from these APIs.

Written back into `PLAN.md` Phase 1b, which asked for exactly this.

**A side observation, not chased.** Asking the aggregate endpoint for `2026-07-22` to
`2026-07-22` returned **two** rows, 22 *and* 23 July. The per-campaign call for 20–24 July
returned exactly five, inclusive both ends. So the window is not honoured identically on
both call shapes. This bears on TRUST.md §10 item 4 (are `start_date`/`end_date`
inclusive) and is now partially answered: **inclusive when scoped to a campaign,
not reliably so in aggregate.** The sync only ever calls it per campaign, so nothing today
depends on the aggregate's behaviour. Logged, not investigated further.

---

## Step 4 · The canary goes on a page someone looks at — `app/health/page.jsx`

A view that goes red is only a contract if somebody sees it go red. `v_reconciliation`
existed after Step 1 and **nothing read it**.

`/health` now leads its Data integrity block with it: campaign, tool, metric, daily /
lifetime, off-by with a sign, severity coloured. A `campaign_id` links to `/c/[id]`; the
company-wide Instantly bounce row has none and renders as plain text.

**`v_metric_drift` is kept, not replaced**, under its own heading — and this is a
correction to my first instinct, which was to delete it as a check that cannot fail.
It compares `daily_metrics` against `activities`; `v_reconciliation` compares
`daily_metrics` against `campaign_totals`. Since `refresh_lemlist_totals()` derives the
lifetime side *from* the daily side, a broken lemlist rebuild would corrupt both sides
identically and `v_reconciliation` would stay green. `v_metric_drift` reads the event
stream, which that function does not write. It sees something the new one structurally
cannot. The page now says which is which instead of calling both "data integrity".

### Both branches proven, not just the green one

The empty state is easy to ship untested, and an unexercised red branch is the same
failure as an empty canary.

```
19:21  /health  →  "Clean — the Overview and /campaigns agree on every metric, on every campaign."
```

Then a throwaway view `v_reconciliation_selftest` returning two synthetic rows was created,
the page pointed at it for one render, and the page pointed back:

```
Campaign                 | Tool      | Metric  | Daily / lifetime | Off by | Severity
all instantly campaigns  | instantly | bounced | 0 / 72           | +72    | high
a lemlist campaign       | lemlist   | sent    | 100 / 102        | +2     | medium
```

`v_reconciliation` itself was never touched, and the selftest view was dropped —
verified: `0` views named `v_reconciliation_selftest` remain.

---

## Step 5 · `busyOf` stops locking a company out — `lib/inbound/queue.js:511`

The interface and the database disagreed about when a run is still alive:

```
inbound_request_rerun (20260817212239:57)   status = 'running' AND started_at > now() - interval '2 hours'
busyOf (before)                             status === 'running'                       ← no age check
```

Nothing marks a run finished, so a crashed run left `status = 'running'` forever and the
Restart button greyed out permanently — **on a company the database would have restarted
happily.** The interface refusing what the guard behind it allows is worse than either
rule alone, because there is no route out of it from the screen.

`busyOf` now applies the same two hours, as a named constant citing the migration it
mirrors.

**Live state, 19:23:08 UTC — this is latent, not currently biting:**

| | |
|---|---|
| runs with `status = 'running'` | **0** |
| running past the SQL guard's 2 hours | **0** |
| companies locked out right now | **0** |

### `scripts/test-busy.mjs` — and it was made to fail first

Eight cases pinning `busyOf` to the SQL guard: live at one minute, dead at three hours,
live at one minute *under* the boundary, a row with no `started_at`, the twenty-second gap
where only the request row exists, a ten-minute-old dead dispatch, a run that has reported
since the press, and a crashed run under a fresh press.

Proving the test tests something — `RUN_LIVE_MS` temporarily set to `Infinity`, restoring
the old behaviour:

```
--- with the bug restored:
AssertionError: a run running for 3 hours still blocks the button the database would allow
--- restored:
ok — busyOf agrees with the 2-hour guard in inbound_request_rerun
```

### Surprises

- **The Instantly daily endpoint is thinner than assumed.** TRUST.md §10 called the answer
  "one line or three". It is neither — the field does not exist, so the honest `—` is
  permanent. Worth saying plainly: this is the first finding in this work that *closes* a
  door rather than opening one, and it makes `v_daily_facts` load-bearing forever rather
  than transitional.
- **`/health`'s first curl after an edit showed the stale branch.** The dev server had not
  finished recompiling. Every page reading in this log is from a second request made after
  compilation settled — worth knowing for anyone verifying this way.

### Not verified

- **`v_metric_drift`'s red branch.** Only `v_reconciliation`'s was exercised. That code
  path is untouched by this work and predates it.
- **Whether any company was ever actually locked out by `busyOf`.** There is no history of
  run status to answer it from; today the count is 0.

---

## Step 6 · Phase 3 — stop rendering "unknown" as "0"

Purely preventive. It fixes no number visible today — Phase 1 did that — and PLAN.md says
so up front. What it buys is that the *next* forgotten column announces itself on screen
the day it is forgotten, instead of hiding as a plausible zero for three weeks.

### 6a · The classification, written down before any DDL

PLAN.md's Phase 3 insists this comes first, so the migration follows from it rather than
being reasoned out mid-flight. It was **measured**, not recalled: non-zero row counts per
vendor, cross-read against both writers — `syncInstantly` (`functions/sync/index.ts:249`)
and `refresh_lemlist_daily_metrics` (`20260730135341:40`).

| column | instantly | lemlist | verdict |
|---|---|---|---|
| sent, contacted, opened, replied, replies_automatic, clicked | written | written | measured → null when absent |
| **bounced** | **MISSING** | written | measured → null when absent |
| **new_leads_contacted** | written | **MISSING** | measured → null when absent |
| **unique_opened** | written | **MISSING** | measured → null when absent |
| **unique_replied** | written | **MISSING** | measured → null when absent |
| **unique_clicked** | written | **MISSING** | measured → null when absent |
| delivered | MISSING | written | **derived** — nobody should store it |
| linkedin_sent, linkedin_accepted | n/a | written | **0 is correct — default kept** |
| opportunities | written | n/a | **0 is correct — default kept** |

**Three findings here are not in TRUST.md.** Its mirrored-bug table (F4) lists only
`new_leads_contacted` on the lemlist side. The rebuild function also never writes
**`unique_opened`, `unique_replied` or `unique_clicked`** — the same bug, three more
instances, invisible for exactly the same reason the bounce one was: no page displays them.

The bottom two rows are why this was not "null every zero". Instantly has no LinkedIn, so
its `linkedin_sent = 0` is a fact. Nulling it would print "—" for a number we are certain
of — a new lie pointing the other way.

### 6b · Layer 1 — the schema — migration `20260818192740_daily_metrics_unknown_is_null_not_zero`

Checked first: **every metric column is nullable**, so dropping a default cannot make an
insert fail. Twelve defaults dropped, three kept:

```
sent contacted new_leads_contacted delivered bounced opened unique_opened
replied unique_replied replies_automatic clicked unique_clicked      → no default
linkedin_sent  linkedin_accepted  opportunities                      → default 0 kept
```

Verified after: 521 rows unchanged, bounce still 149 = 149, `v_reconciliation` still 0.

**The contract proven end to end, in a transaction that was rolled back.** An insert naming
exactly the eleven columns `syncInstantly` names:

| unnamed column | what it became |
|---|---|
| `bounced` | **null** |
| `delivered` | **null** |
| `linkedin_sent` | `0` |
| `linkedin_accepted` | `0` |

Rollback confirmed clean afterwards: 0 rows at the test date, 521 rows total.

### 6c · Layers 2 and 3 — `addInto` and `num()`, `lib/db.js`

```js
num:     (n ?? 0).toLocaleString("en-US")        →  n == null ? "—" : n.toLocaleString("en-US")
addInto: acc[k] = (acc[k] ?? 0) + (row[k] ?? 0)  →  skip null; acc[k] = (acc[k] ?? 0) + v
```

All three layers had to move together. The column default alone would have changed nothing,
because these two put the zero straight back.

**Known limitation, stated rather than papered over.** The accumulator is still seeded from
`EMPTY`, which is all zeros, so a total assembled *entirely* from nulls reads `0` rather
than `—`. Seeding with null instead would fix that — and would also make a group with **no
rows at all** print `—` for sent, which is a different lie. Those two cases ("rows that did
not say" vs "nothing happened") need telling apart before that change is safe. The one
metric where it matters today, bounce, is handled explicitly in `app/page.jsx`. This is
noted in the code, not just here.

### The verification that mattered: 21 pages, rendered twice

`num()` is called everywhere, so the risk was a number somewhere quietly turning into an
em dash. Counting em dashes proves nothing — the prose is full of them. So every page was
rendered with the new `num()`, then `num()` was reverted, every page rendered again, and
`num()` restored. Tag-stripped text diffed pair by pair.

```
pages differing: 15 of 21
```

**Every single difference is a relative clock:** `29 min ago` → `28 min ago`, and on
`/pipeline` also `35 min ago` → `34` and `7 hours ago` → `6 hours`. The two capture runs
were a minute apart.

**Not one number changed.** Which is the expected result and the point: no null reaches
`num()` in today's data, so the change is inert now and only speaks when a genuine unknown
appears. The em-dash path *is* exercised today — through `DrillCell` and `BounceCell` on
the three Instantly rows of the by-campaign table — so it is not untested code.

Pages covered: `/`, `/campaigns`, `/campaigns/[slug]`, `/c/[id]`, `/health`, `/leads`,
`/replies`, `/meetings`, `/calls`, `/conflicts`, `/inboxes`, `/inbound`, `/inbound/drafts`,
`/inbound/system`, `/pipeline`, and six `/list` metrics. All HTTP 200.

Both suites re-run green afterwards.

### Surprises

- **`daily_metrics` has no reader left in the application.** Grepped across `app/`, `lib/`,
  `components/` and `scripts/`: the only mentions are two comments in `lib/db.js`. The two
  views `v_group_daily` and `v_daily_totals` read it and **nothing reads them** — they are
  dead. That made the DDL far safer than expected, and it is worth knowing before anyone
  "fixes" those views.
- **`delivered` is now vestigial.** No page reads the stored column; `v_daily_facts`
  derives its own. It is left in place because `refresh_lemlist_daily_metrics` still writes
  it and removing it means editing that function for no user-visible gain. Flagged as a
  loose end rather than done.

### Not verified

- **That a real sync writes NULL.** Proven for a hand-made insert of the same shape; the
  next 30-minute run is the live confirmation. Nothing depends on it — `v_daily_facts`
  already forces Instantly bounce to NULL regardless of what the column holds.
- **The `EMPTY`-seeding question above.** Deliberately left; it is a judgment about two
  cases that look identical today.

---

## Step 7 · Phase 4 — make the system catch the next one itself

Committed `07467f6` first (Phase 1 + Phase 3). This step is the database-side half of
Phase 4. The sync-writer half — reading the discarded `error` on all thirteen writes — is
**not** here; it needs an edge-function deploy that the cron depends on, and that wants
saying out loud before it happens.

### 7a · Testing PLAN.md's invariants before writing them down — and the list changed

PLAN.md proposed four: `bounced <= sent`, `opened <= sent`, `clicked <= sent`,
`delivered = sent - bounced`. Each was run against live data first.

**At campaign-day grain, three of the four are false-positive machines:**

| candidate rule | violations today |
|---|---|
| daily `opened > sent` | **11** |
| daily `replied > sent` | **3** |
| daily `bounced > sent` | **1** |
| daily `clicked > sent` | 0 |

**None is a fault.** An open is dated when it happens; the send that earned it was days
earlier. Any per-day comparison of an outcome against a send compares two different
cohorts. Shipping PLAN's list as written would have put **fifteen permanent red rows** on
`/health` on the first afternoon — and a panel that is always red is a panel nobody reads.
The same failure as `v_metric_drift`'s permanent green, reached from the other side.

**At lifetime grain, `opened`/`clicked`/`replied` still are not sound** even though they
hold on all 42 campaigns today. `opened` counts opens, not openers — Instantly keeps
`unique_opened` as a separate column precisely because one person opens six times. A
campaign with 100 sent and 150 opens is ordinary. A rule that is only incidentally true is
a future false alarm, so all three are out.

### 7b · The one rule that fired — and the bug behind it

`delivered = sent - bounced` came back with **one** violation:

```
QEA Resellers — Chicago (Referral)   sent 328   bounced 17
stored delivered 313                 sent - bounced = 311
```

Root cause found in the data, not guessed:

```sql
select metric_date, sent, bounced from daily_metrics
where campaign = 'QEA Resellers — Chicago (Referral)' and bounced > 0;
...
2026-07-25    sent 0    bounced 2      ← greatest(0 - 2, 0) = 0, not -2
```

`refresh_lemlist_daily_metrics` stores each day as `greatest(sent - bounced, 0)`
(`20260730135341:47`) and `refresh_lemlist_totals` sums those days. On 25 July that
campaign recorded **0 sent and 2 bounced** — entirely normal, because a bounce is dated
when it arrives and the send that caused it was days earlier. The clamp swallowed the −2
and the lifetime total inherited it.

**So per-day `delivered` is not a quantity that means anything.** Bounces lag sends; any
per-day difference of the two is an artefact of that lag. This is the strongest evidence
yet for PLAN.md §1's rule that derived facts must not be stored — the one place a derived
fact *was* stored is the one place it drifted.

### 7c · `delivered` becomes a formula everywhere — migration `20260818193555`

`v_campaign_summary` still read `COALESCE(t.delivered, 0)`. It now computes
`COALESCE(t.sent,0) - COALESCE(t.bounced,0)`, matching `v_daily_facts`.

| | before | after |
|---|---|---|
| QEA Resellers — Chicago (Referral) | 313 | **311** |
| `sum(delivered)` across `v_campaign_summary` | 7,395 | **7,393** |
| `sum(sent) - sum(bounced)` | 7,393 | 7,393 |
| campaigns where `delivered <> sent - bounced` | 1 | **0** |
| `/campaigns` group row, QEA Resellers | 1,653 | **1,651** |

`/campaigns` group rows now sum 3,526 + 1,651 + 191 + 1,492 + 533 + 0 = **7,393**.

Both stored `delivered` columns are vestigial after this. Nothing in `app/`, `lib/` or any
view reads either. Left in place because `refresh_lemlist_daily_metrics` still writes them
and removing them is a separate change with no visible payoff. **Loose end, named.**

### 7d · `v_invariants` — migration `20260818193651`

What survives is the set that cannot be violated without something being genuinely wrong:

1. `bounced_exceeds_sent` — lifetime. A bounce requires a send.
2. `mailbox_bounced_exceeds_sent` — the same rule on `email_account_daily`, which is what
   feeds the Overview's bounce overlay. If this fires, the tile is built on bad input.
3. `negative_metric` — lifetime.
4. `negative_metric_daily`.
5. `sent_but_no_lifetime_row` — TRUST.md F5: a campaign that has demonstrably sent with no
   `campaign_totals` row would vanish from `/campaigns` permanently and nothing would say
   so. Zero today; the one campaign lacking a totals row has never sent.

`delivered = sent - bounced` is **not** in the list — after 7c there are not two copies to
compare, and an invariant over a formula checks arithmetic, not data.

**All five made to fire, once each, in a transaction that was rolled back:**

| rule | what it printed |
|---|---|
| bounced_exceeds_sent | `705 bounced against 700 sent, lifetime` |
| mailbox_bounced_exceeds_sent | `6 bounced against 3 sent on 17 Aug` |
| negative_metric | `lifetime: sent 0, delivered 0, bounced 0, opened -7, …` |
| negative_metric_daily | `03 Aug: sent 46, bounced 0, opened 2, replied 0, clicked -2` |
| sent_but_no_lifetime_row | `467 sent across 23 days, and no campaign_totals row` |

Rollback verified clean afterwards: 42 totals rows, 521 daily, 244 mailbox, 0 violations,
149 = 149, no negative minimums.

### 7e · The run that had been "running" for ten days — migration `20260818193736`

```
id 561   incremental   status running   started 2026-08-08 20:30:03 UTC
         age 9 days 23:03   rows_upserted 0   error null
```

The sync writes a `running` row, works, then updates it. If the invocation dies between —
crash, wall clock, or `trigger_sync`'s 280-second `pg_net` timeout — the closing update
never happens. `/health` shows the last twelve runs, so this scrolled out of sight within a
day. **Every "is the sync alive" answer this dashboard has given for ten days read straight
past it.**

`reap_stuck_sync_runs()` marks anything `running` and older than 30 minutes as `error`
with a self-explaining message. Thirty minutes because the sync runs every thirty: a run
still open when the next is dispatched is finished one way or another, and it cannot
legitimately be long — `trigger_sync` gives up at 280 seconds.

**Called from `trigger_sync`, not from its own cron entry**, so it happens exactly when it
matters: immediately before a new run starts, the moment a stale row would be mistaken for
a live one. `trigger_sync` was reproduced from its *live* definition rather than the
original migration, so nothing applied to production in between was silently reverted.

Run once, live:

```
reap_stuck_sync_runs() → 1

id 561  status error  finished_at 2026-08-18 19:37:40Z
error: "no result after 30 minutes - the invocation died before it could report.
        Reaped 9 days 23:07:37 after it started."
```

`sync_runs` now reads 1,046 ok / 2 partial / 1 error, and **0 running**.

### 7f · Both blocks on `/health`

New section "Things that must never be true", with prose saying which rules were left out
and why — so the next person does not helpfully add `opened <= sent` back.

```
/health, 19:38 UTC
  Data integrity — do the pages agree with each other → Clean, on every campaign
  Things that must never be true                      → Clean, nothing impossible is true
  lemlist rebuild                                     → Clean
  Group status                                        → Clean
```

### Acceptance — `scripts/test-phase1.mjs`, now nine tests

```
ok — bounce 149 on both pages and in 149 people; 543 daily rows and 2672 inbound
     people, all of them; 0 drift, 0 broken invariants, 0 hanging runs
```

Added: **7** `v_invariants` empty, **8** `delivered = sent - bounced` on every campaign,
**9** no sync run stuck past the 30-minute reap.

### Surprises

- **PLAN.md's invariant list was wrong**, and only measuring showed it. Three of its four
  rules fire on healthy data at the grain it implied. This is the second time in this work
  that testing a detector against reality before shipping it changed what got shipped.
- **A real bug fell out of a check that was only meant to be preventive.** The `delivered`
  drift had been on `/campaigns` since the lemlist rebuild landed on 30 July and nothing
  had ever compared the number to its own definition.
- **`sync_runs` had 1,046 ok rows and one ten-day-old lie**, and the lie was structurally
  invisible because the page shows twelve rows.

### Not verified

- **The reaper firing on its own.** Proven by direct call; the cron path runs it on the
  next dispatch. Nothing depends on the timing.
- **`/health`'s sync log still shows only the last twelve runs.** A reaped run is now
  marked `error`, but it will scroll out of view exactly as the stuck one did. Surfacing
  non-`ok` runs regardless of recency is an obvious follow-on and is **not** done.
- **The thirteen discarded write errors in the sync** (PLAN Phase 4). Needs an edge-function
  deploy — flagged, not started.

---

# Divergences — where this work departed from TRUST.md and PLAN.md

Both documents were settled before execution and were not re-litigated. But execution
found things that reading could not, and in eleven places the built thing differs from the
written thing. Each is listed with what changed, why, and whether it needs a decision from
anyone. **Nothing here was a preference. Every one came from a measurement.**

Committed in `07467f6` and `df29d25`.

---

### D1 · `v_reconciliation` reconciles Instantly bounce company-wide, not per campaign
**PLAN Phase 4:** *"per campaign, per metric: daily total vs lifetime total."*
**Built:** per campaign for every pair **except** Instantly bounce, which is one row for
the whole vendor with `campaign_id` null.

The dated Instantly bounce lives only in `email_account_daily`, keyed on the mailbox, and
13 of 23 mailboxes send for more than one campaign. Reconciling it per campaign would
compare a real lifetime figure against a NULL daily one on all 23 Instantly campaigns
forever — 23 permanent red rows that no fix could ever clear. **Consequence:** if a single
Instantly campaign's bounce total drifts but the company total does not, this view will not
see it. That trade is deliberate and is the price of not having campaign-level dated bounce
at all (see D3).

### D2 · The Bounced tile is a floor with a date on it, not an em dash
**PLAN Phase 1:** company-wide bounce over any date window is *"real"*.
**Built:** real, but labelled *"Instantly counted to Mon 17 Aug"*.

`email_account_daily` is refreshed by the **03:00 ET nightly** run, not the 30-minute one —
a fact in neither document. Measured: Instantly has sent on 22 distinct days, the mailbox
table covers 21, and the missing one is always today. A strict reading ("one unknown day
makes the window unknown") would render the default all-time Overview as `—`, which is
useless and would have failed the acceptance test for an honest reason. The number shown is
the sum of known days with the boundary stated on screen. **This is the one place the
dashboard now shows a deliberately incomplete number** — and unlike the 77 it replaces, it
says so.

### D3 · Phase 1b is closed, not deferred
**PLAN Phase 1b:** gated on one GET; *"if yes, the sync writes it per campaign per day."*
**Found:** there is no bounce field. Two authenticated reads, aggregate and per-campaign,
on days with recorded bounces — thirteen fields, none of them a bounce.

The overlay is permanent rather than transitional, and per-campaign windowed Instantly
bounce is **unavailable**, not merely unbuilt. Written into PLAN.md. See Step 3.

### D4 · `altTable` was deleted rather than wired
**PLAN Phase 1:** *"`lib/db.js:181` already declares `altTable: "people"` … Wire it."*
**Built:** the metric declares `table: "people"` directly; `altTable` and its unused
`event` are gone.

`altFilter` was already read inside the `people` branch, so pointing the metric at `people`
made the list work with no new code. Adding a reader for a key used exactly once would have
been more code for the same result. Same outcome — 149 people — smaller diff.

### D5 · `everyRow` moved modules
**PLAN Phase 1:** *"The `everyRow` helper already exists two lines above it."*
It is ~880 lines above `loadDrafts`, in `lib/inbound/queue.js`, which imports `lib/db.js`.
`dailyRange` needed it too, and importing back the other way is a cycle. Moved to
`lib/db.js` and re-exported from `queue.js`, so its two existing callers are untouched.

### D6 · `loadDrafts`: both reads paged, not one
**PLAN Phase 1** names only `inbound_people_view`. `inbound_emails`, two lines above, had
the identical `.limit(1000)` with no `.order()` and is at **906 rows** — 91% of the cap,
not the 835 TRUST.md records. Fixed in the same edit. **Reversible in one line if you
disagree.**

### D7 · Phase 3 dropped twelve defaults, not five
**PLAN Phase 3** classifies five columns by name. Measuring both writers found the same
omission in **three more**: `refresh_lemlist_daily_metrics` never writes `unique_opened`,
`unique_replied` or `unique_clicked` either — absent from TRUST.md F4's mirrored-bug table.
Defaults were dropped on every column that is a measurement (12), and kept on the three
that are genuinely not-applicable (`linkedin_sent`, `linkedin_accepted`, `opportunities`),
which is PLAN's own stated rule applied to the full list rather than the sample.

### D8 · Phase 3's `EMPTY` seed was left alone, and the gap is real
PLAN's three layers were applied exactly as written. But the accumulator is seeded from
`EMPTY`, which is all zeros, so **a total assembled entirely from nulls still reads `0`,
not `—`.** PLAN does not mention this and it limits the phase's stated purpose: a forgotten
column announces itself in a *cell*, but not yet in a *tile*.

Seeding with null would fix it and would also make a group with **no rows at all** print
`—` for sent — a different lie. "Rows that did not say" and "nothing happened" need telling
apart first. **Left undone on purpose; noted in the code as well as here.** The one metric
where it matters today, bounce, is handled explicitly in `app/page.jsx`.

### D9 · `v_metric_drift` was kept, not replaced
**PLAN Phase 4** presents `v_reconciliation` as the answer to `v_metric_drift` being empty
by construction. My first instinct was to delete it. That was wrong: it compares
`daily_metrics` against `activities`, while `v_reconciliation` compares `daily_metrics`
against `campaign_totals`. Since `refresh_lemlist_totals` derives the lifetime side *from*
the daily side, a broken lemlist rebuild would corrupt both of `v_reconciliation`'s sides
identically and leave it green. `v_metric_drift` reads the event stream, which that
function does not write. Both are on `/health` under headings that say what each can see.

### D10 · Phase 1 did not finish making `delivered` derived; Phase 4 did
**PLAN Phase 1:** *"`delivered` is derived as `sent − bounced` in the view and never stored
again."* That was done in `v_daily_facts` — but `v_campaign_summary`, which is what
`/campaigns` actually reads, went on reading the stored `campaign_totals.delivered` until
Step 7c. So between the two commits the two halves of the dashboard still computed one word
two ways. **Phase 1 as specified was incomplete**, and the incompleteness was worth 2 on
screen (313 against 311).

### D11 · Phase 4's invariant list was wrong and was rewritten
**PLAN Phase 4:** `bounced <= sent`, `opened <= sent`, `clicked <= sent`,
`delivered = sent - bounced`.
**Measured:** at campaign-day grain the first three return 1, 11 and 0 rows today — plus
`replied > sent` at 3 — on entirely healthy data, because outcomes lag sends. At lifetime
grain `opened`/`clicked`/`replied` hold today but are not structurally sound, since `opened`
counts opens rather than openers. `delivered = sent - bounced` stopped being a comparison
once D10 made it a formula.

The shipped set is five structural rules, all silent today, each made to fire once against
a corrupted row in a rolled-back transaction. **This is the largest divergence** and the
full reasoning is in Step 7a.

---

## Corrections to TRUST.md's recorded facts

Not divergences — measurements that have moved or were wrong when written.

| TRUST.md | Measured 18 Aug ~19:00 UTC |
|---|---|
| `inbound_emails` 835 rows | **906** |
| `inbound_people` 2,652 | **2,670** (2,672 by 19:45 — it grows) |
| `daily_metrics` 520 | **521** |
| `opened` 796 | **797** |
| F4's mirrored-bug table: lemlist misses `new_leads_contacted` | also misses **`unique_opened`, `unique_replied`, `unique_clicked`** |
| §10 item 4: are the daily endpoint's dates inclusive? | **inclusive when scoped to a campaign**; an aggregate call for a single day returned two |
| §13: one `sync_runs` row stuck `running` since 8 Aug | **reaped** — now `error`, 0 running |
| F5: a campaign has no `campaign_totals` row | still true; it is Instantly and has **never sent**, so it is harmless — not the lemlist no-sequence case F5 describes |

## Still open, and needing a person rather than a query

- **The sync's thirteen discarded write errors** (PLAN Phase 4). Needs an edge-function
  deploy that the cron depends on. **Not started — waiting on an explicit go-ahead.**
- **`leads.status` vocabulary** (PLAN Phase 1c). PLAN says *"Ask before choosing — do not
  infer it."* Unanswered, so Phase 1c is untouched.
- **Phase 0 and Phase 2** — the Baris insert, the Jeffrey Hohenstein question, and
  `source_call_id`. Deferred to the end by instruction; nothing here touches meetings.
- **`/health`'s sync log shows twelve runs.** A reaped `error` will scroll out of sight
  exactly as the stuck one did.
- **Two vestigial `delivered` columns**, in `daily_metrics` and `campaign_totals`. Nothing
  reads either.

---

## Step 8 · Phase 5 — "live" answers itself

The guarantee: nobody types whether a campaign group is still running; the dashboard
derives it, every read, from what the campaigns inside are doing.

### 8a · A correction from Tanay that changed the design

Mid-build, on seeing `lber` typed `ended` with one campaign the vendor still calls
`running`: **"the lber campaign that is running is an old one, you can ignore that one."**

That is not a detail, it is the whole design. The obvious derivation —
`running_count > 0 → live` — would have made the dashboard start announcing that lber is
live, contradicting a human who is correct. **The vendor's `running` flag is not evidence
that a group is live.**

But the opposite rule fails too. `qea` last sent 4 days ago and has **zero** running
campaigns: nothing further can go out, so recent activity does not mean it is live either.

So `actual_status = live` requires **both** signals, and either one failing ends it:

```
live     a campaign the vendor still calls running  AND  a send within 14 days
ended    it has sent at some point, and one of those two is missing
planned  it has never sent
```

### 8b · The 14 days is measured, not invented

The one tunable number, so it was taken from the data rather than picked:

| group | send days | largest gap while active | days since last send |
|---|---|---|---|
| chicago-retrofit | 22 | 3 | 0 |
| qea-resellers | 24 | 4 | 1 |
| qea | 12 | 4 | 4 |
| roof-campaign-mark-dolan | 3 | 1 | 5 |
| lber | 14 | **7** | **27** |

**No group has ever had a gap longer than 7 days while genuinely active.** Fourteen is
double the observed maximum — room for a holiday week without a group flickering between
states. It is named in the migration as a calibration knob, not a law.

### 8c · Result — all six groups, checked against what a person says they are

| group | typed intent | derived actual | agrees with reality? |
|---|---|---|---|
| chicago-retrofit | live | **live** | yes — 2 running, sent today |
| qea-resellers | live | **live** | yes — 2 running, sent yesterday |
| roof-campaign-mark-dolan | live | **live** | yes — 1 running, sent 5 days ago |
| **lber** | ended | **ended** | **yes — and this is the case that mattered** |
| **qea** | live | **ended** | **drift, correctly caught** — 0 of 11 running |
| ungrouped | abandoned | planned | never sent |

`Canada — Justin's list` now reads **ended** on both the Overview and `/campaigns`, where
it has read a stale `live` for days.

### 8d · The canary fires in both directions now — migrations `…195031`, `…195103`

The old `v_group_status_drift` fired only on `planned`/`abandoned` groups that were
sending, never on the far commoner opposite. It now fires both ways, and returns exactly
one row:

```
Canada — Justin's list   typed live   actually ended   0/11 running   last sent Fri 14 Aug
"labelled live, but none of its 11 campaigns is running any more — nothing further can go out"
```

**The first wording of that message was wrong and was fixed in its own migration.** It
asserted "has not sent in over a fortnight" for every row, and the only row it produces
sent 4 days ago — `qea` is ended because nothing is running, not because it went quiet. A
canary that misreports the reason sends someone to check the wrong thing.

**lber deliberately does not appear.** Typed `ended`, one campaign the vendor calls
running, and derived `ended` because it has not sent in 27 days. A one-signal rule would
have reported the human's correct label as an error.

### 8e · `platform` — a fallback, not a replacement (diverges from PLAN)

PLAN Phase 5 says *"derive `platform` from `campaigns.source`."* Measured first:
**`lber.platform` is `{lemlist, hubspot}` while its only campaign source is lemlist.** The
`hubspot` entry is human knowledge no campaign row can reproduce, and deriving would have
silently deleted it.

So the typed value wins where one exists and the derived value fills a blank. That fixes
the actual complaint — a blank platform draws Instantly campaigns in the lemlist colour
(`app/campaigns/page.jsx:43`) — without destroying anything a person entered.
`ungrouped` went from `[]` to `["instantly"]`; `lber` kept both of its entries.

### 8f · One read for a group — migration `…195147`

`repList()` read `campaign_groups` directly because `sort_order` was the one field the
summary lacked. That would have left the Overview showing typed status while `/campaigns`
showed derived — the two pages disagreeing about a word again. `sort_order` appended to
`v_group_summary`; `repList` now reads the view.

### 8g · `status_changed_at` — migration `…195333`

NULL on all 43 rows since the first migration; nothing had ever written it. A `before
update` trigger stamps it when `status is distinct from` its previous value —
`is distinct from`, not `<>`, because either side can be NULL.

**Verified in a rolled-back transaction:**

| operation | rows stamped |
|---|---|
| one genuine status change | **1** |
| a no-op re-sync touching every running campaign | **0** |

**No backfill is possible.** Nothing in this database records a past transition. Every row
stays NULL until its campaign next changes state, and **a NULL here means "not observed
since 18 Aug", not "never changed"** — a distinction that cannot be removed retroactively.

### Verification

Both suites green. Nine pages HTTP 200 including `/campaigns/qea` and `/campaigns/lber`.
Live state after all of it: 1 group-status drift row, 0 metric drift, 0 invariant
violations, bounce 149 = 149, 0 rows stamped by the rolled-back trigger test.

### Surprises

- **The most important input in this whole session came from Tanay, not from a query.**
  No amount of measurement would have revealed that lber's running campaign is a leftover;
  the database says it is running and the vendor agrees. The two-signal rule exists because
  of one sentence.
- **`create or replace view` cannot insert a column**, only append. `v_group_status_drift`
  had to be dropped and recreated; `v_group_summary` could be replaced.

### Not verified

- **The trigger firing on a real sync.** Proven by direct update; the next status change a
  vendor reports is the live confirmation.
- **`ungrouped` reads `planned` where it used to read `abandoned`.** Both are grey dashed
  pills so it still reads as inactive, and the typed `abandoned` is untouched in the table.
  A group that was abandoned before it ever sent is genuinely both. Left as is.
- **The owner-setting block on `/health`** (PLAN Phase 5's last bullet). A group with a
  null owner still vanishes from the rep layer, and the only fix is still editing the
  database by hand. **Not built** — it needs a form and a server action, which is a
  different kind of change from everything above.

---

## Step 9 · Phase 6 — the repo can rebuild the database

**TRUST.md recorded two holes. There were twenty-four.**

Comparing `supabase/migrations/` against `supabase_migrations.schema_migrations` — the
database's own record of what it ran:

- **24 applied migrations had no file of that name here**, including `add_proposals`,
  `reply_identity_trigger`, seven inbound stage-3 migrations, the manual queue overrides
  and `v_inbound_stranded`. A rebuild would have produced a database missing tables the
  dashboard reads on every page load.
- **The two sides used different numbering.** Files carried hand-written round numbers
  (`20260730120000`); the database recorded real applied timestamps (`20260730132126`).
  19 files were the same migration under a different name — which is why a
  version-by-version comparison read as catastrophic and a name-by-name one showed the
  real gap.

### How it was rebuilt

Every migration's full SQL, comments included, is kept in `schema_migrations.statements` —
verified by pulling one and finding its prose intact.

**61 files were written straight from the database to disk, byte for byte**, routed
through a throwaway view rather than retyped: a transcription slip inside a function body
would not surface until someone tried to restore. The view was created, read, and dropped
inside a minute — confirmed gone afterwards.

**`schedule_sync` was excluded from the export.** It is the one migration whose recorded
SQL contains a live Vault token — checked by scanning all 62 for `create_secret`, JWT
shapes and secret-ish words, which returned exactly that one row. The repo copy stays
redacted to `<SUPABASE_ANON_KEY>`.

**Seven files kept their local prose instead.** Their statements matched what was applied
exactly, but the applied record had lost the comments — someone had run the statements
rather than the file. `group_mark_dolan_roof` was 4,134 bytes here against 1,401 recorded,
all of it reasoning. The larger version won.

**20 duplicates were removed**, each verified equivalent on statements first — comments
and whitespace stripped — never on byte size. Two needed judgement:

- **`conflicts_and_human_classification`** was one migration here and three in the database
  (`…235357`, `…235806 fill_reply_identities`, `…235834 reply_identity_trigger`). The split
  covers it.
- **`feedback`** differed for real. The applied version uses `--` inside two `raise
  exception` messages; the local file had been hand-edited to em dashes and never
  re-applied. **What runs won.** I initially read this diff backwards and said the opposite
  in conversation — corrected on re-reading.

### Where it stands

**63 files. 62 map one-to-one onto the recorded history.**

The 63rd, `20260728180000_inbound_schema.sql`, is the one honest irregularity: the database
has no record of it ever being applied, yet all eleven tables it defines exist in
production, created by the sibling `qea-inbound` repo through GitHub Actions. It is kept
because it is the **only definition of those tables anywhere in this repository** — a
rebuild without it comes up missing the entire inbound half and four pages fail on a
missing table. Its header now says exactly that. Safe to re-apply: all eleven creates are
`if not exists`, and enabling row level security twice is a no-op.

**All fourteen `inbound_*` tables in production now have a create statement somewhere in
this directory** — checked per table, not assumed.

`supabase/migrations/README.md` records the two queries that show it is still true.

---

## Step 10 · Phase 1c — `/leads` stops being a July snapshot

**Your answer: keep `leads.status` human-owned; rows never on a spreadsheet show `—`.**
Recorded here so it is not re-asked.

### `v_leads` — migration `20260818200717`

Live rows from `people`, plus the people who only ever existed on a spreadsheet, with the
human-only columns joined on email.

Two measured details shaped the SQL:

- **`leads` has 1,950 rows across only 1,921 distinct emails.** A direct join on email
  would have fanned a person into two rows. `lead_one` picks one row per address, oldest
  first.
- **53 leads rows have no matching person, across 24 distinct addresses.** TRUST.md's "24"
  counted people and mine counted rows — both right, and the view emits 24.

### Before and after

| | before | after |
|---|---|---|
| Total people | 1,950 | **2,780** |
| of which live in the tools | — | 2,756 |
| of which spreadsheet-only | — | **24** |
| carrying an imported status | 1,950 | 1,970 |
| showing `—` for status | 0 | **810** |
| rows with no group | — | 0 |

The 810 is exactly the number of people who were invisible on this page.

### Three honesty fixes on the page itself

- **The status cell renders `—`, not a pill**, when there is no imported status. 261 of
  them are visible in the first screenful.
- **The donut gained a "no imported status" slice.** Without it the ring described 71% of
  the list and looked like all of it.
- **The table says it is a slice.** `.limit(1000)` against 2,780 rows was already
  truncating silently at 1,950 before this change — the head-counts above it are exact
  (they read `Content-Range`, not the body), so only the table was ever short. It now
  prints *"Showing the first 1,000 of 2,780. Narrow by campaign, status, or search to see
  the rest."*

### Surprises

- **`/leads` was already silently truncating before any of this**, at 1,950 rows against a
  1,000 cap. TRUST.md F7 lists this page as *fixed* for the ceiling — the head-counts were
  fixed, the table was not.
- **`leads` contains 29 duplicate email addresses.** Not previously recorded anywhere.

### Not verified

- **Whether anyone wants the 810 to be assignable a status.** They render `—` and there is
  no way to set one from the interface. That is the honest state, not necessarily the
  desired one.
