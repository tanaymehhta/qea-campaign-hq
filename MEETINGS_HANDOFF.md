# Meetings — the complete handoff

Written 21 Aug 2026. Everything about the Meetings feature: what was wrong, what
has been fixed, exactly how, what is left, and every trap between here and done.

Companion documents:
- `MEETINGS_PLAN.md` — the six-phase plan and the six settled decisions.
- Migration headers `20260821000000`, `20260821010000`, `20260821020000` — the
  reasoning, in the repo's usual place.

**Every number in this document was measured live** against the production
database (`yfnqszwlyoyfhuwfmcyl`) and the running dev server. None is inferred
from reading code.

---

# PART 1 · THE SYSTEM

## 1.1 What "meetings" is

`public.meetings` is the primary KPI of this dashboard and **the only thing on
it that no tool records**. Instantly and lemlist sync everything else; this
table is kept by hand. That is the reason its write path validates so hard and
phrases every refusal as a sentence a salesperson can read.

## 1.2 The table

```
meetings
  id              uuid pk
  campaign_id     uuid  -> campaigns(id)         on delete set null
  group_id        uuid  -> campaign_groups(id)   on delete set null
  prospect_name   text
  prospect_email  text
  company         text
  meeting_date    date            the day it happens
  booked_on       date            the day it was agreed        (added 20 Aug)
  status          text  not null  booked | held | no_show | cancelled
  evidence        text  not null  tool | calendar | crm | chat
  logged_by       text            who typed it in
  note            text
  created_at      timestamptz
  source_call_id  uuid  -> phone_calls(id)       on delete set null
  origin          text  not null  manual | call
  deleted_at      timestamptz     removed as a mistake         (added 21 Aug)
  removed_reason  text                                          (added 21 Aug)
```

Partial unique index `meetings_one_per_source_call` on `source_call_id` where
not null — one meeting per call, enforced by the database rather than by three
functions remembering.

## 1.3 RLS, and why every write is an RPC

The site has **no login**. `lib/db.js` ships the anon key in the client bundle,
which is safe because every table has a select-only policy and no
insert/update/delete policy at all. Verified with the anon key on 20 Aug:

```
POST   /rest/v1/meetings  ->  401  new row violates row-level security policy
PATCH  /rest/v1/meetings  ->  200  []      silently matched nothing
DELETE /rest/v1/meetings  ->  204          silently matched nothing
```

Note the silence on PATCH and DELETE. PostgREST returns success when no row
passes the policy. **Never take a 2xx from a direct write as proof it happened.**

Every write therefore goes through a `security definer` function granted to
`anon`, which validates its own arguments. A malformed or hostile call fails in
the database, not because our UI was polite.

## 1.4 The two doors a meeting comes through

```
/meetings form ──log_meeting()──┐
                                ├──► meetings
Calls workspace ──log_call()────┘
   outcome = booked_meeting        (also edit_call / delete_call keep it in step)
```

Nothing else writes this table. The sync edge function does not touch it —
confirmed by grep over `supabase/functions`.

## 1.5 The readers

| Reader | Reads via | Notes |
|---|---|---|
| Overview tile `/` | `meeting_counts` + `meeting_rows` | |
| Drill-down `/list?metric=meetings` | `meeting_rows` | |
| `/meetings` | `meeting_rows` ×2 (`all` + `removed`) | converted in Phase 1 |
| `/campaigns` and `/campaigns/[slug]` | `v_group_summary.meetings` | |
| `/c/[id]` sub-campaign | `v_campaign_summary.meetings` | |
| `/person/[email]` | `db.from("meetings")` direct | filters `deleted_at` |
| `lib/calls.js meetingsForCalls` | `db.from("meetings")` direct | filters `deleted_at` |

**Everything that counts goes through `meeting_rows`.** The two summary views
are hand-written subqueries for speed and are asserted equal to it by the
parity script. The two direct reads are per-person lookups, not counts.

---

# PART 2 · THE ORIGINAL AUDIT (20 Aug 2026)

Ten faults. Reproduced here in full because several are still open.

| # | Fault | Status |
|---|---|---|
| 1 | No delete, no edit, no cancel for a hand-logged meeting | **FIXED** Phase 3 |
| 2 | A meeting logged today counts on no date window | **FIXED** Phase 2 |
| 3 | Cross-door duplicates — 3 meetings for one conversation | **OPEN** Phase 4 |
| 4 | Campaign pages undercount; tile 1 vs its own click 2 | **FIXED** Phase 1 |
| 5 | `/meetings` had its own rep rule; totals didn't sum | **FIXED** Phase 1 |
| 6 | "campaign unknown" on every form-logged meeting | **FIXED** Phase 1 |
| 7 | `held` / `no_show` unreachable from anywhere | **FIXED** Phase 3 |
| 8 | `meeting_rows` could count one meeting for two reps | **FIXED** Phase 1 |
| 9 | `/calls/[rep]` doesn't validate its URL segment | **OPEN** Phase 5 |
| 10 | Misc: `c.company`, unbounded select, refusal message | **OPEN** Phase 5 |

## 2.1 The measurements, verbatim

```
campaign tile vs its own click
  /campaigns/qea-resellers          "Meetings"   1
  /list?metric=meetings&range=all&group=qea-resellers   rows: 2

rep totals vs all-reps
  /meetings strip   All 9 · Mark Vasu 7 · Justin 0 · Mark Dolan 1
                    7 + 0 + 1 = 8, against a total of 9

one rep, two pages
  /?rep=Mark Vasu&range=all         8
  /meetings?rep=Mark Vasu           7

a meeting logged today (20 Aug) for tomorrow (21 Aug)
  range=today   0     range=7   0     range=30   0     range=all   1
  ...under a tile printing "counted from the day it was booked"

one conversation, both doors
  call logged      "1287 East 19th Condominium", no email,  15 Sept
  hand-logged      same name, + an email the contact lacked, 15 Sept  -> row 2
  hand-logged      "1287 East 19th Condo",       no email,  15 Sept  -> row 3
  KPI: 3 meetings, 3 people, one conversation. No way to remove two.
```

---

# PART 3 · THE SIX DECISIONS (all settled by Tanay, 20 Aug 2026)

These are closed. Do not re-litigate them; implement them.

| | Decision | Settled as |
|---|---|---|
| 0.1 | Cancel only, or cancel *and* remove | **Two verbs** — `cancelled` and `deleted_at` |
| 0.2 | Who owns a call-created meeting's fields | **The call** |
| 0.3 | Campaign pages and group-scoped meetings | **Group tile yes, sub-campaign rows no** |
| 0.4 | `booked_on` — ask or infer | **Ask, defaulted to today** |
| 0.5 | Held / no-show | **Four-state control, movable any time** |
| 0.6 | Person linking | **Full — pre-filled button on Replies and person pages** |

**0.1 reasoning.** `cancelled` = it was a real meeting and it came off; stays
visible, stops counting. `deleted_at` = it was never a meeting; leaves every
count and list, row kept as evidence. Without the second verb there is no exit
from a duplicate and the KPI stays wrong forever.

**0.2 reasoning.** `edit_call` already keeps a linked meeting in step in both
directions and `delete_call` cancels it. A second editor reopens the
two-tiles-disagree-forever problem migration `20260818201145` closed.

**0.3 reasoning and its accepted cost.** A sub-campaign row means "meetings
attributed to this sub-campaign", and a group meeting genuinely is not one. So
the Meetings column on `/campaigns/[slug]` legitimately adds up to less than
its own Total. The page says so in a derived note that only appears when there
is something to explain.

**0.4 reasoning.** Inferring `booked_on` from `created_at` is a guess. Jeffrey
Hohenstein's two rows were both typed on 30 July, one for a meeting that had
already happened on the 22nd.

**0.6 reasoning.** It is the only part of this work that is new product rather
than repair, and it is the part that stops duplicates being created — retyping
a name by hand is exactly how they get made.

---

# PART 4 · WHAT HAS BEEN DONE

Three commits, all on `main`, all pushed to `origin/main`.

```
8ff676c  Seven plus none plus one, against a total of nine        (Phase 1)
e8b6bca  Booked today for September, and the tile said nothing…   (Phase 2)
a6a5df1  A meeting could be written once and never again          (Phase 3)
```

`fd7f4ed "Four filter bars become one rail that never moves"` sits between
e8b6bca and a6a5df1 and is **another agent's work**, not part of this.

## 4.1 Phase 1 — one definition of scope

Migration `20260821000000_meetings_have_one_definition.sql`.

**What it did.**

1. **Resolved a meeting's rep exactly once.** `meeting_rows` had been computing
   `rep` for display with one expression and scoping with a *different* one:
   ```
   display   coalesce(cg.owner, <campaign's group owner>, cc.owner, pc.rep, logged_by)
   scope     pc.rep = p_rep OR cc.owner = p_rep OR (unscoped AND logged_by = p_rep)
   ```
   Two consequences: a call whose rep differed from the call campaign's owner
   matched **both** names, so per-rep totals summed to *more* than the total;
   and a call logged with the rep box empty resolved to nobody, so they summed
   to *less*. Now one CTE column, scoped on and returned:
   ```
   coalesce(cg.owner, gm.owner, pc.rep, cc.owner, m.logged_by) as rep
   ```
2. **Added `p_status`.** The missing argument that was the whole reason
   `/meetings` had never been converted — that page lists cancelled rows.
3. **`v_group_summary.meetings`** rewritten to count `group_id = g.id` **OR**
   `campaign_id IN (that group's campaigns)`. `v_campaign_summary` deliberately
   left alone (decision 0.3). Cast to `::numeric` because
   `create or replace view` refuses to change a column's type.
4. **Deleted the JS ownership rule** from `app/meetings/page.jsx` —
   `ownerOfMeeting`, `ownerOfGroup`, `groupById` all gone.
5. **`scope_label` and `group_slug`** returned from the function so no page
   recomputes a campaign name. This is what ended "campaign unknown".
6. **`record_meeting_detail` no longer overwrites `logged_by` with
   `'dashboard'`.** Found while building the gate. For a meeting with no group,
   no campaign and no call — exactly the kind that reaches `/conflicts` —
   `logged_by` is the only thing a rep can be resolved from, so settling a
   conflict would have removed the meeting from every rep's view while leaving
   it in the all-reps total. No live row carried it; preventative.

**Result.**

```
campaign tile vs its own click     1 vs 2      ->  2 vs 2
rep strip sums                     7+0+1 vs 9  ->  5+0+0 vs 5
Overview vs /meetings, one rep     8 vs 7      ->  5 vs 5
"campaign unknown" on /meetings    every row   ->  0
```

Krishnan Gowri now reads **QEA Resellers**; Baris Acar reads **NYC LL11 — SAFE
/ Reliable owners**.

## 4.2 Phase 2 — a meeting knows when it was agreed

Migration `20260821010000_a_hand_logged_meeting_knows_when_it_was_agreed.sql`.

- `log_meeting` gained `p_booked_on date default null`; **null raises**, it
  does not default to `current_date`. Silently dating a meeting by something
  other than what the person meant is the fault being fixed.
- Also refuses `p_booked_on > p_date` — *"a meeting cannot be agreed on X and
  happen earlier, on Y"*. Not in the plan; one line; closes the obvious way to
  mis-fill two adjacent date boxes.
- The form asks for both, labelled **Happens on** and **Agreed on**, using the
  existing `.gapform label.datefield` span+input contract from the calls form.

**Result.** Booked today for 30 September: `today 1`, `last 7 days 1`. Was 0 on
every window.

The four rows logged before the column existed keep `booked_on = null` and the
`coalesce(booked_on, meeting_date)` fallback. Nothing already on the board moved.

## 4.3 Phase 3 — the rest of the lifecycle

Migration `20260821020000_a_meeting_can_be_changed_and_taken_back.sql`.

- `deleted_at` + `removed_reason` columns.
- `meeting_rows` / `meeting_counts` rebuilt (return type changed, so dropped
  and recreated) with a three-way `p_status` and two new returned columns,
  plus `call_date` so a page can say "came from a call on 4 Aug" without a
  second query.
- `v_campaign_summary` and `v_group_summary` both filter `deleted_at`.
- **Both duplicate guards now ignore removed rows.** Without this, removing a
  duplicate permanently blocks re-logging the meeting it duplicated — the table
  refusing a write on the authority of a row nobody can see, with the only
  sentence saying "already logged". Tested: remove, re-log, it goes in.
- Four new writes: `edit_meeting`, `set_meeting_status`, `remove_meeting`,
  `restore_meeting`.
- `/meetings` gained a status control on every row, an edit form and a
  Remove-with-reason on the four that are not the call's, a call-origin pointer
  line on the three that are, and a bin at `?removed=1`.

**`removed_reason` is its own column, not text appended to `note`.** Appending
mangles the note permanently, so a restore would hand back a row with an
explanation of its own deletion stapled to it.

**Two reads of `meeting_rows` on that page**, because the bin must not empty the
tiles above it.

---

# PART 5 · THE CURRENT STATE OF THE WORLD

## 5.1 Every function, exact signature

```
meeting_rows(p_from date, p_to date, p_campaigns uuid[], p_groups uuid[],
             p_rep text, p_status text)                    security INVOKER
meeting_counts(same six)                                   security INVOKER

log_meeting(p_name text, p_email text, p_company text, p_date date,
            p_group uuid, p_evidence text, p_note text, p_logged_by text,
            p_booked_on date)                              security definer
edit_meeting(p_meeting uuid, p_name text, p_email text, p_company text,
             p_date date, p_booked_on date, p_group uuid,
             p_evidence text, p_note text)                 security definer
set_meeting_status(p_meeting uuid, p_status text)          security definer
remove_meeting(p_meeting uuid, p_reason text)              security definer
restore_meeting(p_meeting uuid)                            security definer
record_meeting_detail(p_meeting uuid, p_name text, p_company text,
                      p_email text, p_note text)           security definer

log_call(p_contact uuid, p_rep text, p_call_date date, p_outcome text,
         p_note text, p_callback date, p_meeting_date date)
edit_call(p_call uuid, p_rep text, p_call_date date, p_outcome text,
          p_note text, p_callback date, p_meeting_date date)
delete_call(p_call uuid)
```

## 5.2 `meeting_rows` semantics — READ THIS BEFORE TOUCHING ANYTHING

**`p_rep`, when given, is the WHOLE scope.** The campaign and group arrays are
ignored. The returned `rep` already encodes all three doors a meeting arrives
through, so a meeting belongs to exactly one rep and per-rep totals sum to the
all-reps total *by construction*.

Do not "fix" this by intersecting rep with the doors. A call meeting has
`campaign_id = null` and `group_id = null`, so ANDing them makes Baris Acar
vanish from `/?rep=Mark Vasu`. That was the trap the pre-Phase-1 OR existed to
avoid, and resolving the rep once is what made the question go away.

Neither caller passes a rep *and* a door: the Overview passes a rep and no
door, a campaign drill passes a door and no rep.

**`p_status`:**

| value | returns |
|---|---|
| `counted` (default) | `deleted_at is null` AND status in (booked, held) — what every KPI counts |
| `all` | `deleted_at is null`, any status — what `/meetings` lists |
| `removed` | `deleted_at is not null` — the bin, the only way to see one |

**Returned columns:** `id, campaign_id, group_id, prospect_name, prospect_email,
company, meeting_date, booked_on, scope_date, status, evidence, note, origin,
source_call_id, logged_by, rep, scope_label, group_slug, deleted_at,
removed_reason, call_date`.

`scope_date = coalesce(booked_on, meeting_date)` and is what the date window
filters on. **The function does not ORDER its output** — callers sort.

## 5.3 The live data, right now

7 rows, 5 counted, 0 removed, 11 live calls.

| Prospect | Date | booked_on | Status | Origin | Scope |
|---|---|---|---|---|---|
| Nicholas Ferrara | 10 Sep | 20 Aug | cancelled | call | — |
| Nicholas Ferrara | 20 Aug | 20 Aug | cancelled | call | — |
| Baris Acar | 4 Aug | 4 Aug | booked | call | — |
| Jeffrey Hohenstein | 30 Jul | null | booked | manual | group + campaign |
| Mark Attard | 28 Jul | null | held | manual | group + campaign |
| Krishnan Gowri | 27 Jul | null | booked | manual | group only |
| Jeffrey Hohenstein | 22 Jul | null | held | manual | group + campaign |

Group tiles: chicago-retrofit 2, qea-resellers 2, others 0.
Reps: Mark Vasu 5, Justin 0, Mark Dolan 0.

**The first row is leftover test data** — its note literally reads
`AUDIT TEST cb`, from a session before this one. It is `cancelled` so it counts
nowhere, but it is visible in the list. It is `origin = 'call'`, so
`remove_meeting` refuses it; the honest fix is to delete its phone_call, or to
delete the row directly with the service role. **Ask Tanay before doing either
— this table is hand-kept and its accuracy is the whole point of it.**

## 5.4 The parity gate

```
node scripts/meetings-parity.mjs
```

Read-only, safe against production, runs in about 90 seconds. Three invariants
over 3 reps × 5 groups × 35 sub-campaigns × 5 windows:

1. **PARTITION** — per-rep totals sum to the all-reps total, exactly.
2. **TILE=CLICK** — `meeting_counts` equals `length(meeting_rows)` over the
   identical arguments.
3. **AGREEMENT** — `v_group_summary.meetings` equals `meeting_rows` for that group.

**Currently: 230 checks, PASS.** Run it before and after every change to this
feature. It has been proved to fail when it should — fed a meeting whose
`logged_by` was a name nobody owns, it reported:

```
FAIL — 1 of 230 checks disagree:
  partition · all time · reps sum to all-reps
    reads 6, should read 7
```

---

# PART 6 · WHAT IS LEFT

## 6.1 Phase 4 — stop making the duplicates  (~1.5 days, the biggest remaining)

This is the one that closes fault 3 and delivers decision 0.6.

**a. A derived `duplicate_meeting` conflict.**

`v_conflicts` is a `UNION ALL` of three kinds (`reply_split`, `meeting_detail`,
`needs_review`) with columns
`kind, campaign_id, conflict_date, subject_id, title, detail, items`. Add a
fourth branch. Two live counted meetings are candidates when they share a
`meeting_date` and either:
- the same lowered `prospect_email`, or
- the same normalised `prospect_name` where either email is null.

Derived, never stored — it disappears the moment it is resolved, which is the
philosophy `/conflicts` already states in its own header comment.

**b. `merge_meetings(p_keep uuid, p_drop uuid)`** — soft-removes the loser via
the same `deleted_at` path, carrying its note across. Must refuse when the two
are the same row, and must refuse to drop a `origin = 'call'` row (that one is
the call's — keep the call's and drop the manual one).

**c. Re-key `log_meeting`'s duplicate guard.** Today it is
`lower(name) AND lower(email) AND date`. Make it:
1. email, when both rows have one;
2. the call contact, when there is a `source_call_id`;
3. normalised name, only as a last resort.

And on a *near* match, **insert and let the conflict surface it** rather than
refusing. Refusing on a fuzzy match would block a genuine second meeting with
the same person, which has already happened twice in this table (Jeffrey
Hohenstein).

**d. The person lookup on the form**, resolving an email against `people` and
setting `campaign_id` from it — which also shrinks the 0.3 consequence note.

**e. A pre-filled "Log a meeting" button** on `/replies` and
`/person/[email]`, carrying name, email, company and campaign into the form.

## 6.2 Phase 5 — the edges  (~2 hours, independently shippable)

1. **`/calls/[rep]/` does not validate its segment.** `params.rep` is
   `decodeURIComponent`'d and posted straight into `log_call` as `p_rep`, which
   becomes the meeting's `logged_by`. `/calls/all/nyc-ll11-safe` — a URL
   `/meetings` generates itself when a call has no rep — would create a meeting
   owned by a rep named "all". Validate against `repList()`.
2. **`log_call` should refuse a blank rep.** A call with no rep produced a
   meeting that belonged to nobody; that is how the totals were caught not
   summing.
3. **The "Logged by" box on the meetings form is free text.** A typo orphans a
   meeting from the rep strip. The parity gate catches it after the fact; make
   it a datalist of known reps that still accepts a new name (the same stance
   `set_group_owner` takes, and for the same reason — there is no rep table).
4. **`c.company` on the phone-call rows of `/meetings`** — `phone_calls` has no
   such column, so Company always reads "—". Join the contact.
5. **`everyRow()` on the meetings reads.** Unbounded `select` is fine at 7 rows
   and silently wrong at 1,001 (PostgREST caps at 1,000).
6. **The duplicate refusal echoes the lowercased input**, not the stored name.
7. **The `AUDIT TEST cb` row** — see 5.3, ask first.

## 6.3 Phase 6 — lock it  (~2 hours)

1. Make the parity script a `/health` row so the next drift is reported rather
   than discovered. `app/health/` already has the shape for this.
2. One migration header recording all six Phase 0 decisions with dates and
   reasons, in the style this repo uses, so they stop being re-asked.

## 6.4 Bookkeeping debt — do this first, it is five minutes

`supabase/README.md` states that `supabase/migrations/` **is exported from**
`supabase_migrations.schema_migrations`, so the table is the source of truth and
the folder mirrors it.

Phase 1 and Phase 2 were applied with the MCP `execute_sql` tool, which **does
not write that table**. Phase 3 was applied with `apply_migration`, which does.
So right now:

```
20260821000000  file in git   NOT in schema_migrations
20260821010000  file in git   NOT in schema_migrations
20260821020000  file in git   in schema_migrations  ✓
```

Both missing migrations are idempotent (`drop ... if exists`,
`create or replace`, `add column if not exists`), so re-applying them through
`apply_migration` reconciles the table harmlessly. **Do that before Phase 4.**

**Rule going forward: apply DDL with `apply_migration`, never `execute_sql`.**

---

# PART 7 · HOW TO WORK ON THIS

## 7.1 Environment

- Dev server already runs on **:3100** and **:3005** (two `next-server` v14.2.15
  processes, same repo). Use `http://localhost:3100`.
- **Do not run `next build`.** It wipes the running dev server's cache. Verify
  by curling the dev server instead. (This is a standing note in Tanay's memory.)
- Supabase project `yfnqszwlyoyfhuwfmcyl`, region us-east-2.
- The anon key is in `lib/db.js` and is safe to use for read tests — it is the
  same credential the site ships.
- **Another agent works in this same tree.** Commit `fd7f4ed` arrived mid-session.
  Consider a worktree, and always check `git status` before staging with `-A`.

## 7.2 How to verify a claim about a number

The house method, and it is the reason these faults were found:

1. Read the tile's number off the rendered page.
2. Follow **that tile's own href** — not a query you compose yourself.
3. Count the rows behind it.
4. Assert they are equal.

To scrape a rendered page:

```bash
curl -s "http://localhost:3100/meetings" -o page.html
# strip tags, then grep — see scripts/meetings-parity.mjs for the RPC-level version
```

Beware: Next.js embeds the RSC flight payload in the HTML, so a string can
appear **twice**. Count elements, not substrings. And React emits button
attributes as `value="x" name="status"`, not the other way round — a regex
assuming attribute order will silently find zero.

## 7.3 Test-data discipline — non-negotiable

This table is the company's primary KPI and it is hand-kept. Every test in this
work followed the same loop:

1. Record the baseline: `7 meetings, 5 counted, 11 live calls`.
2. Write test rows with a **greppable marker in the note** (`AUDIT TEST`,
   `P3 TEST`, `BIN TEST`).
3. Test.
4. Delete by that marker with the service role.
5. Re-assert the baseline.
6. Re-run the parity gate.

A previous session skipped step 4 and left the `AUDIT TEST cb` row that is
still sitting in the table. Do not add to it.

## 7.4 House style for this repo

- Migrations carry a long header explaining **what was measured, what was
  decided, and what was deliberately not done**. Read three recent ones before
  writing your first.
- Database refusals are **sentences a salesperson can read**, not error codes.
  `'a booked meeting needs the date of the meeting — the date it is actually
  happening, not the date of this call'`.
- Server actions use the `done()` pattern: on error, redirect back with
  `?err=` and show the database's own sentence in a banner. Always
  `redirect(..., "replace")`, because a Server Action redirect pushes by
  default and would leave one history entry per click.
- Commit messages are declarative prose with the measurements in them. Look at
  `git log` before writing one.
- `num()` renders null as an em dash, never as 0. A null is "not known"; a zero
  is a claim.

---

# PART 8 · THE PROMPT FOR THE NEXT AGENT

Copy everything between the lines.

---

You are picking up the Meetings repair in the QEA Campaign HQ dashboard
(`/Users/tanaymehta/Desktop/QEA Tech/Growth and Marketing/qea-campaign-hq`).

**Read `MEETINGS_HANDOFF.md` first, all of it, then `MEETINGS_PLAN.md`.** Between
them they contain the full audit, the six decisions Tanay has already settled,
what three completed phases changed, and exactly what is left. Do not
re-litigate the settled decisions — implement them.

Then read the three migration headers `20260821000000`, `20260821010000` and
`20260821020000` to pick up the house style before you write any SQL.

Your work, in this order:

1. **Bookkeeping first (5 min).** Re-apply migrations `20260821000000` and
   `20260821010000` using the Supabase MCP `apply_migration` tool so they land
   in `supabase_migrations.schema_migrations`. They are idempotent. From then
   on, apply DDL with `apply_migration` and never with `execute_sql` — see
   §6.4.

2. **Phase 4 — stop making the duplicates.** §6.1 has the full spec: a derived
   `duplicate_meeting` conflict in `v_conflicts`, a `merge_meetings` function, a
   re-keyed duplicate guard in `log_meeting` that inserts-and-surfaces on a near
   match rather than refusing, a person lookup on the meetings form, and a
   pre-filled "Log a meeting" button on `/replies` and `/person/[email]`. This
   closes the last open fault from the audit and delivers decision 0.6.

3. **Phase 5 — the edges.** §6.2, seven items, about two hours. Item 7 (the
   leftover `AUDIT TEST cb` row) needs Tanay's say-so before you touch it.

4. **Phase 6 — lock it.** §6.3.

Hard rules:

- **`node scripts/meetings-parity.mjs` must pass before and after every
  change.** It is currently 230 checks green. If your change makes it fail, the
  change is wrong, not the gate.
- **Read §5.2 before touching `meeting_rows`.** `p_rep`, when given, is the
  whole scope, and the reason is subtle. Do not "fix" it by intersecting rep
  with the campaign/group doors — that makes call-booked meetings vanish from
  every rep view, which is the exact bug Phase 1 removed.
- **Never run `next build`** — it wipes the running dev server's cache. Verify
  against `http://localhost:3100`.
- **Clean up every test row you write**, by a greppable marker in the note, and
  re-assert the baseline (7 meetings, 5 counted, 11 live calls) plus the parity
  gate afterwards. This table is the company's primary KPI and it is kept by
  hand.
- **Another agent may be working in this tree.** Check `git status` before you
  stage, and never `git add -A` blindly.
- Ask Tanay before inventing any data in the `meetings` table. Its accuracy is
  the entire point of it; a guess in there is worse than a gap.

Work in small steps, verify each against the running app rather than against
your reading of the code, and commit each phase separately with a message in the
style of `git log`.

---
