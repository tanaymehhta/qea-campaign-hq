# Meetings — the whole thing, in order

Written 20 Aug 2026, from the audit of the same evening. Every number quoted
below was measured live against the production database and the running dev
server, not inferred from the code.

The audit found ten faults. They are not ten problems. They are **four causes
and one leftover**, and the order they get fixed in is forced by the
dependencies between them.

---

## 0 · Why the order is not arbitrary

| Cause | The symptoms it produces |
|---|---|
| **A** · Scope lives in three columns and four readers each pick a different subset | campaign tile reads 1 where its own click opens 2 · rep totals don't sum to the all-reps total · every hand-logged meeting says "campaign unknown" · a call meeting can count for two reps at once |
| **B** · `booked_on` is optional and the form never asks for it | a meeting logged today reads 0 on Today, 0 on 7 days, 0 on 30 days |
| **C** · The write surface is insert-only | no edit, no delete, no cancel, no held — a hand-typed meeting is write-once forever |
| **D** · Identity is a fuzzy text key and the two doors spell people differently | log it by hand *and* log the call = two meetings for one conversation, unremovable |
| **E** · Unvalidated input at the edges | the `[rep]` URL segment becomes `logged_by` verbatim · `c.company` on a table with no such column |

The sequence **A → B → C → D → E** is load-bearing:

- **A first**, because it collapses four readers into one. Every filter added
  after this lands in one place instead of four, and there is finally a single
  number to verify against. Doing A last would mean doing B, C and D four
  times each.
- **B before C**, because the edit form in C needs the `booked_on` field to
  exist before it can offer it.
- **C before D**, because D's entire output is a list of duplicates to remove,
  and until C ships there is no way to remove anything.
- **E any time**, but it is where the bad rows come from, so it should not be
  left until after D has finished cleaning up the ones it let in.

---

## Phase 0 · Six decisions — SETTLED

**All six settled by Tanay, 20 Aug 2026.** The three that change the shape of
the work (0.1, 0.3, 0.6) were put to him directly and answered; the other three
were taken as recommended. Recorded here with the reasoning so they stop being
re-asked, and to be copied into the migration header in Phase 6.

| | Decision | Settled as |
|---|---|---|
| 0.1 | Cancel only, or cancel *and* remove | **Two verbs** — `cancelled` and `deleted_at` |
| 0.2 | Who owns a call-created meeting's fields | **The call** |
| 0.3 | Campaign pages and group-scoped meetings | **Group tile yes, sub-campaign rows no** |
| 0.4 | `booked_on` — ask or infer | **Ask, defaulted to today** |
| 0.5 | Held / no-show | **Four-state control, movable any time** |
| 0.6 | Person linking | **Full — pre-filled button on Replies and person pages** |

### 0.1 · Cancel *and* remove — **SETTLED: two verbs**

Today the codebase has one stance, from the 18 Aug migration: *cancel, never
delete*. That is right for a meeting that was real and came off. It has no
answer for a meeting that was **never a meeting** — a typo, a double-log, a
misclick. Cancelling one of those leaves a false row in the history and, more
to the point, gives no exit from the duplicate problem in D.

**Settled — two distinct verbs:**

- `status = 'cancelled'` — it was real, it's off. Stays visible. Already exists.
- `deleted_at` — it was never a meeting. Out of every count and every list, row
  retained as evidence. Exactly the `phone_calls` pattern, already honoured by
  eight readers in this codebase.

Without the second verb, D cannot land and the KPI stays wrong permanently.

### 0.2 · Who owns a call-created meeting's fields — **SETTLED: the call**

**Settled — the call.** `edit_meeting` refuses on `origin = 'call'` and says
so in a sentence pointing at the call — *"this meeting came from a call on
4 Aug; change it there."* One row, one editor.

The alternative — let both doors edit — reintroduces exactly the
two-tiles-that-disagree-forever problem the 18 Aug migration was written to
kill. Not worth it.

### 0.3 · Campaign pages and group-scoped meetings — **SETTLED: group tile yes, sub-campaign rows no**

`v_campaign_summary.meetings` counts `mt.campaign_id = c.id`. The hand form
never sets `campaign_id` — only `group_id`. `v_group_summary.meetings` is
`sum()` over those campaign rows, so a group-scoped meeting is structurally
invisible to both. Live proof: group totals sum to **3**; the Overview says
**5**. Krishnan Gowri is in the QEA Resellers group and appears in neither.

**Settled — the group summary yes, the campaign summary no.** A sub-campaign
row means "meetings attributed to this sub-campaign" and a group meeting
genuinely is not one. But the *group* tile is what a rep reads and it must
agree with `meeting_rows`.

**Consequence to accept:** the sub-campaign rows on `/campaigns/[slug]` will
legitimately sum to less than the group tile above them. The page must say so
in a line, the way it already does for reply counts. If that is unacceptable,
the alternative is to make the form resolve a campaign as well as a group,
which is 0.6's small option and pushes work into Phase 4.

### 0.4 · `booked_on` on the manual form — **SETTLED: ask, defaulted to today**

**Settled — ask, defaulted to today.** Inferring from `created_at` is the
guess the 20 Aug migration explicitly refused, and it refused it for a good
reason — Jeffrey Hohenstein's two rows were both typed on 30 July, one of them
for a meeting that had already happened on the 22nd.

The four legacy nulls keep the `coalesce(booked_on, meeting_date)` fallback
forever. Null means "not known", which is true.

### 0.5 · Held / no-show — **SETTLED: a four-state control, movable any time**

Nothing in the product can set either. `held` exists on two rows only because
somebody ran SQL. So "booked or held" is currently a distinction with no live
mechanism behind it.

**Settled** — a four-state control on each row, movable any time. Counted
stays `booked | held`. Then, optionally, a `/conflicts` nudge for meetings
whose date has passed and are still `booked` — that is how `held` actually
gets set in practice, rather than never.

### 0.6 · Person linking — **SETTLED: full**

Two sizes:

- **Small** — the form gains an optional "attach to" that resolves an email
  against `people` and sets `campaign_id` from it. The meeting lands in the
  right sub-campaign and on the person page.
- **Full** — a *Log a meeting* button on `/replies` and on `/person/[email]`
  that opens the form pre-filled with name, email, company and campaign.

**Settled — full.** It is the only part of this plan that is new product
rather than repair, and it is the part that makes the reply → call → meeting
story one click instead of retyping a name — which is precisely how the
duplicates in D get created in the first place.

---

## Phase 1 · One definition of scope

The 20 Aug migration created `meeting_rows()` to be the single answer and then
converted two of the four readers. This finishes it.

**Migration — `meetings_have_one_definition.sql`**

1. **Resolve a meeting's rep exactly once.** `meeting_rows` currently computes
   `rep` for display and scopes on a *different* expression
   (`pc.rep = p_rep or cc.owner = p_rep or ...`). Collapse the two: compute
   `resolved_rep` once, scope on `resolved_rep = p_rep`, return the same value.

   Priority, which is the union of what the three readers do today in the order
   `/meetings` already uses:
   `cg.owner` → owner of `campaign_id`'s group → `pc.rep` → `cc.owner` → `m.logged_by`

   This kills the two-reps-at-once double count outright, and makes the
   displayed rep provably identical to the scope that selected the row.

2. **Add `p_status`.** `'counted'` (default) → `booked + held`; `'all'` →
   everything including cancelled. `/meetings` lists cancelled rows today and
   that is why it was never converted — this is the missing argument.

3. **Rewrite `v_group_summary.meetings`** to count `mt.group_id = g.id OR
   mt.campaign_id IN (that group's campaigns)`, with a comment naming
   `meeting_rows` as the definition it must agree with. Leave
   `v_campaign_summary` alone (decision 0.3).

**Code**

4. `app/meetings/page.jsx` — delete `ownerOfMeeting`, `ownerOfGroup`,
   `groupOfCampaign` (lines 33–46) and the `countFor` block; call
   `meeting_rows` twice instead, once counted and once all.

5. Same file — the "campaign unknown" fix. `meeting_rows` returns
   `scope_label` and `group_slug` so no page recomputes it: group name from
   `group_id`, else the campaign's group name, else "no campaign". Right now
   the one field the form asks for is invisible the moment you save it.

**Gate — do not start Phase 2 until this passes**

A script that walks every scope — all reps, each of 3 reps, each of 5 groups,
each of ~35 sub-campaigns, across 5 date ranges — reads the tile's number,
follows the tile's *own* href, counts the rows behind it, and asserts equal.
This is the §7 discipline the handoff already describes, made executable.
Keep it: it is the regression test for every phase after this one.

---

## Phase 2 · A meeting has a booking date

Small, and it removes the most misleading number on the dashboard — a tile
that prints *"counted from the day it was booked"* over a figure that is not.

- `log_meeting` gains `p_booked_on date`. Drop and recreate rather than
  replace: a new argument is a new signature, and leaving the eight-argument
  version in place gives PostgREST two candidates and lets an old caller keep
  writing null. Same reasoning the 20 Aug migration gave for `log_call`.
- Null is **refused**, not defaulted — the way `log_call` refuses a booked
  meeting with no meeting date. Silent defaulting is what produced this fault.
- The form gains one `<input type="date" name="booked_on">` labelled
  *agreed on*, defaulted to `today()`.
- The tile's note stops being false.

---

## Phase 3 · The rest of the lifecycle

**Migration — `a_meeting_can_be_changed_and_taken_back.sql`**

- `alter table meetings add column deleted_at timestamptz;`
- `meeting_rows` gains `and m.deleted_at is null` — **one line, because
  Phase 1 made it the only reader that matters.** Three direct readers remain
  and are enumerated here so none is missed:
  `app/person/[email]/page.jsx:74`, `lib/calls.js:70`, `v_campaign_summary`.
- `edit_meeting(p_meeting, p_name, p_email, p_company, p_meeting_date,
  p_booked_on, p_group, p_evidence, p_note)` — reuses `log_meeting`'s
  validation body verbatim. Refuses on `origin = 'call'` (decision 0.2).
- `set_meeting_status(p_meeting, p_status)` — the four states, refuses anything
  else, says which four.
- `remove_meeting(p_meeting, p_reason)` — reason required, following the
  do-not-call precedent. Sets `deleted_at`, appends the reason to the note.
- `restore_meeting(p_meeting)` — needed the first time somebody removes the
  wrong row, which will be the same week.

**Code**

- Each row's open body on `/meetings` gains an Edit form, a four-state status
  control, and Remove. Same `done()` / `?err=` banner pattern as
  `app/calls/actions.js` — the database's sentence in a banner, never a crash
  screen.
- A "show removed" toggle, matching the `/calls/orphans` precedent.

---

## Phase 4 · Stop making the duplicates

The measured failure, run live: one call logged as a booked meeting, then the
same meeting typed into the form with an email the call contact did not have,
then typed again with one word of the name changed. Result: **3 meetings,
3 people, one conversation** — and no way to remove two of them.

- **`v_conflicts` gains a `duplicate_meeting` kind.** Two live counted meetings
  sharing a date and either the same lowered email, or the same normalized name
  where either email is null. Derived, never stored — the philosophy that page
  already states, and it slots straight into the existing `UNION ALL`.
- **`merge_meetings(p_keep, p_drop)`** — soft-removes the loser, carries its
  note across.
- **`log_meeting`'s dedup guard is re-keyed:** email when both have one; the
  call contact when there is one; normalized name only as a last resort. And
  on a *near* match it inserts and lets the conflict surface it, rather than
  refusing — refusing on a fuzzy match would block a genuine second meeting
  with the same person, which is a real thing that has already happened twice
  in this table.
- **The person lookup** on the form, and the pre-filled *Log a meeting* button
  on `/replies` and `/person/[email]` (decision 0.6).

---

## Phase 5 · The edges that let it in

- `/calls/[rep]/` validates its segment against `repList()`. Right now whatever
  is in the URL becomes `logged_by` verbatim, and `/calls/all/...` — a link
  `/meetings` generates itself when a call has no rep — would create a meeting
  owned by a rep named "all".
- `log_call` refuses a blank rep. A call with no rep produced a meeting that
  belonged to nobody, which is how the rep totals were caught not summing.
- The phone-call rows on `/meetings` render `c.company`; `phone_calls` has no
  such column, so Company is always "—". Join the contact.
- `everyRow()` on the meetings reads — unbounded `select("*")` is fine at 7
  rows and silently wrong at 1,001.
- The duplicate-refusal message echoes the lowercased input back at the user
  instead of the stored name.
- Delete the leftover `AUDIT TEST cb` row on Nicholas Ferrara.

---

## Phase 6 · Lock it

- The Phase 1 parity script becomes a `/health` row, so the next drift is
  reported rather than discovered.
- One migration header recording all six Phase 0 decisions with dates and
  reasons, in the style this repo already uses — so they stop being re-asked.

---

## Sizing

| Phase | Size | Blocks |
|---|---|---|
| 0 · Decisions | — | everything |
| 1 · One definition | ~1 day | 2, 3, 4 |
| 2 · Booking date | ~1 hour | 3 |
| 3 · Lifecycle | ~1 day | 4 |
| 4 · Duplicates + linking | ~1.5 days | — |
| 5 · Edges | ~2 hours | — |
| 6 · Lock | ~2 hours | — |

Phases 2 and 5 are independently shippable at any point. Phase 1 is the one
that must go first and must be verified before anything builds on it.
