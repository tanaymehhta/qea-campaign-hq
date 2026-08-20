# Meetings — the record of the work

Written 21 Aug 2026, at the end of the session that finished the Meetings
repair. `MEETINGS_PLAN.md` is what was planned. `MEETINGS_HANDOFF.md` is how the
system works now. **This file is what was actually done, in order, with what was
measured at each step** — so that anything claimed elsewhere in these three
documents can be traced back to a number somebody read off a live page or a live
database.

Every figure below was measured against the production database
(`yfnqszwlyoyfhuwfmcyl`) or the running dev server on `:3100`. None is inferred
from reading code.

---

## The short version

| | |
|---|---|
| Phases finished this session | 4, 5, 6 — plus the bookkeeping, and item 7 |
| Faults from the 20 Aug audit still open | none, of ten |
| Commits | `1c343db`, `09d970b`, `429b1f9`, `5d9051b` |
| Pushed | yes — `c8084e5..5d9051b` to `origin/main` |
| Deployed | yes — verified by Tanay on the live site |
| Parity gate | 230 checks, PASS, before and after every change |
| Baseline at start | 7 meetings · 5 counted · 0 removed · 11 live calls |
| Baseline at end | 5 meetings · 5 counted · 0 removed · 11 live calls |
| Corrected after the fact | one more leftover row found and deleted — see §11 |

The meetings figure fell by two because two rows were deleted on Tanay's
instruction. Both were cancelled, so **the counted KPI did not move**: 5 before,
5 after.

---

## 1 · The bookkeeping, and the instruction it corrected

The task said to re-apply `20260821000000` and `20260821010000` through
`apply_migration` because they are idempotent, so they would land in
`supabase_migrations.schema_migrations`.

**They are not idempotent.** Checked before running anything:

| Migration | What re-applying would have done |
|---|---|
| `20260821000000` | `create or replace function meeting_rows` with the pre-Phase-3 return type → raises *cannot change return type of existing function*, aborting the migration. And its `v_group_summary` has no `deleted_at` filter, which `create or replace view` accepts silently. |
| `20260821010000` | `create or replace function log_meeting` with the duplicate guard that reads removed rows — the exact fault Phase 3 §3 was written to fix. Silent. |

So neither was re-applied. The ledger was reconciled by insert instead, at the
times the two were really applied — before Phase 3's `20260820195224`, so
replaying the ledger in version order now lands on the schema that exists:

```
20260820194551  meetings_have_one_definition                   md5 c98bdf98…
20260820194757  a_hand_logged_meeting_knows_when_it_was_agreed  md5 61b9df1a…
```

Both `md5(statements[1])` values were checked against the files on disk and
match byte for byte.

Ledger versions are apply timestamps; the filenames in `supabase/migrations/`
are hand-chosen. They have never matched for any recent migration — the names
do, and that is what `supabase/README.md` means by the folder mirroring the
table.

**The rule stands: apply DDL with `apply_migration`, never `execute_sql`.**
Every migration written since is in the ledger and verified identical to its
file.

---

## 2 · Phase 4 — stop making the duplicates · `1c343db`

Migration `20260821030000_one_conversation_written_down_twice.sql`
(ledger `20260820211929`, md5 `bc0990ad…`).

### What shipped

- **`v_conflicts` gained a fourth kind, `duplicate_meeting`, and one column,
  `partner_id`.** Two live counted meetings pair when they share a date and
  either the same lowered email, or the same normalised name where either email
  is missing. One row per pair, not two — the call's meeting is named first,
  because `merge_meetings` will not drop it. Derived, never stored.
- **`merge_meetings(p_keep, p_drop)`** — the loser leaves by `deleted_at` with
  its note carried across. Nothing on the keeper is overwritten; a missing
  email, company or name is filled from the row leaving.
- **`meeting_clash(p_date, p_email, p_except)`** — one definition of "is this
  the same meeting", asked by both `log_meeting` and `edit_meeting`. Not granted
  to anon, so PostgREST does not publish it as an RPC.
- **The guard is re-keyed onto the address**, and is looser than before.
- **The person lookup** — an email matching somebody in `people` sets
  `campaign_id` as well. The rep's own choice of group always wins.
- **`logMeetingHref()`** in `lib/db.js`, and the pre-filled *Log a meeting*
  link on `/replies` and `/person/[email]`.

Two smaller faults went with it because they are the same fault: `log_call`'s
duplicate guard had never learned `deleted_at` (Phase 3's header says both
guards did; only `log_meeting`'s was rewritten), and neither had the
`meeting_detail` branch of `v_conflicts`.

### What was measured

All test rows carried `P4 TEST` in the note and were deleted afterwards.

| Test | Result |
|---|---|
| `log_meeting('P4 Test Person', no email, 15 Sep)` then `('p4   test person', no email, 15 Sep)` | Both inserted. One `duplicate_meeting` row appeared: *"P4 Test Person is on the board twice for 15 Sep"*. The old guard refused the second. |
| Same email twice on 16 Sep | Second refused: *"a meeting with P4 Strong One on 16 Sep is already logged — the same email address, so this is the same meeting. Change that one instead, or use a different date"*. Note it names the **stored** name. |
| Same email, 17 Sep | Inserted. A genuine second meeting with the same person is still allowed. |
| Cross-door key: Baris Acar's call meeting with its own email nulled inside a block that then raised | `meeting_clash` still found him through the contact behind the call, and `log_meeting` refused. The staged update never committed — the row was re-read afterwards and was untouched. |
| `merge_meetings(x, x)` | *"that is one meeting, not two"* |
| `merge_meetings(manual, a call's meeting)` | *"that meeting came from a phone call and is the call's own record of it — keep that one and remove the hand-typed one instead"* |
| `merge_meetings(keep, already removed)` | *"the meeting to remove is not there — it may already have been removed"* |
| A real merge | Keeper's note became `P4 TEST a · P4 TEST b`; loser removed with a reason naming the meeting it was merged into; the conflict disappeared. |
| Person lookup, no group chosen | `campaign_id` set from `people`, `group_id` null. |
| Person lookup, a group chosen that the campaign does not sit under | `campaign_id` left null — the human's choice won. |
| Person lookup, the matching group chosen | Both set. |
| `/conflicts` rendered | The card showed both rows, who typed each, which had no email, and a **Keep this one** button under each. |

The gate failed once here, correctly. A test row logged by `"Justin Levine"`
broke the partition:

```
FAIL — 5 of 230 checks disagree:
  partition · all time · reps sum to all-reps
    reads 12, should read 13
```

The owner on file is `"Justin"`. Nothing was wrong with the code; the row
belonged to a rep who does not exist. That finding is why Phase 5 item 3 exists
and why Phase 6's first invariant exists.

After cleanup: 7 · 5 · 0 · 11 restored, 230 green.

---

## 3 · Phase 5 — the edges · `09d970b`

Migration `20260821040000_a_call_belongs_to_whoever_made_it.sql`
(ledger `20260820212812`, md5 `f237fe95…`), plus code.

All seven items of §6.2:

1. **`/calls/[rep]` validates its segment.** The workspace keeps the list you
   came for and asks who you are; the list-of-lists sends you back to `/calls`,
   which says why. Verified: `/calls/all/nyc-ll11-safe` renders *"Nobody here is
   called 'all'"* with the three reps; `/calls/all` bounces with a banner.
2. **`log_call` refuses a blank rep.** Both a blank and a whitespace-only rep
   were refused with *"a call needs the name of whoever made it — a call
   belonging to nobody still counts on the Overview and shows up in no rep's
   column, and so does the meeting it books"*. A good call staged in the same
   block still wrote 1 call row and 1 meeting row, then rolled back. 0 of the 11
   live calls were affected — all already carry a rep.
3. **"Logged by" is a datalist** of the reps that still accepts a new name.
4. **Company on the phone-call rows** now reads the contact's `org_name`.
   John Monroe reads *RAND ENGINEERING & ARCHITECTURE DPC*; it read "—" before,
   for every call ever logged, because `phone_calls` has no company column.
5. **`everyRow()`** on the three unbounded reads that feed a count — both
   `meeting_rows` reads on `/meetings` and the one on the Overview, which the
   group table counts itself. Each asks for an order, because paging an
   unordered set can return a row twice and miss another. PostgREST caps at
   1,000 with no error.
6. **The refusal echoes the stored name** — arrived with `meeting_clash`.
7. **The two Nicholas Ferrara rows** — see section 5.

Baseline and gate unchanged: 7 · 5 · 11, 230 green.

---

## 4 · Phase 6 — lock it · `429b1f9`

Migration `20260821050000_the_six_decisions_and_the_gate_that_keeps_them.sql`
(ledger `20260820213509`, md5 `91e8a755…`).

**The header** is the permanent record of all six decisions Tanay settled on
20 Aug, with the reasoning and what was built for each — in the place somebody
trips over while asking why the schema is like this, rather than in a plan
document they have to decide to read.

**The body** puts two of the parity script's three invariants into
`v_invariants`, which `/health` already renders under *Things that must never be
true*:

- `meeting_belongs_to_no_rep` — a counted meeting whose resolved rep owns no
  campaign group. It is in the all-reps total and in nobody's column. The one
  hole left in the partition, and the thing the free-text box was one keystroke
  from.
- `group_tile_disagrees_with_its_own_click` — `v_group_summary.meetings`
  against `meeting_rows` for that group.

TILE=CLICK is deliberately absent: `meeting_counts` is literally `count(*)` over
`meeting_rows` with the same arguments, so it cannot disagree without the
database being broken, and a rule that cannot fail is a green light that means
nothing — the stance that view's own header takes.

**Both return nothing, and the first was proved to go red.** A meeting staged
with `logged_by = 'Nobody At All'`, inside a block that then raised:

```
rows now: 1
rule: meeting_belongs_to_no_rep
subject: P6 Nobody's Meeting
detail: 23 Aug: resolved to "Nobody At All", who owns no campaign group,
        so it counts in the all-reps total and in nobody's column
```

Nothing committed. `v_invariants` clean afterwards.

---

## 5 · Item 7 — the two leftover rows · `5d9051b`

Both Nicholas Ferrara meetings were leftovers from the audit session of 20 Aug:

```
created 19:06:06   meeting 20 Aug   cancelled   origin call   note: (none)
created 19:09:22   meeting 10 Sep   cancelled   origin call   note: AUDIT TEST cb
```

Both from calls already soft-deleted, three minutes apart, same contact. Put to
Tanay with the evidence and the options. **His answer, 21 Aug: delete both, and
their calls.**

Deleted: 2 meetings, 2 phone_calls. `phone_calls` went from 13 rows to 11, all
live. Nothing counted moved — both were cancelled, so the KPI read 5 before and
5 after.

`MEETINGS_HANDOFF.md` and `MEETINGS_PLAN.md` were rewritten in the same commit:
Part 6 stopped being a to-do list and became the record, 6.4 corrected the
bookkeeping instruction, 6.5 listed what was deliberately left, and the test
baseline in 7.3 moved to 5 · 5 · 11.

---

## 6 · The live state now

```
meetings           5 rows, 5 counted, 0 removed
phone_calls       20 rows, 11 live
v_conflicts        2 rows, both reply_split
v_invariants       0 rows
parity gate      230 checks, PASS
```

| Prospect | Date | booked_on | Status | Origin | Scope |
|---|---|---|---|---|---|
| Baris Acar | 4 Aug | 4 Aug | booked | call | — |
| Jeffrey Hohenstein | 30 Jul | null | booked | manual | group + campaign |
| Mark Attard | 28 Jul | null | held | manual | group + campaign |
| Krishnan Gowri | 27 Jul | null | booked | manual | group only |
| Jeffrey Hohenstein | 22 Jul | null | held | manual | group + campaign |

Group tiles: chicago-retrofit 2, qea-resellers 2, others 0.
Reps: Mark Vasu 5, Justin 0, Mark Dolan 0. They sum to 5.

**There is no test data in this table.**

---

## 7 · Verified on the live site

Pushed `c8084e5..5d9051b` to `origin/main`, fast-forward, no divergence.
`FRONTEND.md` was left untracked throughout — it is another agent's file.

Tanay checked https://qea-campaign-hq.vercel.app on 21 Aug: the Meetings tile
against its own click, the rep strip summing, the Company column on the phone
calls, the pre-filled *Log a meeting* link on Replies, `/health` clean, and
`/calls/all/nyc-ll11-safe` refusing to invent a rep. **All six passed.**

---

## 8 · The ten faults, closed

| # | Fault | Closed by |
|---|---|---|
| 1 | No delete, edit or cancel for a hand-logged meeting | Phase 3 |
| 2 | A meeting logged today counted on no date window | Phase 2 |
| 3 | Cross-door duplicates — 3 meetings for one conversation | **Phase 4** |
| 4 | Campaign pages undercount; tile 1 vs its own click 2 | Phase 1 |
| 5 | `/meetings` had its own rep rule; totals didn't sum | Phase 1 |
| 6 | "campaign unknown" on every form-logged meeting | Phase 1 |
| 7 | `held` / `no_show` unreachable from anywhere | Phase 3 |
| 8 | `meeting_rows` could count one meeting for two reps | Phase 1 |
| 9 | `/calls/[rep]` didn't validate its URL segment | **Phase 5** |
| 10 | `c.company`, unbounded select, refusal message | **Phase 4 + 5** |

---

## 9 · What was deliberately not done

Repeated from handoff 6.5, because a record of the work is not honest without
it.

- **A renamed duplicate is not caught.** "1287 East 19th Condo" against "1287
  East 19th Condominium" — row 3 of the audit — needs a fuzzy key, and a fuzzy
  key on a company KPI pairs two different people at one firm on one day and
  invites somebody to merge them. `pg_trgm` is not installed and this is not the
  reason to install it. A missed duplicate is one visible row too many; a
  wrongly merged pair is a meeting deleted on the strength of a similar name.
- **`edit_call` still inserts a meeting unconditionally** where `log_call`
  skips on an exact name + email + date match. So editing a call whose meeting
  was hand-logged first makes a second one. It is visible on `/conflicts` and
  one click from merged, which is why it was left — **but it is the next thing
  to look at.**
- **`adopt_orphan_call` does not validate its rep.** Deliberate: it exists to
  give the three 16 July calls a person and a list from somebody's memory, and a
  rep may honestly be one of the things nobody remembers.
- **`/meetings` still generates `/calls/all/…`** for a call with no rep whose
  list has no owner. The chooser catches it; the link was not changed.
- **`everyRow` was not applied** to the `proposals` and `v_campaign_summary`
  reads on `/meetings` — 0 and 35 rows, both bounded by things that grow slowly.
- **The two direct reads of `meetings`** in `app/person/[email]/page.jsx` and
  `lib/calls.js` stay direct by design — per-person lookups, not counts.

---

## 10 · Two practices worth keeping

**Stage a write that must not commit.** Three of the checks in this session
could not be made without writing to a live table. Each was staged inside

```sql
do $$
begin
  -- write, then read the thing you are proving
  raise exception 'staged probe · %', what_you_read;
end $$;
```

The raise aborts the transaction, so the write never commits and the sentence
comes back in the error. That is how the cross-door guard, the blank-rep refusal
and the new `/health` rule were all proved without leaving a row behind. Where a
test row must be written for real, mark it in the note, delete by that marker,
and re-assert the baseline.

**Count elements, not substrings.** Next.js embeds the RSC flight payload in the
HTML, so a rendered string appears in the page source twice — once as markup and
once as JSON. Stripping everything before the first `<script>` does not isolate
the markup either; Next puts scripts first. Strip `<script>…</script>` blocks
with a non-greedy match, then read what is left.

---

## 11 · One more leftover, found by auditing this record against the table

Added 21 Aug, after §10, by an audit that re-read every claim in these three
documents against the live database rather than against the code.

The table did not match the baseline recorded in §6. It held **six** rows, not
five, and one of them was in the removed bin:

```
Ken Day · kenday@irvcon.com · Irvcon Limited
meeting 20 Aug, status booked, origin manual, campaign resolved to
Roof Campaign — Mark Dolan
created  21:54:30
removed  21:55:03   removed_reason: "test"
```

Created thirty-three seconds before it was removed, nineteen minutes after the
last migration of the session, and with `removed_reason` reading `test`. It was
the new "Log a meeting" flow from `/replies` being exercised — and it worked;
the campaign it resolved is proof that decision 0.6's person lookup does what it
was built to do.

**Ken Day is a real prospect**, not a fictional name: he is in `people` and in
`replies`, and he has an Irvcon Limited reply on the board. So this was a live
record with the word "test" attached to it, sitting in the bin of the company's
primary KPI.

Nothing counted moved — it was soft-removed the moment it was made, so the
Overview read `5 meetings · 4 people · 1 off the phone` throughout, and the
parity gate was green with it in place. Deleted on Tanay's instruction, the same
way and for the same reason as the two rows in §5.

`§6` and `MEETINGS_HANDOFF.md §7.3` state the baseline as
`5 meetings · 5 counted · 0 removed · 11 live calls`. That is true again, and
measured after the delete:

```
meetings 5 · counted 5 · removed 0 · phone_calls 20 total, 11 live
test leftovers in meetings: 0
```

**The lesson is the one §10 already gives, and it was not followed here.** The
staged-write trick exists precisely so a flow can be proved without leaving a
row behind; a real prospect's record is the last place to skip it. Where a live
row genuinely must be written, `remove_meeting` is not cleanup — it is a
soft delete that leaves the row in the bin. Deleting by marker is cleanup.

### Still outstanding, deliberately not touched

`phone_calls` holds one soft-deleted row noted `AUDIT TEST cb2` (Nicholas
Ferrara, deleted 20 Aug 19:09). It is soft-deleted, so it counts nowhere and
every call reader already honours `deleted_at`. Left alone rather than swept up
without being asked — the same rule §5 followed.
