# Meetings — the complete handoff

Written 21 Aug 2026, and finished the same day. Everything about the Meetings
feature: what was wrong, what has been fixed, exactly how, and every trap
between here and done. **All six phases have shipped.** Part 6 records what was
built and what was deliberately left; there is no open work in it.

Companion documents:
- `MEETINGS_PLAN.md` — the six-phase plan and the six settled decisions.
- `MEETINGS_RECORD.md` — what was actually done, in order, with every number
  that was measured while doing it. Read that one to check a claim made here.
- Migration headers `20260821000000`, `20260821010000`, `20260821020000`,
  `20260821030000`, `20260821040000`, `20260821050000` — the reasoning, in the
  repo's usual place. The last of them carries all six settled decisions.

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
| 3 | Cross-door duplicates — 3 meetings for one conversation | **FIXED** Phase 4 |
| 4 | Campaign pages undercount; tile 1 vs its own click 2 | **FIXED** Phase 1 |
| 5 | `/meetings` had its own rep rule; totals didn't sum | **FIXED** Phase 1 |
| 6 | "campaign unknown" on every form-logged meeting | **FIXED** Phase 1 |
| 7 | `held` / `no_show` unreachable from anywhere | **FIXED** Phase 3 |
| 8 | `meeting_rows` could count one meeting for two reps | **FIXED** Phase 1 |
| 9 | `/calls/[rep]` doesn't validate its URL segment | **FIXED** Phase 5 |
| 10 | Misc: `c.company`, unbounded select, refusal message | **FIXED** Phase 5 |

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

Six commits on `main`.

```
8ff676c  Seven plus none plus one, against a total of nine        (Phase 1)
e8b6bca  Booked today for September, and the tile said nothing…   (Phase 2)
a6a5df1  A meeting could be written once and never again          (Phase 3)
1c343db  Three meetings, three people, one conversation           (Phase 4)
09d970b  A rep named "all", and a company column that was…        (Phase 5)
429b1f9  The gate stops being something somebody remembers to run (Phase 6)
```

`fd7f4ed "Four filter bars become one rail that never moves"` sits between
e8b6bca and a6a5df1 and is **another agent's work**, not part of this.

Phases 4–6 are summarised in Part 6, which used to be the to-do list.

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

meeting_clash(p_date date, p_email text, p_except uuid)    security definer
    The one answer to "is this the same meeting". Returns the name already on
    the board for that day, or null. NOT granted to anon — write-path only.
    p_email must arrive lowered and trimmed; both callers do that anyway.

log_meeting(p_name text, p_email text, p_company text, p_date date,
            p_group uuid, p_evidence text, p_note text, p_logged_by text,
            p_booked_on date)                              security definer
merge_meetings(p_keep uuid, p_drop uuid)                   security definer
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

5 rows, 5 counted, 0 removed, 11 live calls. Every row is real; there is no
test data in this table.

| Prospect | Date | booked_on | Status | Origin | Scope |
|---|---|---|---|---|---|
| Baris Acar | 4 Aug | 4 Aug | booked | call | — |
| Jeffrey Hohenstein | 30 Jul | null | booked | manual | group + campaign |
| Mark Attard | 28 Jul | null | held | manual | group + campaign |
| Krishnan Gowri | 27 Jul | null | booked | manual | group only |
| Jeffrey Hohenstein | 22 Jul | null | held | manual | group + campaign |

Group tiles: chicago-retrofit 2, qea-resellers 2, others 0.
Reps: Mark Vasu 5, Justin 0, Mark Dolan 0.

**The two Nicholas Ferrara rows are gone.** Both were leftovers from the audit
session of 20 Aug — created three minutes apart that evening, both `cancelled`,
both from calls that had already been soft-deleted, one of them noted
`AUDIT TEST cb`. Tanay's call, 21 Aug: delete both, and their two calls with
them. Nothing counted moved — they were cancelled, so the KPI read 5 before and
after. `phone_calls` went from 13 rows to 11, all of them live.

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
feature. Two of its three invariants are also live rows in `v_invariants`,
rendered on `/health` — see 6.3 — so a drift is now reported rather than
waiting for somebody to remember the script. It has been proved to fail when it should — fed a meeting whose
`logged_by` was a name nobody owns, it reported:

```
FAIL — 1 of 230 checks disagree:
  partition · all time · reps sum to all-reps
    reads 6, should read 7
```

---

# PART 6 · WHAT WAS BUILT, AND WHAT WAS NOT

This part was the to-do list. It is now the record. Nothing in it is open.

## 6.1 Phase 4 — the duplicates  ·  `1c343db`

Migration `20260821030000_one_conversation_written_down_twice.sql`.

- **`v_conflicts` gained a fourth kind and one column.** `duplicate_meeting`
  pairs two live counted meetings sharing a date and either the same lowered
  email, or the same normalised name where either email is missing. `partner_id`
  carries the second id and is null on the three older kinds — a duplicate is
  the first conflict about a *pair*, and the page cannot offer "keep this one"
  without both. Derived, never stored. One row per pair, the call's meeting
  named first because `merge_meetings` will not drop it.
- **`merge_meetings(p_keep, p_drop)`** removes the loser through `deleted_at`
  with its note carried across and nothing on the keeper overwritten — a
  missing email, company or name is filled from the row leaving, which is
  usually why there were two. Refuses the same row twice, a row already
  removed, and dropping a meeting that came from a call.
- **The duplicate guard is re-keyed, and looser.** `meeting_clash` is the one
  answer for both write paths. The address is identity: the same email on the
  same day is refused, and so is that address on the *call contact* behind an
  existing call meeting. A name-only match is **inserted** and surfaced as a
  conflict, because refusing it would block a genuine second meeting with the
  same person — which this table has recorded twice.
- **The person lookup.** An email matching somebody in `people` sets the
  meeting's `campaign_id` too, so a hand-logged meeting lands on the
  sub-campaign as well as the group. The rep's own choice of group wins.
- **Pre-filled "Log a meeting"** on `/replies` and `/person/[email]`, through
  `logMeetingHref()` in `lib/db.js`. Nothing is written from the URL — it fills
  boxes a human still presses a button on.

Two smaller faults went with it, because they are the same fault: `log_call`'s
duplicate guard never learned `deleted_at` (Phase 3's header says both guards
did; only `log_meeting`'s was rewritten), and neither did the `meeting_detail`
branch of `v_conflicts`.

## 6.2 Phase 5 — the edges  ·  `09d970b`

Migration `20260821040000_a_call_belongs_to_whoever_made_it.sql`, plus code.

1. **`/calls/[rep]` validates its segment** against the roster. The workspace
   keeps the list you came for and asks who you are; the list-of-lists sends you
   back to `/calls`, which says why.
2. **`log_call` refuses a blank rep.** All 11 calls on file already carry one.
3. **"Logged by" is a datalist** of known reps that still accepts a new name.
   The gate proved the case mid-session: a test row logged by "Justin Levine"
   failed the partition, because the owner on file is "Justin".
4. **Company on the phone-call rows** now reads the contact's `org_name`.
   `phone_calls` has no company column, so that cell had read "—" always.
5. **`everyRow()`** on the three unbounded reads that feed a count — both
   `meeting_rows` reads on `/meetings` and the one on the Overview, which the
   group table counts itself. Each asks for an order, because paging an
   unordered set can return a row twice and miss another.
6. **The refusal echoes the stored name**, not the lowered input — it came with
   `meeting_clash` in Phase 4.
7. **The two Nicholas Ferrara rows are deleted**, with their two calls. Tanay's
   call, 21 Aug. See 5.3.

## 6.3 Phase 6 — locked  ·  `429b1f9`

Migration `20260821050000_the_six_decisions_and_the_gate_that_keeps_them.sql`.

Its header is the permanent record of all six decisions, with reasons and what
was built for each — in the place somebody trips over while asking why the
schema is like this, rather than in a plan document they have to decide to read.

Its body puts two of the parity script's three invariants into `v_invariants`,
which `/health` already renders under "Things that must never be true":

- `meeting_belongs_to_no_rep` — a counted meeting whose resolved rep owns no
  campaign group is in the all-reps total and in nobody's column. That is the
  8-vs-9, and it is the one hole left in the partition.
- `group_tile_disagrees_with_its_own_click` — `v_group_summary.meetings`
  against `meeting_rows` for that group.

TILE=CLICK is deliberately absent: `meeting_counts` is literally `count(*)` over
`meeting_rows` with the same arguments, and a rule that cannot fail is a green
light that means nothing.

Both return nothing today, and the first was proved to go red — a meeting staged
with `logged_by = 'Nobody At All'`, inside a block that then raised.

## 6.4 The bookkeeping — what actually happened

The instruction was to re-apply `20260821000000` and `20260821010000` through
`apply_migration`, on the grounds that they are idempotent. **They are not, and
they were not re-applied.** Checked before running anything:

- `20260821000000` recreates `meeting_rows` with its pre-Phase-3 return type, so
  `create or replace function` would have raised *cannot change return type*;
  and its `v_group_summary` has no `deleted_at` filter, which `create or replace
  view` would have accepted silently.
- `20260821010000` recreates `log_meeting` with the duplicate guard that reads
  removed rows — the exact fault Phase 3 §3 fixed.

So the ledger was reconciled instead: both rows inserted into
`supabase_migrations.schema_migrations` with their real apply times
(`20260820194551`, `20260820194757`), which puts them before Phase 3's
`20260820195224` — so replaying the ledger in version order now lands on the
current schema. `md5(statements[1])` was checked byte-for-byte against each file.

Note that ledger versions are apply timestamps and the filenames in
`supabase/migrations/` are hand-chosen; they have never matched, for any recent
migration. The names do.

**The rule holds: apply DDL with `apply_migration`, never `execute_sql`.** Every
migration since is in the ledger, each verified byte-identical to its file.

## 6.5 Known, and deliberately not done

- **A renamed duplicate is not caught.** "1287 East 19th Condo" against "1287
  East 19th Condominium" — row 3 of the audit — needs a fuzzy key, and a fuzzy
  key on a company KPI pairs two different people at one firm on one day and
  invites somebody to merge them. `pg_trgm` is not installed and this is not the
  reason to install it.
- **`edit_call` still inserts a meeting unconditionally** when the call has none,
  while `log_call` skips on an exact name + email + date match. So the two doors
  do not agree about cross-door duplicates, and editing a call whose meeting was
  hand-logged first will make a second one. It is now visible on `/conflicts` and
  one click from merged, which is why it was left — but it is the next thing to
  look at.
- **`adopt_orphan_call` does not validate its rep.** Deliberate: it exists to
  give the three 16 July calls a person and a list from somebody's memory, and a
  rep may honestly be one of the things nobody remembers.
- **`/meetings` still generates `/calls/all/…`** for a call with no rep whose
  list has no owner. The chooser catches it now; the link was not changed.
- **`everyRow` was not applied** to the `proposals` and `v_campaign_summary`
  reads on `/meetings` — 0 and 35 rows, both bounded by things that grow slowly.
- **The two direct reads of `meetings`** in `app/person/[email]/page.jsx` and
  `lib/calls.js` are still direct, by design — they are per-person lookups, not
  counts. See 1.5.

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

1. Record the baseline: `5 meetings, 5 counted, 11 live calls`.
2. Write test rows with a **greppable marker in the note** (`AUDIT TEST`,
   `P3 TEST`, `BIN TEST`).
3. Test.
4. Delete by that marker with the service role.
5. Re-assert the baseline.
6. Re-run the parity gate.

A session on 20 Aug skipped step 4 and left two rows in the table, which sat
there for a day before Tanay was asked and said to delete them. That is the cost
of skipping it: not a wrong number — they were cancelled — but two lines in the
company's primary KPI that nobody could vouch for, and a day of somebody else's
time to establish that.

Three of the checks in this session could not be made without writing to a live
table at all, and were staged inside a `do $$ … raise exception $$` block
instead: the transaction aborts, so the write never commits. That is how the
cross-door duplicate guard, the blank-rep refusal and the new `/health` rule
were all proved without leaving a row behind. Use it where you can.

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

# PART 8 · IF YOU ARE PICKING THIS UP

The six phases are done and the audit is closed. Read Parts 1 and 5 for how the
system works, 6.5 for what was left, and 7 for the working discipline — which is
not optional here, and is why these faults were found in the first place.

Three rules survive this work and apply to anything that touches meetings:

- **`node scripts/meetings-parity.mjs` must pass before and after every change.**
  230 checks. If your change makes it fail, the change is wrong, not the gate.
- **`p_rep`, when given, is the whole scope.** Read 5.2 before touching
  `meeting_rows`, and do not intersect the rep with the campaign/group doors.
- **Ask before inventing any data in `meetings`.** It is the company's primary
  KPI, no tool records it, and a guess in it is worse than a gap. Clean up every
  test row by a greppable marker and re-assert the baseline: 5 meetings, 5
  counted, 11 live calls.
