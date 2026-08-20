# Handoff — Overview dashboard, the response→meeting funnel

Written 20 August 2026, end of session. Everything below is measured against the live
Supabase project `yfnqszwlyoyfhuwfmcyl`, not inferred from code. `main` is at `275aff9`,
pushed, and deployed to https://qea-campaign-hq.vercel.app.

Read this, then `TRUST_OPEN.md` (live decision register) and `RESPONSE_PILE.md` (how the
response pile was built). `TRUST.md` is a frozen 18 August snapshot — architecture, not
current state.

---

## 1. The one rule this codebase is organised around

**The number, the click, and the list must be the same pile.**

A tile says 31. You click it. The page behind it lists exactly those 31 people — same
window, same rep, same vendor, same rule. If they disagree, the work is not done.

This sounds obvious. It was violated by every metric on this dashboard as recently as this
week: the homepage said "People who replied · 3" and the click opened 193 messages. Both
numbers were computed honestly and neither was the other's pile. `TRUST.md` calls this F2.

**The mechanism that enforces it:** the rule lives in Postgres, once, and every reader asks
that one definition. Not in a React render, where a second page cannot call it.

---

## 2. What shipped today

| commit | what |
|---|---|
| `81bfc96` | `response_people` / `response_counts` — one SQL definition of "a person who responded". Homepage and `/replies` both read it. |
| `bbfdb96` | lemlist's inbox rescued before the subscription ended; 135 replies read and labelled by Tanay; five answer categories collapsed to three. |
| `e247272` | QEA Resellers + LBER reassigned from Tanay to Mark Vasu. Four reps → three. |
| `275aff9` | docs |

Migrations: `20260820120000` (the definition), `20260820160000` (the lemlist rescue),
`20260820180000` (the rep move).

**Live numbers, all time, all reps:**

```
People reached  1,839
Total responses    31   =  15 interested + 16 not interested
Interested         15   =  48.4% of the 31 who replied
Meetings booked     5
```

### The vocabulary, settled by Tanay after reading all 135 replies himself

Three answers, and **`unclassified` is not one of them**:

| | |
|---|---|
| `interested` | a human said yes |
| `not_interested` | a human said no — **still a response** |
| `auto_reply` | a machine. Not a response. |
| `unclassified` | *nobody has read it yet.* A fact about us, not an answer from them. In no tile. Surfaces as "N still to read". |

`referral` and `not_now` remain legal in the schema's check constraint and are used by **no
row**. Do not reintroduce buttons for them without asking.

**Total responses = interested + not_interested, exactly.** `not_interested` has **no flag
of its own** anywhere — not in the RPC, not in `lib/db.js` `PILES`, not on the tile. It is
`responded && !interested` in all three places, deliberately, so the parts cannot stop
summing to the whole. Preserve that property.

---

## 3. The API you will build on

```sql
response_people(p_from date, p_to date, p_campaigns uuid[], p_source text)
-- one row per person: lead_email, lead_name, company, sources[], labels[], msgs,
--   first_at, last_at, responded, interested, needs_label, robot_only
response_counts(same args) -- people, responded, interested, needs_label, robot_only
```

- `p_from`/`p_to` are **inclusive New York calendar dates**; NULL = unbounded. They match
  `v_daily_facts.metric_date`, which is why the window boundaries are not UTC.
- `p_source`: `'instantly'`, `'lemlist'`, or NULL for both. **Both tiles use NULL now.**
- `p_campaigns`: NULL = everything the anon key can see. A rep's scope is resolved to
  campaign ids first — `campaignIdsForRep()` in `lib/db.js` is the only thing that should
  know a rep owns groups rather than campaigns.
- `security invoker` on purpose. RLS already hides hidden campaigns from anon; a
  `security definer` read here would leak 58 rows the dashboard has never been allowed to
  see.

Call them **only** through `lib/db.js`:

```js
responseCounts(scope)                    // -> {people, responded, interested, needs_label, robot_only}
responsePeople(scope, {pile, limit, offset, tag, search})
PILES                                    // responded | interested | not_interested | needs_label | all
```

`responseCounts` returns **nulls on error, never zeros** — `num(null)` renders an em dash,
so a failed read reaches the screen as "—" rather than as "nobody wrote back". Keep that
pattern in anything you add.

### Two PostgREST facts, measured, that will cost you an hour if you rediscover them

1. **The `Range` header is ignored on `POST /rpc`.** `Range: 0-2` on a 9-row result returns
   all nine. `limit`/`offset` query params work. This version of `postgrest-js` implements
   `.range(a,b)` as those params, so `.range()` is safe — reaching for the header is not.
2. **Ordering by a column not in `select` fails on a set-returning function**
   (`column record.last_at does not exist`). The default RPC select is every column, so the
   fix is: leave the select alone.

---

## 4. Key files

| file | why it matters |
|---|---|
| `app/page.jsx` | Overview. Tiles ~line 400. `scope` object ~line 110 — the four args the tile counts with. `pileHref()` carries window+rep into the URL. |
| `app/replies/page.jsx` | One row per **person**, messages nested inside. `VIEWS` = the piles. Buttons are per **message** (see §6). |
| `lib/db.js` | `windowFrom`, `repList`, `campaignIdsForRep`, `everyRow`, `dailyRange`, `PILES`, `responseCounts`, `responsePeople`, `METRICS`, `listHref`. |
| `components/ui.jsx` | `Tile` (`raw` → `data-count`), `Reps`, `RangePicker`, `Pill`. |
| `components/tween.jsx` | Counts `[data-count]` up with `Math.round`. **Never pass `raw` to a tile whose value is JSX or a percent** — it overwrites the whole cell. |
| `app/meetings/page.jsx` | A meeting's rep = owner of its group; `logged_by` only as fallback. |
| `app/conflicts/actions.js` | `classifyReply` → `classify_reply` RPC, `revalidatePath(["/conflicts","/replies","/"])`. |
| `supabase/functions/sync/index.ts` | `looksAutomatic()` ~line 141, `ingest_replies` call, Instantly `/emails` pull. |

---

## 5. What to work on, in the order Tanay asked for

He wants the **Overview dashboard** first. Campaigns later, explicitly not now.

### 5a. Meetings booked — the same bug replies had, one tile over

The tile reads **5**. It counts **rows in `meetings`**, and:

| prospect | date | status | group | has a reply row? |
|---|---|---|---|---|
| Jeffrey Hohenstein | 22 Jul | held | Chicago Retrofit | yes |
| Krishnan Gowri | 27 Jul | booked | QEA Resellers | **no** |
| Mark Attard | 28 Jul | held | QEA Resellers | yes |
| **Jeffrey Hohenstein** | 30 Jul | booked | Chicago Retrofit | yes |
| Baris Acar | 4 Aug | booked | *(none — from a call)* | **no** |

**Jeffrey Hohenstein is in there twice.** So 5 meetings = **4 distinct people**. That is
exactly the messages-vs-people fault the response tile had, and it is unfixed here.

Decide, do not assume: is "Meetings booked" a count of *meetings* (5 — two separate
conversations with the same man is two meetings) or of *people who took a meeting* (4)?
Both are defensible. What is not defensible is the tile saying one and the list showing the
other. Whichever you pick, say it on the tile and make the click open that pile.

**Also missing: two real meetings that are not in the table at all.** Found in the lemlist
inbox during the rescue and documented in `LEMLIST_RESCUE.md`:

- **Younes Amermouch** (Insight Energy Consulting) — offered three windows, Mark replied
  *"Thursday at 11:00AM works. I'll send an invite."*
- **Sherry Chen** (Johnson Fain, on Brendan Bailey's thread) — *"Our next available time is
  9/9, 9/23, and Wednesdays onward. Let me know which date works and feel free to send a
  calendar invite."*

Both are `interested` now, neither is a `meetings` row. Ask Tanay whether they happened
before adding them — `meetings` is hand-kept and its accuracy is the point of it.

### 5b. The funnel in front of and behind the response tiles

This is the shape Tanay is after. Today it is four tiles that do not visibly relate:

```
People reached 1,839  →  Total responses 31  →  Interested 15  →  Meetings 5
```

**Two things are true about that chain and both need handling honestly:**

1. **It is not a strict funnel.** 2 of the 5 meetings (Krishnan Gowri, Baris Acar) have **no
   reply row at all** — they came from calls or channels outside the sequence. So
   "meetings ⊂ interested" is false, and a funnel chart drawn as nested subsets would lie.
2. **`People reached` is Instantly-only.** lemlist never wrote `new_leads_contacted` — 0
   across all 234 of its campaign-days. Responses are now **both vendors**. So
   `31 ÷ 1,839` is not a rate; its numerator and denominator are different populations.
   This is the single most repeated fault in `TRUST_OPEN.md` §1 — do not compute it.

   This is exactly why the Interested tile divides by **responses**, not by people reached:
   `15 of the 31 who replied`. One pile on both sides.

So: a response→interested→meeting progression is honest **within** the responses pile. A
reached→response rate is not, while lemlist is in the count. If Tanay wants that top rate,
the options are (a) an Instantly-only sub-view where the denominator exists, or (b) show
reached as context, not as a denominator. Recommend, don't silently pick.

### 5c. One click of housekeeping

`1 still to read` on the live tile — **Ken Day, Irvcon Limited**, arrived 15:10 UTC on
20 Aug via the Roof Campaign. It is a retirement notice ("as of April 30, 2025, I am
retiring"). `looksAutomatic()` missed it because the subject carries no out-of-office
signal. Answer is **Automatic**, one click on `/replies?view=needs_label`.

Do **not** "fix" `looksAutomatic()` to catch retirement notices without asking. A regex
guessing harder is how 109 lemlist replies became unreadable robots in the first place. One
click a day may simply be the right answer.

---

## 6. Rules that are not negotiable without asking Tanay

1. **`classified_by = 'human'` is sacred.** The sync skips those rows permanently. A
   machine guess uses `'ai'`, never `'human'` — borrowing it makes the guess unfixable.
2. **Never store a second copy of a count you can `count(*)`.** No `total_responses` column,
   no nightly rollup. `TRUST_OPEN.md` house rule 7. The whole three-notebook drift problem
   exists because someone did.
3. **A blank beats a zero; a labelled number beats a blank.** Never render "unknown" as `0`
   — that is the `COALESCE(…, 0)` fault the 18 August review exists to end.
4. **A rate's numerator and denominator must be the same kind of thing**, from populations
   that overlap. Most broken numbers here failed this one test.
5. **Fix every call site of an expression, not the one in the ticket.** T1 has three and the
   sort comparator is the one nobody looks at.
6. **Labelling buttons stay per-message, not per-person.** `classify_reply` labels a row,
   and a thread can hold an out-of-office *and* a real answer — Bharat Mudgal's does. One
   control per person would have to silently pick a row to write to.
7. **Do not relabel Bharat Mudgal's replies** without reading migration `20260818205745`.
   (Tanay overrode this himself on 20 Aug for one row; the migration explains the original
   reasoning and still stands as context.)
8. **lemlist is retired.** Its API is gone as of ~22 Aug. Build nothing against it. Its rows
   stay in `replies` as permanent history.
9. Do not run `next build` while a dev server is up — it wipes the running server's cache.

---

## 7. How to verify anything you build

The check that caught a real bug today, and the reason to keep using it: **scrape the
tile's number and its own `href`, follow that href, count the rows.** Not "run the query and
compare" — that proves the number, not the click.

```bash
npx next dev -p 3100        # port 3000 is an unrelated WhatsApp bridge on this machine
```

Then for each scope (all time, 7/30/90, single days, each rep), assert
`tile number == rows behind its href`. Today that was 32 scopes, and scope
`d=2026-08-04` failed — one person answered, zero new leads were contacted that day
(follow-up sends), and an em-dash guard inherited from when the tile was a *rate* blanked a
tile whose list held a real human. A count needs no denominator. Steps A, B and C were each
individually correct and the tile still lied on one day in five.

Useful SQL lives in `TRUST_OPEN.md` §9 (Q6 is the response definition, by hand).

---

## 8. Still open, ranked

1. **T1 · `/campaigns` "Reply %"** — the last known-wrong number on the site. Renders
   `pct(replied, leads)` in three places including the sort comparator; `leads` is imported
   list size, and sends-per-lead swings 5× between groups (Chicago 3.8, Mark Dolan 0.7).
   LBER reads 8.0% and ranks first off 87 leads. Decision written and awaiting go —
   `TRUST_OPEN.md` §4. Tanay said campaigns is *not* this session's work.
2. **Q4 · `/list?metric=opened` says 351 against the tile's 225.** Same F2 family, one page
   over. `response_people` is now the pattern for fixing it.
3. **Q1 · `/campaigns` shows `0` opened where tracking is off.** Canada: 0 opens on 1,504
   sends across 11 campaigns that cannot register one. Must render `—`. The homepage tile
   was fixed in `8aafd4f`; the per-group column never was.
4. **Did the sync drop lemlist replies?** Two replies existed in lemlist's inbox that were
   never in `replies` (Younes 3 Aug, Sherry Chen 20 Jul). That is a *dropped row*, not a
   truncated body. Nobody counted how many. **The API is gone, so this can no longer be
   measured** — it is now a known unknown, recorded here so it is not mistaken for
   completeness.
5. **Two "Mark" chips.** `components/ui.jsx:67` renders `r.name.split(" ")[0]`, so Mark Vasu
   and Mark Dolan both read "Mark", separated only by avatar initials and subtitle. More
   confusing now that one owns three of five groups. ~15 minutes.
6. `OUTCOME_PRIORITY` in `app/calls/actions.js:43` contradicts its own comment — see
   `PROGRESS.md`.

---

## 9. Where the paper trail is

| file | what it is |
|---|---|
| `TRUST_OPEN.md` | **Live** decision register. T1 open, T2/T3 shipped, Q1–Q6 reported. §9 has the queries. |
| `TRUST.md` | Frozen 18 Aug provenance review. Architecture and root causes. **Not current state.** |
| `RESPONSE_PILE.md` | Build log for the response pile, §1–§11. Includes what was measured and what was deliberately not done. |
| `LEMLIST_RESCUE.md` | The rescued message bodies — the only surviving copy of text lemlist will not serve again — plus how Tanay's decisions differed from the proposals. |
| `PROGRESS.md` | Long-running project log. |
| `HOMEPAGE_REVAMP.pdf` | Superseded. A prior agent's plan; its execution order was rejected for good reason (`RESPONSE_PILE.md` §1). Read only for history. |
