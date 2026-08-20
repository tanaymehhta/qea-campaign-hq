# Call logs — how they work, and what was wrong

Written 20 August 2026. Everything here is measured against the live Supabase project
`yfnqszwlyoyfhuwfmcyl`, not inferred from code. `main` is at `91fbf75`, pushed and
deployed to `qea-campaign-hq.vercel.app`.

**Functionally done.** The front end has not been designed — that is the next piece of
work. Four things are still known-wrong and are listed in §8; none of them stop a rep
calling, logging and having the numbers agree.

---

## Contents

1. [The model in three nouns](#1-the-model-in-three-nouns)
2. [What a rep does, and what it produces](#2-what-a-rep-does-and-what-it-produces)
3. [Where every number comes from](#3-where-every-number-comes-from)
4. [What was wrong, measured](#4-what-was-wrong-measured)
5. [What changed](#5-what-changed)
6. [The write path](#6-the-write-path)
7. [Live state, 20 August 2026](#7-live-state-20-august-2026)
8. [Still open](#8-still-open)
9. [How to verify any of this](#9-how-to-verify-any-of-this)

---

## 1. The model in three nouns

Everything on these pages is a count of one of three things. There is nothing else.

**A person** — `call_contacts`. A row on a call list. Nicholas Ferrara, 80 buildings, a
phone number. They exist whether or not anyone ever rings them.

**A call** — `phone_calls`. One thing that happened on one day. One person, one date, one
tag saying how it ended.

**A meeting** — `meetings`. A date in the future when we are actually talking to them.

A meeting made on a call carries `source_call_id`, which is the only link between the two.
There is no copy of the meeting's date on the call row, so the two cannot drift apart.

The rule the whole codebase is organised around applies here as everywhere: **the number,
the click and the list must be the same pile** (`NEXT_AGENT.md` §1).

---

## 2. What a rep does, and what it produces

1. Open `/calls`, pick your name.
2. Open a list, open a person.
3. Pick **one** of four tags.
4. Type a note if you want. Press **Log call**.

One press is one call. That is the whole action.

### The four tags

| Tag | Stored as | Use it when |
|---|---|---|
| Didn't reach them | `not_reached` | Nobody picked up. Voicemail, email instead, dead line — all of it. |
| Follow up | `follow_up` | You spoke to a human, ring them back. |
| Not interested | `not_interested` | You spoke to a human, they said no. |
| Booked a meeting | `booked_meeting` | They agreed. The meeting date is required. |

Three of the four mean you got through. `not_reached` is the only one that does not, and
it is what "Spoke to someone" excludes.

Whether a voicemail was left is a sentence in the note, not a category the dashboard
counts. That was three separate outcomes until 20 Aug and it is the reason a tile called
"No answer" read 6 when no call in this database has ever been a no-answer.

### What one press moves

| | |
|---|---|
| Always | Overview → **Calls logged** +1 |
| Only for Booked a meeting | Overview → **Meetings booked** +1 |

Two numbers. That is every effect a call can have on the front page.

### The cases that are easy to get wrong

**Ring the same person twice on different days.** Two calls. Both count. That is right —
it is two phone calls.

**Ring twice and book the same meeting both times.** Two calls, **one** meeting. The guard
is `(name, email, meeting_date)`: confirming a meeting does not book a second one. A
different date is a different meeting and does count.

**Ring someone on Monday (Follow up), again on Friday (Booked a meeting).** Calls logged
+2 across the two days, Meetings booked +1 on the Friday. The person's row shows the
newest tag.

### Two things that are not tags

Both confused the picture before, so they are named apart.

**Callback date.** A date, set either on the call form or in the Callback box. It puts the
⚑ flag on the person, sorts them to the top of the list once the date arrives, and is what
"Follow-ups due" counts. It is not an outcome and it does not move the Overview.

**Do-not-call.** A flag on the person, with a required reason. Takes them off the working
list. Reversible — "Put back on the list".

---

## 3. Where every number comes from

### Overview (`/`)

| Tile | Counts | Scope |
|---|---|---|
| Calls logged | live `phone_calls` rows in the window | the rep who dialled, **or** the owner of the call list the contact sits on |
| Meetings booked | `meeting_counts(...)` | campaign **or** group **or** rep — three doors, because a call meeting has neither of the first two |
| People reached | `reached_counts(...)` | includes anyone phoned, whatever the outcome — a dial is a reach |

### Campaign workspace (`/calls/[rep]/[campaign]`)

Every tile filters the list beneath it. All of them come from `callStats` in `lib/calls.js`,
computed once so a tile and its filter cannot disagree.

| Tile | Is |
|---|---|
| Calls made | live calls against this list's contacts |
| Spoke to someone | people with at least one call that is not `not_reached` |
| Meetings booked | `meetings` rows linked to this list's calls, cancelled ones excluded |
| Follow-ups due | callback date today or earlier |
| Never called | no calls at all |
| Didn't reach them | called, and every call was `not_reached` |
| Not interested | newest tag is `not_interested` |
| Buildings covered | sum of `buildings_count` over people we got through to |
| Do-not-call | the `dnc` flag |

The rep index card (`/calls/[rep]`) reads the same `callStats`, with the meetings loaded,
so its Meetings number is the same rows as the page behind it.

---

## 4. What was wrong, measured

A full audit was run on 20 August 2026. Thirteen findings; the seven that mattered:

**1 · "Calls made" counted checkboxes, not calls.** The form let a rep tick several
outcomes and posted one insert per tick. One dial that ended "no answer, left a voicemail,
sent the email" was three rows. **16 rows were 11 calls. The NYC list read 13 and was 8.**

**2 · "No answer 6" counted nobody who was no-answered.** `no_answer`, `left_voicemail`
and `left_email` were three names for one fact, and the tile over them was named after one
of the three. Zero rows in this database have ever had `no_answer`.

**3 · Three calls belonged to nobody.** The 16 July "New York" calls — Levon Shaginyan,
Mark Ellis, Raffaele Albanese — predate `call_contacts` and had `contact_id = null` and
`rep = null`. They were on the Overview tile, invisible on every campaign page, in no
rep's numbers, and counted as 3 of the 11 in "People reached · phoned". No two pages could
be reconciled while one existed.

**4 · The rep card and the campaign page disagreed about meetings.** The card counted
`booked_meeting` call rows; the page counted `meetings` rows. Reproduced with a confirming
second dial: **card 3, page 2.** The card also counted a call whose meeting was cancelled.

**5 · "Calls logged" ignored the rep picker** while every tile beside it narrowed.

**6 · "Calls logged → see who" opened the rep picker**, not the calls. Still true — §8.

**7 · Deleting a call left its callback on the person.** A callback lives in two places:
`phone_calls.callback_date` (what that call said to do) and `call_contacts.callback_date`
(what the person's row shows, and what the ⚑ and Follow-ups due read). `log_call` wrote
both; `delete_call` only ever wrote the first. Found by Tanay on Nicholas Ferrara, logged
19:06:06 and deleted 35 seconds later. `edit_call` had the mirror bug.

---

## 5. What changed

Three commits, three migrations, all deployed.

| commit | migration | what |
|---|---|---|
| `afb7bfb` | `20260820220000_a_call_with_no_contact_belongs_to_nobody` | `adopt_orphan_call` + `/calls/orphans`. Rep scoping on Calls logged. |
| `2cc29ba` | `20260820230000_four_outcomes_and_one_row_per_call` | Seven outcomes → four. Checkboxes → radios. One press, one row. Rep card counts meetings. |
| `91fbf75` | `20260820234500_deleting_a_call_takes_its_callback_with_it` | Delete and edit carry the callback with them. |

### Seven outcomes became four

`no_answer`, `left_voicemail`, `left_email` and `other` all became `not_reached`. `other`
folded in here rather than into a live conversation: its one row was Ruslan Solovyev, "sent
email, no phone available", a person nobody spoke to who was being counted in "Spoke to
someone".

The column's check constraint lists the same four the functions do — the `if` in
`log_call` exists to raise a sentence a rep can read, not to be the only guard.

### One press became one row

`logCall` read `formData.getAll("outcome")` and looped. It reads one radio now. Five
duplicate halves of single dials were soft-deleted (`deleted_at`, not removed — a row is
evidence). 16 rows → 11.

`dialCount`, a helper written earlier the same day to collapse rows into dials, was
deleted with them. It was the right fix for the wrong data: it also collapsed a genuine
second dial on the same day, which is a real second call.

### The three orphan calls were adopted

There was no way to close that gap by reading — the facts only existed in somebody's
memory. `/calls/orphans` is the form; `adopt_orphan_call` is the write. It refuses a call
that already has a contact, joins an existing person on the chosen list rather than
creating a second row for one human, lowercases the email on the way in, and never lets an
empty box wipe what is already recorded.

All three are now on the SAFE list under Mark Vasu. The page reads "Nothing to fix" and
reappears on its own if another contactless call is ever logged.

### The callback follows the call

`delete_call` and `edit_call` now recompute the person's callback from whatever live calls
remain, and clear it when there are none. Guarded on the person still showing **that
call's own date**, so a date typed by hand into the Callback box — which belongs to no
call — is not wiped by deleting an unrelated one.

---

## 6. The write path

Every write is a security-definer function that validates its own arguments in the
database, so a malformed or hostile call fails there rather than being trusted because it
came from our own UI. RLS blocks direct writes. The server actions in `app/calls/actions.js`
are thin wrappers; each ends on a GET so a reload cannot re-submit, and reopens the row the
rep was working so they do not lose their place mid-shift.

| Function | Does | Refuses |
|---|---|---|
| `log_call` | inserts one call; books a meeting if the tag is `booked_meeting`; writes the callback onto the person | an unknown outcome; a missing call date; a booked meeting with no meeting date; a double-submit inside one minute |
| `edit_call` | changes one call; creates, moves or cancels its meeting to match; moves the person's callback | the same three |
| `delete_call` | soft-deletes; cancels the meeting; clears the callback | a call that is already deleted |
| `adopt_orphan_call` | gives a contactless call a person, a list and a rep | a call that already has a contact; no name; no rep; a bad role or email |
| `set_callback` | sets or clears the person's callback by hand | — |
| `set_contact_dnc` | retires a person | a do-not-call with no reason |
| `restore_contact` | puts them back | — |
| `update_contact_detail` | fixes phone / email / linkedin, logging the old value to `call_contact_edits` | a field that is not one of the three; a phone under 7 digits; a malformed email |

### Files

```
lib/calls.js                            callStats — every campaign number, computed once
app/calls/actions.js                    the seven server actions
app/calls/page.jsx                      rep picker, orphan banner
app/calls/orphans/page.jsx              the form for calls that belong to nobody
app/calls/[rep]/page.jsx                a rep's lists, as cards
app/calls/[rep]/[campaign]/page.jsx     the workspace: tiles, filters, the call list, the log form
app/page.jsx                            Overview — Calls logged, Meetings booked
app/meetings/page.jsx                   the meetings board and the calls that booked one
app/person/[email]/page.jsx             one human's call history
```

---

## 7. Live state, 20 August 2026

| | |
|---|---|
| Calls logged | **11** (7 didn't reach, 3 follow up, 1 booked, 0 not interested) |
| Soft-deleted call rows | 11 — kept as evidence, counted nowhere |
| Calls belonging to nobody | **0** |
| Calls with no rep | **0** |
| People ever called | 11 |
| Meetings | 5 counted, 1 of them off the phone |
| People reached (all channels) | 2,419 — of which 11 phoned |
| Contacts on the SAFE list | 1,252, of which **93** have a phone or email, 5 do-not-call |
| Follow-ups due | 0 |

**Every page agrees.** Overview 11, Overview filtered to Mark Vasu 11, rep card 11,
campaign page 11. Rep card and campaign page both read 1 meeting.

---

## 8. Still open

None of these stop a rep working. In the order worth doing them.

**A · "Calls logged → see who" lands on the rep picker.** Every other tile on the Overview
drills into `/list?metric=…`. There is no list of calls anywhere in the app, so the number
16 — now 11 — is never shown as rows. Needs a `calls` entry in `METRICS` (`lib/db.js`) and
a row shape in `/list`.

**B · Two people sharing a firm mailbox merge into one "person reached."** `reached_people`
keys a phoned person on `lower(email)` with no shared-mailbox test. `v_lead_people` has one
(migration `20260820180640`). Reproduced 20 Aug: dialling Christa Waring and Craig Tooman,
both `info@ctaarchitects.com`, gave **Overview 13 phoned, Leads 14**. **11 contacts** sit
behind 3 such addresses — `info@midtownpreservation.com` (5 people), `info@randpc.com` (4),
`info@ctaarchitects.com` (2) — so 8 people will vanish from People reached as they are
dialled. The fix is to lift the `shared_mailbox` CTE into `reached_people`.

**C · Tiles count do-not-call people; the lists they open hide them.** `peopleReached`,
`notReached`, `notInterested` and `buildingsCovered` run over all contacts; the list
filters `!dnc`. No drift today — no DNC contact has a call — but retiring someone you have
spoken to starts it.

**D · `callsFor` does not page.** PostgREST caps a response at 1,000
rows and there is no `.range()` loop, unlike `contactsFor` right above it. Past the cap
there is no error — the oldest calls simply stop arriving. 11 today.

**E · `/meetings` has its own JavaScript rule for whose meeting it is.** `ownerOfMeeting` (`app/meetings/page.jsx:43`)
is group owner → `logged_by`; `meeting_rows` is group owner → group-of-campaign → call
campaign owner → `phone_calls.rep` → `logged_by`. They agree on today's 5 rows only because
one rep owns everything.

**F · `/person/[email]` matches the address case-sensitively** and
`update_contact_detail` stores what the rep typed without lowercasing. Every row is
lowercase today, so it works. `adopt_orphan_call` lowercases; the other two should too.

**G · Front end.** Not designed. The workspace is a working surface, not a designed one —
the tile grid, the call list rows and the log form all wear the dashboard's generic
components.

---

## 9. How to verify any of this

Nothing in this file is a claim about code. Every number above came from the live database
and can be re-asked.

```sql
-- the four tags, and how many calls wear each
select outcome, count(*) from phone_calls where deleted_at is null group by 1 order by 2 desc;

-- calls that belong to nobody. Must be 0.
select count(*) from phone_calls where deleted_at is null and contact_id is null;

-- the Overview's two numbers
select count(*) from phone_calls where deleted_at is null;
select * from meeting_counts(null, null, null, null, null);

-- a person still flagged for a callback that no live call asks for. Must be 0.
select count(*) from call_contacts ct
 where ct.callback_date is not null
   and not exists (select 1 from phone_calls pc
                    where pc.contact_id = ct.id and pc.deleted_at is null
                      and pc.callback_date = ct.callback_date);

-- shared firm mailboxes — the people item B will merge
select lower(trim(email)), count(*), array_agg(full_name order by full_name)
  from call_contacts where nullif(trim(email), '') is not null
 group by 1 having count(*) > 1;
```

To test the write path end to end without leaving anything behind, log against a contact,
check the numbers, then `delete from meetings where source_call_id in (...)` and
`delete from phone_calls where note like '...'`. `delete_call` is a soft delete and leaves
a cancelled meeting, which is right for a rep and wrong for a test.
