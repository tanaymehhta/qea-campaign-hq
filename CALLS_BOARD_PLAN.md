# The Calls board — how it ships

Written 21 August 2026, after the mockups at `mockups/calls-board.html` and
`mockups/calls-page.html` and the token pass on branch `skin-tokens`
(worktree `../qea-skin`, one file, `app/globals.css`).

This is the execution plan for putting that board on
`/calls/[rep]/[campaign]` for real, wired to Supabase, without loosening any
of the rules the Calls pages were rebuilt around on 20 Aug.

---

## 0. The one decision everything else follows from

**The board is server-rendered and its state lives in the URL. Nothing fetches.**

The temptation with a Kanban is to make it a client component that pulls rows
over an API route and keeps `openContact` in React state. Do not. Three
reasons, in order of how much they'd cost:

1. **The write path already works and it is not REST.** Every write is a
   `db.rpc(...)` on a security-definer function — `log_call`, `edit_call`,
   `delete_call`, `set_callback`, `set_contact_dnc`, `update_contact_detail`,
   `restore_contact` (`app/calls/actions.js`). RLS blocks direct table writes,
   so a client component cannot write at all without a new endpoint that
   re-implements the same validation the database already does. A
   `<form action={logCall}>` inside a server-rendered drawer keeps all of it.
2. **`done()` already reopens the row.** After any write it redirects to
   `?open=<contact_id>#c-<contact_id>`, `"replace"`, so the rep does not lose
   their place mid-shift and does not get one history entry per logged call.
   If the drawer reads `?open=`, that contract keeps working untouched and the
   drawer survives a refresh, a Back, and a pasted link. If the drawer is React
   state, every write closes it and `done()` has to be rewritten.
3. **The query layer stays single.** `/leads` shipped with *no SQL, no schema,
   no new query* — the whole point of `lead_facets`/`lead_rows` is that there is
   one of each predicate. Same rule here: `contactsFor`, `callsFor`,
   `callStats`, `meetingsForCalls` are asked exactly what they are asked today.

So: **URL is the state.** `?view=board|list` · `?f=<filter>` · `?open=<id>` ·
`?editCall=<id>` · `?v=all`. All of those already exist except `view`.

Client JavaScript is one small component for the drawer's open/close animation
and the Esc key. It renders `children` — the panel content is server HTML.

---

## 1. What gets built

Five files. Two are new, three are edits.

| File | What | Size |
|---|---|---|
| `components/board.jsx` | new. `{columns, items, statusOf, card}` → the five-column grid. Dumb: no data, no fetch. | ~60 lines |
| `components/drawer.jsx` | new, `"use client"`. Slide-over + scrim + Esc. Open when `?open=` is set; closing is a `router.replace` that drops the param. Renders `children`. | ~40 lines |
| `app/calls/[rep]/[campaign]/page.jsx` | edit. Group the existing `list` by `statusOf`, render `<Board>` or the existing `.mrow` list depending on `?view`. The person panel — the `<div className="mbody">` block that exists today — moves into a `<PersonPanel>` function used by both. **Nothing inside it changes.** | ~80 lines moved, ~40 new |
| `components/ui.jsx` | edit. `Tile` and `Pill` reskinned. Same props, same call sites. | ~30 lines |
| `app/globals.css` | edit. `.board`, `.col`, `.card`, `.drawer` + the tile/row type from the mockup. Uses `--panel`, which the token pass already added. | ~120 lines |

`app/calls/actions.js`: **untouched.** `lib/calls.js`: **untouched.**
`supabase/migrations`: **nothing.** No API route. No new dependency.

---

## 2. The data, exactly as it already flows

```
page.jsx (server, force-dynamic)
  ├─ contactsFor(camp.id)        1,252 rows, pages past PostgREST's 1,000 cap
  ├─ callsFor(camp.id)           live calls, newest first
  ├─ meetingsForCalls(calls)     Map<call_id, meeting> via source_call_id
  └─ callStats(contacts, calls, meetingOf)
         └─ is.due / is.never / is.notreached / lastOutcome / the tile figures
```

The board needs one thing this does not already give it: a person's **column**.
That is `statusOf(ct)`, which is already defined on the page —
`dnc → never_called → lastOutcome(ct)`. Five values, five columns. No new
predicate, no new query, no client grouping of data that the server did not
already have in memory.

### The rule that decides the column headers

> the number, the click and the list must be the same pile (`NEXT_AGENT.md` §1)

A column header count comes from `callStats`, **not** from
`column.items.length`. They differ on purpose: the list shows the 93 people who
have a phone or an email, and `neverCalled` is 1,191. A header that reads the
rendered array would say 82 while the tile above it says 1,191, and the two
would be right about different things with no way to tell. So:

- header count = the `callStats` figure for that status
- under it, one line: `1,109 more — 82 shown with a phone or email`
- the **Show them anyway** toggle (`?v=all`) is the same toggle it is today

Same reason the empty "Not interested" column renders at 0 instead of
disappearing: the `/leads` facet rail hid zero-count rows and NYC LL11 vanished
while still selected in the URL.

### Rendering 1,236 cards

Only if someone hits **Show them anyway**. Default is 93 people, which is what
the page renders today, so the base case is free. For the `?v=all` case: cap
each column at 50 cards with a "show 50 more" that bumps a `?n=` param. Server
side, no virtualisation, no library.

---

## 3. The write path, click by click

Nothing here is new. This is the trace, so it is on the record that the board
does not add a hop.

```
rep clicks a card
   → <a href="?f=…&v=…&open=ct.id#c-ct.id">           (a link, not onClick)
   → server re-renders the page with the drawer open
   → the drawer holds the same <form action={logCall}> the row holds today
   → rep picks one of the four radios, presses Log call
   → server action → db.rpc("log_call", …) → security-definer fn validates
   → done() → revalidatePath(this page, "/", "/meetings")
   → redirect(?open=ct.id#c-ct.id, "replace")
   → drawer is open again on the same person, tiles and columns both moved
```

The card the rep just logged **moves columns on that redirect**, because
`statusOf` reads `lastOutcome` and the page re-queried. That is the whole
"drag" feature, without drag: the outcome moves the card, and there is exactly
one way to set an outcome. Adding drag-and-drop would create a second write
path for the same fact and would have to answer "which of the four tags did
dropping mean?" — it means nothing, so it is not built.

Four tags stay four tags. Three dates stay three separate dates (call date,
meeting date, callback) — `log_call` refuses a `booked_meeting` without a
meeting date, and that refusal is why a meeting agreed on 4 Aug stopped landing
on 4 Aug's board.

---

## 4. What this must not quietly change

Each of these is an open item in `CALL_LOGS.md` §8. The redesign is not the
place to fix them, and it is very much the place to accidentally *move* them.

| | Risk in a board | Guard |
|---|---|---|
| **C · tiles count DNC people, lists hide them** | A "Do-not-call" column would make the drift visible and then hide it again | Keep DNC out of the five columns; it stays a tile filter (`?f=dnc`), as today |
| **D · `callsFor` does not page** | 11 calls today; past 1,000 the oldest silently stop arriving and cards land in the wrong column | Not this branch's job, but log it: the board makes a wrong column visible where a wrong row-badge was not |
| **B · shared mailboxes double-count** | 11 contacts sit behind 3 `info@` addresses | Unchanged. The card shows the person, the note says "same mailbox as X" if the rep wrote it |
| **A · "Calls logged → see who" opens the rep picker** | — | Unchanged |

And the meta-rule: **no figure on this page may be computed in the board.**
If a number is not already coming out of `callStats`, it does not go on a
column header.

---

## 5. Order of work

Each step is a commit that can ship on its own and be looked at on
`qea-campaign-hq.vercel.app`.

1. **Tokens + type.** Done, on `skin-tokens`. One file. Every page changes, no
   page is finished. Merge this first and live with it for a day.
2. **`Tile` + `Pill`.** Same props, new skin. Touches every page; zero logic.
3. **`PersonPanel` extraction.** Pure refactor of `page.jsx` — the panel comes
   out of the `<details>` into a function, still rendered inside the
   `<details>`. **No visual change, no behaviour change.** This is the step
   where a mistake is cheapest to see, because the page should look identical.
4. **`Drawer` + `?open=` .** The list rows keep working; clicking a row name
   opens the drawer instead of expanding. Verify: log a call, get redirected,
   drawer still open on the same person.
5. **`Board` + `?view=`.** List stays the default for one deploy. Board is one
   link away.
6. **Flip the default to board**, once Mark has run a shift on it.

Then the same board component pays for itself on **`/meetings`**
(booked / held / cancelled), which is a stage list rendered as a table today.

---

## 6. How each step is verified

No `next build` while a dev server is up — it wipes `.next` under the running
server and every page 500s until restart (17 Aug). Instead:

```bash
# a worktree of its own, its own port — the main tree usually has another agent in it
git worktree add -b calls-board ../qea-board HEAD
ln -s ../qea-campaign-hq/node_modules ../qea-board/node_modules
cd ../qea-board && npx next dev -p 3141

# every page still answers
for p in / /meetings /leads /calls /pipeline /inbound /campaigns /health /replies; do
  curl -s -o /dev/null -w "%{http_code} $p\n" localhost:3141$p; done
```

**The parity check that actually matters** — the tile figures must not move
across the redesign. `lib/db.js` carries the Supabase anon credentials inline,
so a bare node script reads live without env setup (this is how
`scripts/meetings-parity.mjs` works):

```
scripts/calls-parity.mjs
  → callStats(contactsFor(camp), callsFor(camp), meetingsForCalls(calls))
  → print callsMade, peopleReached, meetingsBooked, followupsDue,
          neverCalled, notReached, notInterested, buildingsCovered, doNotCall
  → plus the count per statusOf() bucket, and assert they sum to contacts.length
```

Run it before step 3 and after step 6. Same nine numbers, or the branch is
wrong. Today it should print `11 · 4 · 1 · 0 · 1,191 · 7 · 0 · 75 · 5`.

Screenshots for each step, headless, before/after on the same URL:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=after.png --window-size=1440,1400 --hide-scrollbars \
  "http://localhost:3141/calls/Mark%20Vasu/nyc-ll11-safe"
```

**Dark mode is not optional.** The mockup hardcodes `#fff` and `#f4f4f6`; the
real thing may not. Every new rule uses tokens, and every new token gets its
twin in all three blocks — `:root`, `[data-theme="dark"]`, and the
`prefers-color-scheme` copy. Check the toggle on the board before each merge.

Rollback for any step is `git revert` of one commit; the database is never
touched, so there is nothing to migrate back.

---

## 7. Not doing

- ~~**Drag-and-drop.**~~ Built 21 Aug, and the objection above is why it works
  the way it does. The premise was wrong in one place: the five columns *are*
  statusOf()'s five values, so a drop on "Follow up" does say `follow_up` and
  nothing else. What a drop still cannot say is the date, the note, and the day
  a meeting actually happens — so a drop **writes nothing**. It opens the person
  with that tag preselected and asks for the rest, and the same
  `<form action={logCall}>` posts it. There is still exactly one way to set an
  outcome. Dropping into "To call" is refused with the reason (a call is what
  took them out of it), and dropping a card back where it started is a no-op.
- **An API route / client data fetching.** RLS blocks direct writes; the RPCs
  are the API and server actions already reach them.
- **A state library.** The state is five query params.
- **Realtime.** Two reps, one list. `revalidatePath` after a write is enough.
- **Touching `lib/calls.js` or any migration.** If this plan starts needing
  SQL, something in it is wrong.

---

## 8. Every figure on the page, and the column it comes from

Added 21 August 2026, after the mockup's tiles were brought onto the shipped
`Tile` component. Nothing here is a new query. The left column is what a rep
sees; the right is the row it is read from. If a figure cannot be written in
this table, it does not go on the page.

### The nine tiles — all of them `callStats()` in `lib/calls.js`

| Tile | Computed as | Rows read |
|---|---|---|
| Calls made | `calls.length` | `phone_calls` where the contact's `call_campaign_id` is this campaign and `deleted_at is null` |
| Spoke to someone | distinct contacts with ≥1 call whose `outcome <> 'not_reached'` | `phone_calls.outcome` |
| Meetings booked | `meetings` reachable by `source_call_id`, `deleted_at is null`, `status <> 'cancelled'` | `meetings` — **not** a count of `booked_meeting` calls, so two dials confirming one meeting stay one meeting |
| Follow-ups due | `callback_date <= today()` and not `dnc` | `call_contacts.callback_date` |
| Never called | not `dnc`, zero `phone_calls` rows | `call_contacts` ⟂ `phone_calls` |
| Didn't reach them | ≥1 call, none that got through | `phone_calls.outcome` |
| Not interested | **newest** call's outcome is `not_interested` | `phone_calls` ordered `call_date desc, created_at desc` |
| Buildings covered | `sum(buildings_count)` over reached contacts | `call_contacts.buildings_count` |
| Do-not-call | `dnc = true` | `call_contacts.dnc` |

Every tile is an `<a href="?f=…">` — the click sets the filter that re-runs the
same predicate over the same array. One definition, one number, one list.

### A card

| On the card | Column |
|---|---|
| Name | `call_contacts.full_name` |
| Age, top right ("4d") | `phone_calls.call_date` of the newest call; falls back to `#best_rank` when never called |
| Phone / email line | `call_contacts.phone`, else `.email` |
| "63 bldgs · Acme Engineering" | `call_contacts.buildings_count`, `.org_name` |
| Note line | `phone_calls.note` of the newest call |
| 🗓 chip | `meetings.meeting_date` joined on `source_call_id`; if none, `call_contacts.callback_date` |
| ⚑ and the orange edge | `callback_date <= today()` |
| Green card | newest outcome is `booked_meeting` |
| **Which column it sits in** | `statusOf(ct)` = `dnc → never_called → newest outcome`. No stage column in the database; the outcome *is* the stage |

### Column headers

The header count is the `callStats` figure, never `column.items.length`. They
differ on purpose — 1,236 never-called vs. the ~82 of them with a phone — and
the line underneath says so: `1,154 more — 82 shown with a phone or email`.

---

## 9. How it stays current

There is no poller, no socket, no cache to invalidate by hand.

**Reads.** The page is `export const dynamic = "force-dynamic"`. Every request
re-runs `contactsFor` → `callsFor` → `meetingsForCalls` → `callStats` against
Supabase through the anon client in `lib/db.js`. Nothing is memoised between
requests, so a page load is always the state of the database at that moment.

**Writes.** `<form action={logCall}>` → `db.rpc("log_call", …)`, a
security-definer function that validates in the database (RLS blocks direct
table writes, so a hostile POST fails there, not in our UI). Then `done()`:

```
revalidatePath(this page) · revalidatePath("/") · revalidatePath("/meetings")
redirect(?open=<contact>#c-<contact>, "replace")
```

So one press moves the card to its new column, moves the two tiles it affects,
moves the Overview's Calls tile and the Meetings table — in the same redirect,
with the drawer still open on the same person.

**What it does not do:** if Mark logs a call while Justin has the board open,
Justin's screen does not change until he clicks something. Two reps, one list,
`force-dynamic` — that is enough, and realtime is explicitly not built (§7).

**What arrives without a rep:** nothing on this page. Contacts were loaded once
from `data/Campaign02_SAFE_Reliable_2119.xlsx`; calls and meetings are entirely
hand-logged. There is no vendor feed behind any figure here, which is why these
numbers can be trusted in a way the email tiles need a sync badge to qualify.

---

## 10. Ship order, revised 21 Aug

Step 2 of §5 is done and cost nothing: `components/ui.jsx`'s `Tile` already
renders label → figure → note → "see who →", and the campaign page already
calls it with `hero` for the four activity figures and the plain size for the
five list-state ones. The mockup was the thing that was behind, and it has been
brought onto that shape. So what remains is:

1. `PersonPanel` extraction — pure refactor, page must look identical.
2. `Drawer` + `?open=` — clicking a name opens the slide-over instead of expanding.
3. `Board` + `?view=` — list stays the default for one deploy.
4. Flip the default to board after Mark runs a shift on it.

Verified by `scripts/calls-parity.mjs` before step 1 and after step 4: the nine
figures must read `11 · 4 · 1 · 0 · 1,191 · 7 · 0 · 75 · 5` on both sides, and
the per-column buckets must sum to `contacts.length`.
