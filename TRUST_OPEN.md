# Trust register — open problems

Rolling, opened 19 August 2026. Still open unless an entry says otherwise.

`TRUST.md` is a **frozen provenance review dated 18 August 2026** — read it for how the
three-copy architecture works and why `COALESCE(…, 0)` is the root cause. It is not
updated as things are fixed, so a finding in there may already be closed.

**This file is the live one.** Every metric problem raised after that review lands here,
with its measurement, its options, and its decision. If you are an agent picking this up
cold: read §1 and §2, then the `OPEN` and `DECIDED` entries. That is enough to resume.

---

## Contents

1. [Restore in sixty seconds](#1-restore-in-sixty-seconds)
2. [The shape every entry shares](#2-the-shape-every-entry-shares)
3. [Closed since the 18 August review](#3-closed-since-the-18-august-review)
4. [T1 · OPEN · `/campaigns` "Reply %"](#4-t1--open--campaigns-reply-)
5. [T2 · SHIPPED · Homepage Total responses + Interested](#5-t2--shipped--homepage-total-responses--interested)
6. [T3 · SHIPPED · Three answers, both vendors](#6-t3--shipped--three-answers-both-vendors)
7. [T4 · SHIPPED · Homepage People reached](#7-t4--shipped--homepage-people-reached)
8. [T5 · SHIPPED · Homepage People who opened](#8-t5--shipped--homepage-people-who-opened)
9. [Reported, not yet written up](#9-reported-not-yet-written-up)
10. [House rules for anything that lands here](#10-house-rules-for-anything-that-lands-here)
11. [The queries behind this file](#11-the-queries-behind-this-file)

---

## 1. Restore in sixty seconds

Every metric on this dashboard can be wrong the same way. Two vendors feed one schema,
each is blind to a different set of columns, and the code renders "this vendor never
reported it" as `0`. `v_campaign_summary` does `COALESCE(t.<col>, 0)` on every metric, so
a missing fact and a real zero are indistinguishable by the time they reach a tile.

Measured 19 August 2026 — the same column, both vendors:

| column | Instantly | lemlist |
|---|---:|---:|
| `new_leads_contacted` | 1,839 | 0 |
| `unique_opened` | 225 | 0 |
| `unique_replied` | 13 | 0 |
| `clicked` | 4 | 0 |
| `delivered` | 0 | 1,844 |
| `bounced` (daily) | 0 | 77 |
| `linkedin_*` | 0 | 103 |

**Any rate whose numerator and denominator sit on opposite sides of that table is wrong.**
Not approximate — structurally wrong, and wrong in a direction that flatters whichever
vendor happens to populate the numerator.

The second failure mode, discovered in T1 and not covered by the 18 August review: even
where both vendors populate a column, **they can be counting different objects into it.**
`campaign_totals.replied` is distinct people on Instantly and reply messages on lemlist.
Filling the zeroes is not sufficient; the units have to be checked one column at a time.

lemlist is being retired. Nothing new gets built against its API. Reading it once through
the MCP connector for a one-off repair is fine.

Homepage response tiles are **T2** below: they count labelled Instantly people from
`replies`, not from `campaign_totals.replied`. Decided 20 August 2026, not built yet.

---

## 2. The shape every entry shares

```
### T<n> · <STATUS> · <the metric, where a human reads it>

**Symptom** — what someone sees and believes.
**Measured** — live numbers, with the date. Never inferred.
**Why it is wrong** — the mechanism, not the adjective.
**Options** — what was considered, including what was rejected and why.
**Decision** — or "open, blocked on <who/what>".
**Verify** — the query, so nobody takes this file's word for it.
```

Statuses: `OPEN` (no decision), `DECIDED` (settled, not built), `SHIPPED` (in `main`,
with the commit), `DROPPED` (deliberately not fixed, with the reason).

Data judgments ship as migrations with the reasoning in the header — the convention set by
`20260818205745`. A decision recorded here and nowhere else is a decision that gets
re-argued in three weeks.

---

## 3. Closed since the 18 August review

Recorded so they are not re-investigated. All on `main`, all 19 August 2026.

| commit | what it settled |
|---|---|
| `722c24d` | Response-rate tile: distinct people, robots and refusals removed, Instantly-only. Reads **3 · 0.2%**. |
| `2dc5428` | Full message bodies. The sync stored a 60-char preview while `body.text` sat in the same payload. New `ingest_replies` RPC repairs bodies on re-sync **without ever touching a human's label**. Also lifted a ceiling that could not fall. |
| `2b077d4` | The tile says on its face why it is 3 and not 58. |
| `8aafd4f` | Opened tile was 800 events ÷ 7,542 = 10.6%. Now **225 unique ÷ 3,574 tracked sends = 6.3%**, because 12 of 22 Instantly campaigns run with tracking off and their sends cannot be in the denominator. |
| `e911761` | `/pipeline` and the queue now mean the same day when asked about one day. |

And on 20 August 2026:

| commit | what it settled |
|---|---|
| `81bfc96` | One SQL definition of a response (`response_people` / `response_counts`). The homepage tile and `/replies` read it together, so the number and the list are one pile. T2. |
| `bbfdb96` | The lemlist inbox pulled, read and labelled before the subscription ended. Three answers replace five. Both vendors. T3. |
| `e247272` | QEA Resellers and LBER — Boston reassigned from Tanay to Mark Vasu. Four reps become three. |

Also live: five labelling buttons on `/replies`.

Two standing rules that came out of this work:

- **Machine-read labels use `classified_by = 'ai'`, never `'human'`.** The sync skips
  `'human'` rows permanently; borrowing that value to protect a machine guess would make
  the guess unfixable.
- **Do not relabel Bharat Mudgal's two unclassified replies.** Migration
  `20260818205745` explains why.

---

## 4. T1 · OPEN · `/campaigns` "Reply %"

**Symptom.** `app/campaigns/page.jsx` renders `pct(g.replied, g.leads)` in three places —
the group tile (line 68), the sub-campaign table cell (line 183), and the sort comparator
(line 35). It colours anything ≥ 3% green. `leads` is the **imported list size**;
`replied` is a vendor counter. There is no fixed relationship between the two:

| group | leads | sent | sends per lead |
|---|---:|---:|---:|
| Chicago Retrofit | 937 | 3,574 | 3.8 |
| Roof Campaign — Mark Dolan | 809 | 545 | 0.7 |

A 5x swing in what one "lead" costs, and the page sorts on the result. LBER — Boston reads
**8.0%** and ranks first on a list of 87 leads.

**Measured, 19 August 2026.** Three candidate formulas against live data:

| group | vendor | A: today (`replied ÷ leads`) | B: people ÷ reached | C: `replied ÷ sent` |
|---|---|---:|---:|---:|
| Chicago Retrofit | Instantly | 0.0% | 0.0% | 0.0% |
| QEA Resellers | lemlist | 3.5% | — | 1.1% |
| Canada — Justin's list | Instantly | 1.5% | 0.2% | 0.4% |
| Roof Campaign — Mark Dolan | Instantly | 0.9% | 0.4% | 1.3% |
| LBER — Boston | lemlist | 8.0% | — | 3.5% |

**Why it is wrong — the denominator.** `leads` is a list-size, not an exposure. Comparing
`replied ÷ leads` across groups compares two different things and calls the difference
performance.

**Why it is wrong — the numerator, which A, B and C all share.** `campaign_totals.replied`
is not the same object on the two vendors:

- Instantly writes `unique_replied` — **distinct people**.
- lemlist writes **reply messages**. LBER's 7 is 7 messages from 5 people. QEA Resellers'
  19 is 19 messages from 17 people.

So C's 3.5% for LBER is people-inflated on one side of the comparison and not the other.
Same failure mode as the denominator, one column over. Fixing only the denominator leaves
a cross-vendor comparison that is still not a comparison.

**Options.**

- **A — keep `replied ÷ leads`.** Rejected. The denominator is not an exposure and the
  page ranks on it.
- **B — distinct people ÷ reached.** Rejected, and it was rejected before this write-up.
  `campaign_totals.reached` is **never written by either vendor** and is `COALESCE`d to 0,
  so B blanks both lemlist groups — the exact two groups the problem lives in. It deletes
  the misleading number rather than correcting it, and it kills the sort.
  - Checked whether a real people-denominator could be rescued from the `leads` table
    instead. It cannot: Roof Campaign has **no rows at all** in `leads`, and Canada's 404
    rows are all `status = 'assigned'` despite 1,504 sends. Incomplete for two of five
    groups, so any people ÷ people rate would be blind in a new place.
- **C — `replied ÷ sent`.** Denominator accepted. `sent` is the only column both vendors
  populate honestly, and it is **email-only on both sides** — verified: lemlist keeps
  LinkedIn touches in `linkedin_sent` (103 across LBER), and lemlist's `contacted` equals
  its `sent` exactly. Units are consistent, nothing is structurally blind.
- **C′ — distinct non-robot people from `replies` ÷ `sent`.** Recommended. The `replies`
  table carries `lead_email` and `sentiment` for **both** vendors, so the numerator can be
  one definition instead of two. It is the same source the `/replies` labelling buttons
  write to and the same shape as the response-rate tile shipped in `722c24d`.

| group | sent | C as specified | C′ (distinct people ÷ sent) |
|---|---:|---:|---:|
| Chicago Retrofit | 3,574 | 0.0% | 0.0% |
| QEA Resellers | 1,721 | 1.1% | 1.0% |
| Canada — Justin's list | 1,504 | 0.4% | 0.3% |
| Roof Campaign — Mark Dolan | 545 | 1.3% | 0.9% |
| LBER — Boston | 198 | 3.5% | 2.5% |

Canada is 4 people, not 5: one person sent both an out-of-office and a real reply. Adding
the sentiment buckets by hand would have missed that — the numerator has to be a
`count(distinct …)` over a per-person rollup, not a sum of labels.

**Decision — recommended, awaiting go.**

1. Denominator `sent`; numerator = distinct `lead_email` in `replies` whose sentiment is
   not `auto_reply`, over campaigns that are not `hidden`.
2. **No green.** A reply is not an outcome. `replied` excludes robots but not refusals —
   LBER's 5 people include "I don't own 270 bridge street, please remove my contact info".
   Colour belongs on the interest metric, not this one.
3. **Do not rank by meetings instead.** Meetings across all five groups are 2, 1, 0, 0, 0.
   Sorting on a column that is zero for three of five rows is not a ranking. Keep reply
   rate as a sort option, keep `priority` as the default, and point the sort comparator at
   the same expression as the tile so the two cannot drift.
4. **Say the formula on the page** — "replied ÷ sent" — the way the response-rate tile now
   says what it counts. That is what makes it defensible without a footnote.

Ships as one migration with the reasoning in the header, plus the label and the green
removal in `app/campaigns/page.jsx`. All three call sites move together; patching only the
tile leaves the sort still ranking on `leads`.

**A note on what this does not fix.** No formula repairs the numerator's coverage.
`people_interested` across all five groups is **3** (Roof 2, Canada 1) — which matches the
tile exactly, and is the whole company's measured interest. There are 26 lemlist replies
(22 distinct people) sitting at `unclassified` because nobody has read them. Under C′ they
all count as replies, correctly. They move the **interest** number, not this one. See
Q5 below.

**Verify.** Query 3 in §11.

---

## 5. T2 · SHIPPED · Homepage Total responses + Interested

Tanay, 20 August 2026. Build this. Do not re-argue the ledgers. Do not collapse the
labelling buttons to two. Step 1 of the homepage revamp (Opened as a percent, Bounce as a
percent, four-then-four layout) is already in the working tree and is not this entry.

Companion: `HOMEPAGE_REVAMP.pdf` in the repo root. If that PDF and this entry disagree,
believe this file and the code.

**Symptom.** The homepage still shows one tile, “People who replied”, using the old
filter: Instantly people, minus robots, minus refusals. That is why it reads **3**, and
why the note says “58 inbound, less 47 robots and 6 refusals.” Clicking it opens `/replies`
(or `/replies?tag=unclassified`): every inbound from both tools, messages not people, all
time, `.limit(300)`. The list is ~135. The number, the click, and the list are three
different piles. That is F2 from `TRUST.md`, still live on this tile after the response-rate
work in `722c24d` / `2b077d4`.

A second, quieter failure: Instantly does **not** hand us per-message buckets of
interested / not interested / automatic / robotic / unclassified. `i_status` and
`ai_interest_value` are interest guesses. Auto vs real is a daily count, not a flag on the
email. The sync guesses robots from subject/body (`looksAutomatic` in
`supabase/functions/sync/index.ts`) and files everything else as `unclassified`. Instantly’s
interest field is currently ignored. Treating those five words as vendor truth would
rebuild the lie in a new place.

**Measured.** Not re-counted for this write-up; the live split is Query 6 in §11. The
shape, already known:

- Homepage tile = distinct Instantly people after dropping `auto_reply` and
  `not_interested`. Unclassified people still sit inside that 3 when they have no other
  label — which is the opposite of what Total must do after this change.
- `/replies` = rows, both vendors, no date, no rep, cap 300.
- `campaign_totals.replied` = Instantly unique people vs lemlist messages (T1). A
  different object again.
- Human labelling already works: five buttons on `/replies` and `/conflicts` call
  `classify_reply`, which stamps `classified_by = 'human'`. `ingest_replies` never
  overwrites that. The buttons are not the bug. The ledger the tile reads, and the page
  the click opens, are.

**Why it is wrong.** Three notebooks (`TRUST.md` §2). Overview tiles mostly read the daily
one. Campaign pages read lifetime totals. Replies / list / person read `replies`. “Replied”
is a different object in each. The previous response-rate tile already chose `replies` as
the numerator and then filtered it in JavaScript in `app/page.jsx`, without paging, and
linked to a page that does not apply the same filter. Two copies of a count, plus a click
that ignores both, is how 3 opens 135.

The 1,000-row PostgREST cap makes the JavaScript count a time bomb, not a design.
`dailyRange()` was already paged for that reason. The replies fetch on the homepage was
not. At ~200 rows it is fine. Past 1,000 the tile silently drops people and there is no
error. A one-time “fix the number” that still counts in the Next.js process fails the
moment the inbox grows.

**Options.**

- **A — keep one “People who replied” tile, keep linking to `/replies`.** Rejected.
  Refusals are a response. Unclassified is homework, not a KPI. The click is the bug
  Tanay actually feels.
- **B — two tiles, Interested and Not interested, and collapse the buttons to those
  two.** Rejected, 20 August, by Tanay. The homepage is Total + Interested. On `/replies`
  the five categories stay visible and editable: Interested, Not now, Referral, Not
  interested, Out of office. Total *collapses* those human yes/no labels into one count.
  It does not delete the labels. “Not now” and “Referral” sit in Total, not in Interested.
- **C — write Total / Interested into `daily_metrics` or `campaign_totals` so the
  homepage keeps reading Notebook 1 / 2.** Rejected. That is a fourth copy of a fact
  `replies` already holds. The sync would have to keep it in step; a human retag would
  have to keep it in step; the next forgotten column would show as a plausible zero. This
  is the failure mode the 18 August review exists to stop. `campaign_totals.replied` stays
  Instantly’s own counter. The homepage stops pretending it is ours.
- **D — one SQL definition over `replies`, both tiles and the list read it, counts in
  Postgres, labels stay on the row.** Accepted.

**SHIPPED 20 August 2026**, commit `81bfc96` plus the follow-up below. Built as decided —
one SQL definition (`response_people` / `response_counts`, migration `20260820120000`), the
homepage and `/replies` both reading it, no fourth ledger, no stored count. Verified by
following each tile's own href and counting the rows behind it across 32 scopes.

Three things changed after the decision was written, all on the same day, all recorded here
because a decision revised in a chat is a decision that gets re-argued in three weeks:

1. **The em-dash guard was wrong and the verification caught it.** The tile blanked when
   `new_leads_contacted` was 0. On 4 Aug one person answered and no first touches went out
   — the sends were follow-ups — and a tile whose list held a real human read `—`. A count
   needs no denominator. Fixed.
2. **Both vendors, not Instantly-only.** See T3 below.
3. **Five labelling buttons became three.** See T3 below. This reverses the 20 August
   "do not collapse the buttons to two" decision in this entry — it is now three, not two,
   and it was Tanay's call after reading all 135 replies himself.

**Original decision text follows.** Steps 2 and 3 of the homepage revamp. Step 1 is not
redone. Step 4 (copy Instantly’s interest guess onto new mail as `classified_by = 'ai'`)
is not this pass. Step 5 (by-campaign table) is not this pass.

### What the tiles are

Bottom row becomes five tiles (`g5` already exists in CSS):

| # | Tile | In the pile | Out of the pile |
|---|---|---|---|
| 1 | **Total responses** | Distinct Instantly people with any of `interested` / `not_interested` / `not_now` / `referral` | robots (`auto_reply`), `unclassified`, lemlist |
| 2 | **Interested** | Distinct Instantly people with `interested` anywhere. One interested row wins even if another row is `not_interested`. Count, and **% of people reached** (`new_leads_contacted`), not % of Total. | everything else |
| 3 | Bounce rate | as today | — |
| 4 | Calls logged | as today | — |
| 5 | Meetings booked | as today | — |

Unclassified is homework, not a KPI. It belongs as a note under Total (“N need a label”)
and as the default list when that note is clicked. Labelling is what moves a person into
Total or Interested. Until then they must not inflate either number.

If a scope has no Instantly people-reached, both tiles stay an em dash. A 0 would say
“nobody wrote back.” lemlist still lists on `/replies` behind an “All inbound” chip. Mixing
lemlist into the numerator against an Instantly-only people-reached denominator is the
same structural fault T1 describes.

T1’s recommended campaigns “Reply %” (C′) still counts unclassified people as replies.
That is deliberate and **not the same numerator as Total here**. Campaigns Reply % is
“someone wrote back, robots out.” Homepage Total is “someone wrote back *and a human
named what it was*.” Do not “align” them by putting unclassified into Total. Do not
“align” them by taking unclassified out of C′ until T1 is decided on its own terms.

### The ledger — one table, three writes, one read

`replies` is the only notebook these two tiles read. No new table. No stored
`total_responses` column. No nightly rollup.

| What | Where | Who writes it |
|---|---|---|
| The email arrived | `replies` row | Sync, every 30 min, `ingest_replies` |
| What it means | `replies.sentiment` | A human via `classify_reply`, or an `ai` guess on first insert |
| The homepage number | `count(distinct lower(lead_email))` from that table, in Postgres | Nobody stores a copy |

**Write 1 — new mail, automatic.** Instantly `/emails` → `ingest_replies`. New row:
`looksAutomatic` → `auto_reply`, else `unclassified`, both `classified_by = 'ai'`. On
conflict the function updates body/subject/name and **does not touch** `sentiment`,
`classified_by`, or `classified_at`. That split is already in
`20260819120000_replies_keep_the_whole_message.sql`. Keep it.

**Write 2 — a person changes the category.** The five buttons already exist. They call
`classify_reply`, which sets `sentiment` and `classified_by = 'human'`. The sync skips
human rows permanently. Recategorising Interested → Not interested, or to Out of office,
is the same write. Next page load, the tiles move with that person. There is no backfill
job after day one.

**Write 3 — not this pass.** Instantly interest (`i_status` / `ai_interest_value`) copied
onto new unclassified mail as `ai` only, never `human`, and only after dumping a live
`/emails` payload so the field names are measured. That is Step 4. Until then, Instantly’s
guess is ignored and the human buttons are the classification system.

**Read — every Overview load.** `force-dynamic`, `cache: "no-store"` (`lib/db.js`). There
is no snapshot to go stale. The **count** on both tiles is 100% from `replies`. The
Interested **rate** divides that count by people reached from the daily notebook. Mixing
two *rates’ piles* is the agreed formula (people who said yes ÷ people we reached). Mixing
two *counts of “replied”* is the old bug. Do not write the count back into Notebook 1 or 2
to make the rate “pure.”

### How it survives growth

The homepage today selects every reply in the window into JavaScript and uniques it there,
with no `everyRow` paging. PostgREST caps at 1,000. Past that the tile shrinks and nobody
is told.

So:

1. **One SQL definition** — a view or a small RPC — that rolls `replies` to one row per
   Instantly person (`lower(lead_email)`) with `bool_or` on the labels, scoped by
   `received_at` and campaign membership so date and rep filters are real. The per-person
   rollup is what catches two messages from one human, and what lets one `interested` win.
   Query 6 in §11 is the all-time, all-reps version.
2. **Homepage asks for counts.** `/replies` asks for those same people, paged. Both call
   the same helper. If the tile says 12, the list is those 12. The number, the click, and
   the list are one pile.
3. **Do not count in the Next.js process** except as a last resort behind `everyRow`.
   Pulling every body to add unique emails is how this dies at volume.

`campaign_totals.replied` and `daily_metrics.replied` are left alone. They remain vendor
counters for pages that already disclose (or will disclose) that fact. Using them as the
homepage Total would put Instantly’s unique-people number and lemlist’s message number
back on the same tile.

### What the click opens

Pass the homepage window and rep in the URL. Make `app/replies/page.jsx` read them.

| Click | URL | List |
|---|---|---|
| Total responses | `/replies?view=human` plus `range` / `rep` | Instantly people in the Total pile, one row per person, thread on expand |
| Interested | `/replies?tag=interested` plus the same window | The interested slice |
| “N need a label” | `/replies?tag=unclassified` | Homework. The five buttons are how they leave this list. |

Default after a tile click is not “all inbound.” An “All inbound” chip may still show
robots and lemlist so nothing is deleted. Put the same date picker and rep control on
Replies that Overview already has (`windowFrom`, `repList`). Without this, Step 2 looks
right and still feels broken. Do not ship the tiles without the matching list.

Each row still shows its category pill. Each row still has the five buttons. That is the
product: Total and Interested on the homepage, the full category set when you open a
reply, and a way to change it.

Do not relabel Bharat Mudgal’s two unclassified replies. Migration `20260818205745`
explains why. His 28 Jul message is already `interested`, so he is already in Interested.

### What this pass does not do

- Redo Step 1’s opened / bounce layout, unless a real bug (the count-up tween wiping
  `6.3% / 225`) is still live — that is a display bug in `components/tween.jsx`, not a
  ledger.
- Copy Instantly’s interest field (Step 4).
- Fetch lemlist bodies. lemlist is being retired.
- Align the by-campaign table (Step 5).
- Close T1. Campaigns “Reply %” is a different page, a different denominator (`sent`),
  and a different rule on unclassified.
- Invent a `replies_totals` table.

**Verify.** Query 6 in §11. Then click each tile and count the rows. If the list does not
match the tile, it is not done.

---

## 6. T3 · SHIPPED · Three answers, both vendors

Tanay, 20 August 2026, after reading all 135 replies himself. Two changes, one cause.

**The vocabulary is three, not five.** Interested / Not interested / Automatic. `referral`
and `not_now` stay legal in the schema and are used by **no row in the table** (measured
the same day), so nothing was discarded. The two referrals the lemlist rescue turned up —
Jennifer Berthelot-Jelovic passing us to BranchPattern, John Forester naming Jason Kilgo —
he filed as `interested`. `unclassified` survives but is not a button: it is the state of
mail nobody has read yet, which is a fact about us, not an answer from them.

This reverses "do not collapse the labelling buttons" in T2. Recorded rather than quietly
applied, because the reason it was written still stands for the *machine* — the sync must
never guess these — and only the human's palette changed.

**Both vendors, and why the old objection does not apply.** Total responses was
Instantly-only because the Interested tile divided by `new_leads_contacted`, which lemlist
has never written. That is an argument about a **rate**. Total responses is a **count**, and
a count has no denominator to be wrong about. Keeping 22 labelled humans off a headcount to
protect an arithmetic problem the headcount does not have would be deleting a true number
to avoid explaining it — house rule 5, in the other direction.

**So the rate changed its denominator instead.** Interested is now `interested ÷ responded`
— people who said yes over people who answered — one pile on both sides, true whatever mix
of vendors is in scope. The old `÷ new_leads_contacted` could never have survived lemlist
and was going to break the first time somebody widened the tile.

**Measured, 20 August 2026, all time, all reps:**

| | Instantly only | Both vendors |
|---|---:|---:|
| Total responses | 9 | **31** |
| Interested | 3 | **15** |
| Not interested | 6 | **16** |
| Still to read | 0 | **0** |

15 + 16 = 31, and that is not a coincidence to be grateful for — `not_interested` has no
flag of its own anywhere in the stack. It is `responded && !interested` on the tile and in
the `/replies` filter both, so the parts cannot stop summing to the whole.

**What this made visible.** `rep=Tanay` read an em dash before this and now reads **22
responses, 12 interested**. He owns the lemlist groups. His work was not being counted.

**Verify.** Query 6 in §11, with `p_source` null. Then click each tile and count the rows —
18 scopes checked, all matching.

---

## 7. T4 · SHIPPED · Homepage People reached

**Symptom.** The first tile of the funnel said **1,839**. Clicking it opened **2,393**
people. Nobody had noticed, because both numbers are true answers to different questions
and neither page shows the other's.

**Measured, 20 August 2026**, by the §7 method in `NEXT_AGENT.md` — scrape the tile's
number *and its own href*, follow the href, count the rows:

```
tile  "People reached"  1,839    href  /list?metric=contacted&range=all
click                   2,393 people        gap 554, every one of them lemlist
```

| | Instantly | lemlist | both |
|---|---:|---:|---:|
| People with a first contact, all time | 1,839 | 554 | **2,393** |
| `sum(new_leads_contacted)`, all 525 campaign-days | 1,839 | **0** | 1,839 |

**Why it is wrong.** The number came from the daily notebook and the list came from
`people`. lemlist writes one and not the other. Every document in this repo records that as
*"lemlist never reported people reached"* — which is true of `new_leads_contacted` and
false of `people.first_contacted_at`, where lemlist's 554 have been sitting since June,
dated from its own activity stream. The distinction had never been written down, so the
denominator of the whole funnel stayed one vendor short of the responses beside it.

**Options.**

- **A · Move the click to the notebook.** Impossible, and worth stating so nobody retries
  it: `new_leads_contacted` is a count per campaign-day with no names in it. A tile fed by
  it can never open onto the people it counted.
- **B · Move the number to `people`.** The pile that can be listed decides, which is the
  one-pile rule. Taken.
- **C · Leave it, show a vendor split.** Rejected: it explains a broken tile instead of
  fixing it.

**The dating problem inside option B, and Tanay's choice.** Instantly's API never exposes
first-touch. The sync writes `timestamp_last_contact` into `first_contacted_at`, and until
the trigger in `20260806185524` it was overwritten every 30 minutes — so someone first
emailed on 21 July who got a follow-up on 4 August is stored as 4 August. All time is
unharmed. A window is not.

| dating rule | Instantly people misdated | where they land |
|---|---:|---|
| stored date, raw | 1,171 of 1,839 | smeared onto 3–6 Aug, from all of July |
| **`least(stored, earliest surviving send)`** | **423** | ~6 days late, same July fortnight |
| refuse a window, lifetime only | 0 | throws away lemlist's exact dates too |

Chosen 20 August: **`least`**. Not exact and not claimed to be — Instantly's activity feed
also keeps only a lead's most recent send, which is why 423 survive; they sit on 27–28 July
against a notebook that says 20–21 July, and the two errors cancel to the row. lemlist and
post-6-Aug Instantly are exact and do not move.

**Decision — SHIPPED 20 August 2026**, migration `20260820200000`. `reached_people` /
`reached_counts`, the same four arguments as the response pair, `security invoker` for the
same reason. The Overview tile, the per-group *First touches* column and
`/list?metric=contacted` all call it. One row per **person**, not per (person, campaign) —
the grain the Meetings tile still gets wrong.

**What it does to the numbers**

| | before | after |
|---|---:|---:|
| People reached, all time | 1,839 | **2,393** |
| Chicago Retrofit | 937 | 937 |
| **QEA Resellers** | **0** | **472** |
| **LBER — Boston** | **0** | **82** |
| Roof Campaign — Mark Dolan | 498 | 498 |
| Canada — Justin's list | 404 | 404 |
| 4 Aug, single day | 0 | 0 |

The two groups that moved are the two that ran on lemlist, and both of them read **zero**.
937 + 498 + 404 = 1,839 exactly: the old tile was not undercounting lemlist, it could not
see it at all. Mark Vasu owns both — the same rep whose responses were invisible until
`bbfdb96`, now the rep whose 554 emailed people were invisible too.

**Verify.** Query 7 in §11. Then the scrape: 19 window/rep scopes and 12 group cells
checked on 20 August, tile equals click in every one, and the group cells sum to the tile
exactly (2,393 all time, 2,028 last 30 days, 366 on 28 July). Reps sum too:
1,491 + 498 + 404 = 2,393.

**What this does not fix.** `/leads` still says **SENT 1,536 · "Confirmed in
Instantly/lemlist"**. That is the human `status` column typed on the source spreadsheets,
not vendor confirmation — 49 of those rows have no send in either tool and 906 people with
a real send are not marked `sent`. Same family, one page over. Q7 in §9.

---

## 8. T5 · SHIPPED · Homepage People who opened

Was **Q4**. Closed the same day it was ranked, because T4 had already built the pile it
needed.

**Symptom.** Tile read `6.3% / 225`. Its own click opened **351 people**.

**Measured, 20 August 2026, all time.** Three different things were being called "opened":

| | | |
|---|---:|---|
| `unique_opened`, notebook, Instantly | **225** | unique per campaign-**day** — one person opening Monday and Tuesday is two |
| people with `opened_count > 0`, Instantly | **123** | Instantly's two records disagree with each other by 102 |
| people with `opened_count > 0`, lemlist | **228** | lemlist writes no `unique_opened` at all, so none of them were visible |

**Why it is wrong.** The numerator counted events from one vendor while the click counted
humans from two — F2 again. And the denominator was *3,574 tracked sends*: messages under a
numerator trying to be people, one vendor under two, which is house rule 4 failing on the
very tile built to demonstrate it.

**The denominator, measured:**

| | reached | opened | |
|---|---:|---:|---|
| Instantly, tracking on | 937 | 123 | 13.1% |
| Instantly, tracking off | 902 | 0 | **unobservable, not zero** |
| lemlist | 554 | 228 | 41.2% |

Those 902 have no pixel in their mail. They did not decline to open it; nothing was
watching. Padding the bottom of the fraction with them is what made 23.5% read as 6.3%.

**Decision — SHIPPED 20 August 2026**, migration `20260820210000`. Opens are not a pile of
their own: they are a property of a person we reached. `reached_people` grew one column,
`can_open`, and the callers filter on `opened_count` — the same move `PILES` makes over
`response_people`. `reached_counts` returns `opened` and `trackable` alongside `people`, so
the tile, the per-group column and the drill-down are three `count(*) filter`s over one set
of rows.

```
People who opened   23.5% / 351     351 of 1,491 who could register one
                                    902 reached with no pixel
```

**What it cost, stated on the tile and on the list.** The window now selects on the date we
reached the person, not the date they opened. Neither tool dates an open per person —
`opened_count` is lifetime state — and the notebook's per-campaign-day figure is not a
headcount, so the two cannot both be had. The tile is renamed **People who opened**:
"Emails opened" was honest for a number counting events and a lie for one counting humans.

**Q1 is closed for this column too.** A group or a rep whose campaigns cannot register an
open now renders `—` rather than `0`. `rep=Justin` — 404 people, 11 campaigns, tracking off
throughout — reads *"No campaign here can register an open"* instead of `0% / 0`. The
per-group `Opened` column does the same. `/campaigns` still shows `0` and is still Q1.

**Clicked moved with it** for consistency, one line: 1 person, both tools, same definition.
**Bounce deliberately did not.** Its tile is assembled from the per-mailbox daily table with
a partial-day guard and an unplaceable-mailbox total, and it agrees with its own click
today; rebuilding working provenance to make an unrelated point is not a fix.

**Verify.** Query 8 in §11, then the scrape: 10 window/rep scopes and 4 group cells, tile
equals click in every one that has a click, and every scope that has none says why on its
face — 8 Aug 12 is 323 people reached, all Roof Campaign, tracking off, and reads `—`.

---

## 9. Reported, not yet written up

Raised, real, not yet measured or decided. Each becomes a `T<n>` entry when it is worked.

- **Q1 · `/campaigns` shows `0` opened where opens are unmeasurable.** Canada reads 0 opens
  on 1,504 emails; all 11 of its campaigns have tracking off. This is the F9 denominator
  problem from `TRUST.md` in its other half — the tile was fixed in `8aafd4f`, the
  per-group column was not. A campaign with tracking off must render `—`, not `0`.
  **Half closed 20 Aug 2026 by T5**: the Overview's per-group column and its rep-scoped
  tile now render `—` and say why. `/campaigns` still prints `0`, and that page reads
  `v_campaign_summary`, so it is a different fix.
- **Q2 · `campaign_totals.reached` is never written and is `COALESCE`d to 0.** A landmine
  for the next person who reaches for a denominator, which is exactly how B got proposed.
  Either populate it or drop the column; leaving a plausible zero in place is the worst of
  the three.
- **Q3 · `contacted` is mixed units.** Instantly writes people (`new_leads_contacted`),
  lemlist writes messages (it equals `sent`). Never displayed today, so no user-visible
  effect — but `v_campaign_summary` computes `bounce_pct_of_contacted` from it.
- **Q4 · CLOSED 20 Aug 2026 — became T5, §8.** ~~`/list?metric=opened` says 351 against the
  tile's 225.~~ Both are 351 now, and the rate divides people by people.
- **Q5 · CLOSED 20 Aug 2026.** ~~26 lemlist replies unlabelled~~ (22 distinct people; 19 rows / 17 people in QEA
  Resellers, 7 rows / 5 people in LBER). One of them is Mark Attard's *"I would be open to
  meeting, availability Thursday"* — a meeting sitting outside every metric on the site.
  The bodies can only be pulled via `get_inbox_conversation`; the `/activities` feed the
  sync uses carries `messagePreview` only. Not an engineering task, and the highest-value
  item on this page.
- **Q7 · `/leads` "SENT 1,536 · Confirmed in Instantly/lemlist" is not vendor
  confirmation.** It is the human `status` column typed on the source spreadsheets. The
  tools say **2,393** (T4). Measured 20 Aug: 49 rows marked `sent` have no send in either
  tool, and 906 people with a real send are not marked `sent`. The three status tiles also
  do not sum to Total people — 1,536 + 420 + 14 + **810 with no status at all** = 2,780 —
  which is honest but reads as arithmetic that failed. Same family as T4, one page over.
- **Q6 · `unclassified` carries two meanings.** "Read it, genuinely cannot tell" (Bharat's
  two, per `20260818205745`) and "never read, the body was a 60-char preview" (all 26
  lemlist). Both correctly count as replies under C′, so this blocks nothing today — but
  any future rule that keys on `unclassified` will conflate a judgment with an absence.

---

## 10. House rules for anything that lands here

Earned from the entries above, not asserted.

1. **Measure both vendors before proposing a formula.** Every rejected option in T1 died
   on a column one vendor never writes.
2. **Check units, not just presence.** A populated column on both sides is not the same
   column on both sides. `replied`, `contacted` and `delivered` have all failed this.
3. **A blank is better than a zero, and a labelled number is better than a blank.** B was
   rejected for choosing the blank when a correct number was available.
4. **Fix every call site of the expression, not the one in the ticket.** T1 has three, and
   the sort is the one nobody looks at.
5. **Never delete a rate to avoid explaining it.** If the honest number is small, ship the
   small number with its formula on the face of the tile.
6. **Human labels survive the sync.** `classified_by = 'human'` on replies and
   `assignment_source = 'override'` on grouping are permanently skipped. Any new
   human-entered field follows that pattern.
7. **Do not store a second copy of a count you can `count(*)`.** T2’s Total and
   Interested are live aggregates over `replies`. Writing them into `daily_metrics` or
   `campaign_totals` recreates the three-notebook drift on purpose. A rate may divide
   two notebooks when the piles are named on the tile (interested people ÷ people
   reached). A count may not.

---

## 11. The queries behind this file

Run against `yfnqszwlyoyfhuwfmcyl`. Do not take this file's word for anything.

**Q1 — the three candidate formulas, side by side.**

```sql
select display_name, platform, leads, sent, replied,
       round(100.0*replied/nullif(leads,0),1) as a_replied_over_leads,
       round(100.0*replied/nullif(sent, 0),1) as c_replied_over_sent
from v_group_summary
order by sent desc nulls last;
```

**Q2 — numerator units: vendor counter vs reply rows vs distinct people.**

```sql
select c.source, coalesce(g.display_name,'(none)') as grp,
       coalesce(r.sentiment,'NULL') as sentiment,
       coalesce(r.classified_by,'NULL') as by,
       count(*) as rows, count(distinct lower(r.lead_email)) as people
from replies r
join campaigns c on c.id = r.campaign_id
left join campaign_group_members m on m.campaign_id = c.id
left join campaign_groups g on g.id = m.group_id
group by 1,2,3,4 order by 1,2,3;
```

lemlist's `campaign_totals.replied` equals its count of non-`auto_reply` **rows** exactly
(LBER 7, QEA Resellers 19) while the people counts are 5 and 17. That is the proof of the
unit mismatch.

**Q3 — the recommended formula, C′, with the per-person rollup that catches the overlap.**

```sql
with p as (
  select m.group_id, lower(r.lead_email) as em,
         bool_or(r.sentiment is distinct from 'auto_reply') as human,
         bool_or(r.sentiment = 'interested')                as interested
  from replies r
  join campaigns c on c.id = r.campaign_id and not c.hidden
  join campaign_group_members m on m.campaign_id = c.id
  group by 1,2
)
select s.display_name, s.sent, s.replied as vendor_replied,
       count(*) filter (where p.human)      as people_replied,
       count(*) filter (where p.interested) as people_interested,
       round(100.0*count(*) filter (where p.human)/nullif(s.sent,0),1) as reply_pct
from v_group_summary s
left join p on p.group_id = s.id
group by 1,2,3 order by 2 desc;
```

**Q4 — is `sent` email-only on lemlist?** (It is: LinkedIn lives in its own column, and
`contacted` equals `sent`.)

```sql
select c.name, t.contacted, t.sent, t.linkedin_sent, t.linkedin_accepted
from campaigns c join campaign_totals t on t.campaign_id = c.id
where c.source = 'lemlist' and not c.hidden
order by t.sent desc;
```

**Q5 — can a people-denominator come from `leads` instead?** (It cannot: Roof Campaign is
absent, Canada is all `assigned`.)

```sql
select coalesce(g.display_name,'(none)') as grp, l.status, count(*)
from leads l left join campaign_groups g on g.id = l.group_id
group by 1,2 order by 1,2;
```

**Q6 — T2 homepage Total and Interested, all time, Instantly, distinct people.**
Unclassified and robots are out of both. One `interested` anywhere puts the person in
Interested. `not_now` / `referral` / `not_interested` count in Total only. This is the
definition the tiles and the click must share. It is **not** T1 C′ (that one still
counts unclassified as a reply).

```sql
with p as (
  select lower(r.lead_email) as em,
         bool_or(r.sentiment = 'interested') as interested,
         bool_or(r.sentiment in (
           'interested','not_interested','not_now','referral'
         )) as responded,
         bool_and(r.sentiment = 'unclassified') as only_unclassified,
         bool_and(r.sentiment = 'auto_reply') as only_robot
  from replies r
  join campaigns c on c.id = r.campaign_id and not c.hidden
  where r.source = 'instantly'
    and r.lead_email is not null
  group by 1
)
select
  count(*) filter (where responded)         as total_responses,
  count(*) filter (where interested)        as interested,
  count(*) filter (where only_unclassified) as need_a_label,
  count(*) filter (where only_robot)        as robots_only
from p;
```

**Q7 — T4 people reached, by hand, without the function.** The point of writing it out is
that the tile must not be the only thing that can answer this. Two columns, and the second
is the one lemlist can populate.

```sql
-- the notebook: what the tile used to read. lemlist's half is structurally 0.
select c.source, sum(d.new_leads_contacted) as notebook
from daily_metrics d join campaigns c on c.id = d.campaign_id and not c.hidden
group by 1;

-- the people: what it reads now, dated the way reached_people dates them.
with first_send as (
  select a.source as src, lower(a.email) as em, min(a.occurred_at) as sent_at
  from activities a where a.event_type = 'sent' and a.email is not null
  group by 1,2
)
select p.source, count(distinct lower(p.email)) as people
from people p
join campaigns c on c.id = p.campaign_id and not c.hidden
left join first_send f on f.em = lower(p.email) and f.src = p.source
where p.first_contacted_at is not null
  -- and least(p.first_contacted_at, coalesce(f.sent_at, p.first_contacted_at))
  --     >= '2026-07-22'::timestamp at time zone 'America/New_York'   -- for a window
group by 1;
```

Expect `instantly 1,839 / lemlist 0` from the first and `instantly 1,839 / lemlist 554`
from the second. The 1,839 appearing on both sides is what says the two are the same
population differently dated, rather than two populations that happen to be close.

**Q8 — T5 people who opened, and the three numbers that used to fight.** The last column is
the one the old tile printed.

```sql
select c.source, c.open_tracking,
       count(distinct lower(p.email))                                  as reached,
       count(distinct lower(p.email)) filter (where p.opened_count > 0) as opened_people,
       (select sum(f.unique_opened) from v_daily_facts f
         join campaigns c2 on c2.id = f.campaign_id and c2.source = c.source) as notebook_unique
from people p
join campaigns c on c.id = p.campaign_id and not c.hidden
where p.first_contacted_at is not null
group by 1, 2 order by 1, 2;
```

Expect three rows: Instantly tracking-off `902 reached / 0 opened`, Instantly tracking-on
`937 / 123`, lemlist `554 / 228`, with the notebook column reading 225 against Instantly and
0 against lemlist. 123 + 228 = 351 is the tile; 937 + 554 = 1,491 is its denominator; the
902 belong in neither.
