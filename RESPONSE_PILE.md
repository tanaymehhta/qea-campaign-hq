# Steps 2 + 3 — one pile, three readers

Build log, 20 August 2026. Written as it happens, not after. If this file and the code
disagree, the code is right and this file is stale — say so in the next entry rather than
quietly editing history.

Companion documents:

- `TRUST_OPEN.md` §5 (T2) — the decision. **This is the authority.**
- `HOMEPAGE_REVAMP.pdf` — Cursor's handoff. Followed on content, **not** on execution
  order. §10 of that PDF says to believe `TRUST_OPEN.md` when the two disagree; they
  disagree, and this is that.

---

## 0. What this is trying to be true

One sentence: **the number, the click, and the list are the same pile.**

The homepage says `9`. You click it. The page behind it lists those exact 9 people — same
vendor, same window, same rep, same rule about robots. Today the tile says `3`, the click
opens every inbound message from both tools all-time, and the list is 193 rows. Three
different piles wearing one label.

Everything below is mechanism for that one sentence.

---

## 1. The disagreement with the PDF, and why the order changed

The PDF's Step 2 says: *"File: `app/page.jsx`, the block around lines 85–156 that builds
`responders`. Change the filter to: …"* — keep counting inside the Next.js render, just
with better predicates.

`TRUST_OPEN.md` §5 "How it survives growth" decided the opposite, in writing:

> One SQL definition — a view or a small RPC … Homepage asks for counts. `/replies` asks
> for those same people, paged. Both call the same helper. **Do not count in the Next.js
> process.**

Why the PDF's order is the more dangerous one, concretely:

| Where | What it does today | Cap |
|---|---|---|
| `app/page.jsx:38-44` | selects every reply in the window into JS, uniques on email | **1,000** (no `everyRow`, no `.order()`) |
| `app/replies/page.jsx:36-39` | `.limit(300)` on messages | **300** |
| `app/replies/page.jsx:43` | `.select("sentiment")` for the tab counts | **1,000** |

A JavaScript predicate on the homepage cannot be called by `/replies`. So Step 3 would have
to re-express the same rule against PostgREST — two implementations of one pile, on two
pages, both silently truncating at different sizes. That is F2 from `TRUST.md` rebuilt one
page over, by the plan written to kill F2.

And the ordering hides it: Step 2 lands, the tile reads a believable number, the
shared-definition question never gets asked because the visible symptom is gone.

**So the order here is inverted:** the definition ships before the number does.

| # | Step | Ships |
|---|---|---|
| A | One SQL definition of "a person who responded" | migration, `response_people` + `response_counts` |
| B | Homepage asks it for counts | `app/page.jsx`, `lib/db.js` |
| C | `/replies` asks it for rows, paged | `app/replies/page.jsx` |
| D | Prove the tile and the list are the same pile | queries + clicking |

Step A *deletes* `app/page.jsx:85-156` rather than rewriting it, so this is also the
smaller diff.

---

## 2. Ground truth, measured before writing any code

Run against `yfnqszwlyoyfhuwfmcyl` on 20 Aug 2026, service role (so hidden campaigns are
visible here in a way the app's anon key never sees — see §3).

**Shape of the table.**

| fact | value |
|---|---:|
| `replies` rows, all | 193 |
| Instantly rows | 58 |
| lemlist rows | 135 |
| rows with no `campaign_id` | 0 |
| rows with no `lead_email` | 0 |
| rows with no `received_at` | 0 |
| first / last reply | 1 Jul 2026 / 13 Aug 2026 |
| hidden campaigns | 8 |

Every row has an email, a date and a campaign. That matters: it means the per-person
rollup cannot silently drop anyone, and a date filter cannot either.

**Every Instantly reply, by label.**

| vendor | hidden | sentiment | by | rows | people |
|---|---|---|---|---:|---:|
| instantly | no | auto_reply | ai | 47 | 47 |
| instantly | no | interested | ai | 1 | 1 |
| instantly | no | interested | human | 3 | 2 |
| instantly | no | not_interested | ai | 6 | 6 |
| instantly | no | unclassified | ai | 1 | 1 |
| lemlist | no | auto_reply | — | 51 | 41 |
| lemlist | no | interested | human | 1 | 1 |
| lemlist | no | not_interested | human | 1 | 1 |
| lemlist | no | unclassified | — | 24 | 21 |
| lemlist | **yes** | auto_reply | — | 58 | 32 |

**The four numbers the new tiles must produce** (Instantly, not hidden, all time, all reps
— `TRUST_OPEN.md` §8 Q6):

| | |
|---|---:|
| people who wrote back at all | 56 |
| **Total responses** | **9** |
| **Interested** | **3** |
| need a label | **0** |
| robots only | 47 |

So the tile moves **3 → 9**. The six people it gains are the six `not_interested` — the
ones the old filter dropped for saying no. A refusal is a response; that is the whole
point of splitting Total from Interested.

`need a label` is **0** today. Every Instantly reply has been read. The one remaining
`unclassified` row belongs to a person who is already `interested` elsewhere, so they are
settled — this is Bharat Mudgal, and migration `20260818205745` says why his two rows stay
unclassified. The "N need a label" note will therefore render nothing today. It is built
anyway, because the next sync can create one at any time.

---

## 3. Hidden campaigns: already solved, do not re-solve

Checked before adding a `not c.hidden` join everywhere. RLS already does it:

| table | policy | qual |
|---|---|---|
| `campaigns` | public read | `NOT hidden` |
| `replies` | public read | `NOT is_hidden_campaign(campaign_id)` |
| `campaign_group_members` | public read | `NOT is_hidden_campaign(campaign_id)` |

The app holds the **anon** key (`lib/db.js`), so it has never been able to see a hidden
campaign's replies. All 58 hidden rows are lemlist robots, so nothing was being counted
that shouldn't have been.

Consequence for the function: it is written `security invoker` — the default — so RLS
still applies to it. A `security definer` read here would quietly hand anon the hidden
rows, which is the opposite of what Q6's `not c.hidden` was asking for.

---

*(entries below are appended as each step lands)*
## 4. Step A — the definition · DONE

**File:** `supabase/migrations/20260820120000_one_definition_of_a_response.sql`
**Applied to:** `yfnqszwlyoyfhuwfmcyl` as migration `one_definition_of_a_response`. Additive
only — two new read-only functions, nothing altered, nothing dropped.

Two functions:

`response_people(p_from date, p_to date, p_campaigns uuid[], p_source text)` — one row per
human, keyed `lower(lead_email)`. Returns the labels as flags rather than as a sentiment,
because the caller picks the pile and must not get to pick the rule:

| flag | means |
|---|---|
| `responded` | any of `interested` / `not_interested` / `not_now` / `referral` |
| `interested` | one `interested` row anywhere, even beside a later no |
| `needs_label` | **every** message from this person is `unclassified` |
| `robot_only` | every message is `auto_reply` |

Plus `lead_name`, `company`, `sources[]`, `labels[]`, `msgs`, `first_at`, `last_at`.

`response_counts(same four args)` — the tile numbers, as one row. A deliberately thin
wrapper: it calls `response_people` rather than restating the predicates, so the two can
never disagree.

### Four judgment calls inside it

**Grain is the person, not the message.** A human who writes twice is two rows and one of
them can be an out-of-office. T1 found exactly that person in Canada's list. `bool_or` over
a per-person rollup collapses them; summing labels would count them twice and file them
under both.

**`needs_label` is `bool_and`, not "has an unclassified row".** A person already labelled
elsewhere is settled. This is what stopped the old "unread" note being a ceiling that could
never fall — Bharat Mudgal has an `unclassified` row *and* an `interested` one, so he is
counted as interested and does not appear as homework.

**`security invoker`, and `hidden` appears nowhere in the body.** The habit next door is
`security definer` (that is right for the write functions). Here it would have handed the
anon key 58 rows it has never been allowed to see. Verified after applying: through the
anon key the function returns 115 people for both vendors; the same query as service role
with `not c.hidden` bolted on returns 115. RLS is doing the filtering.

**Window boundaries are New York, where the old code used UTC.** The replies fetch this
replaces bounded `received_at` with `T00:00:00Z`, while its denominator
(`v_daily_facts.metric_date`) is a New York calendar date. A reply at 8pm on the 12th in
New York was landing in the 13th's bucket and being divided by the 12th's sends. Invisible
on "all time", wrong on "today". `p_from`/`p_to` are inclusive dates; NULL is unbounded, so
"all time" asks for nothing rather than for 2020-01-01.

### Verified against the ground truth

`response_counts()` versus `TRUST_OPEN.md` §8 Q6, hand-written and run separately:

| | Q6, by hand | RPC | |
|---|---:|---:|---|
| people | 56 | 56 | ✓ |
| **Total responses** | 9 | **9** | ✓ |
| **Interested** | 3 | **3** | ✓ |
| need a label | 0 | **0** | ✓ |
| robots only | 47 | 47 | ✓ |

Windowing sanity check, because a date filter that silently drops people is the failure
mode here: July alone gives 4 responses, August alone 6, all time 9 — **not 10**. One
person wrote in both months and is counted once across the union. The rollup is deduping.

### Two things measured about PostgREST that the next person needs

Both learned the hard way, both now written into `lib/db.js` so nobody re-learns them:

1. **The `Range` header is ignored on `POST /rpc`.** Asking for `Range: 0-2` on a
   9-row result returns `content-range: 0-8/9` and all nine rows. `limit` / `offset` as
   query params *do* work. This version of `postgrest-js` implements `.range(a, b)` as
   `offset`/`limit` params (checked in `node_modules`), so `.range()` is safe — reaching
   for the header directly is not.
2. **Ordering by a column that is not in `select` fails on a set-returning function**
   (`column record.last_at does not exist`). The default RPC select is every column, so the
   fix is: leave the select alone.

---

## 5. Step B — the homepage asks it · DONE

**Files:** `lib/db.js` (+68 lines), `app/page.jsx` (−72, +38).

`lib/db.js` gains `PILES`, `responseCounts(scope)`, `responsePeople(scope, opts)`. Nothing
else may call the RPC directly — the scope object (`from`, `to`, `campaignIds`, `source`)
is the only knob, and "what responded means" is not in it.

`app/page.jsx`:

- **Deleted** the `replies` fetch from the `Promise.all` (the one with no `everyRow` and no
  `.order()` — the 1,000-row time bomb) and the ~45-line `responders` / `settled` /
  `unread` / `robots` / `refusals` / `funnel` block. This step removes more code than it
  adds, which is the tell that the rule moved rather than got rewritten.
- Rep scope is resolved to campaign ids (`scopedIds`) and handed to Postgres, using the
  same `myGroupIds` / `groupOf` rule `inScope` already applies to every other tile.
- One tile became two. Bottom row `g4` → `g5` (the class already existed).
- `pileHref(view)` carries the tile's own window and rep into the URL, built from the same
  `windowParams` / `repParams` the `/list` drill-downs already use.

### What the tiles say now

Rendered from a live dev server on :3100, all time / all reps:

| tile | before | now |
|---|---|---|
| People who replied | `3` · "58 inbound, less 47 robots and 6 refusals" | — gone — |
| **Total responses** | | **9** · "People, not messages. Robots and out-of-office excluded" |
| **Interested** | | **3 / 0.2%** · "0.2% of 1,839 people reached" |

**3 → 9 is the six refusals coming back.** They were subtracted by the old filter, which
made a tile labelled "people who replied" quietly mean "people who might still buy".
Someone who writes back to say no has replied. They are in Total and nowhere near
Interested — that is what the split is for.

**"N need a label" renders nothing today**, because `needs_label` is 0: every Instantly
reply on file has been read. Built anyway; the next sync can create one at any time.

**No `raw` on the Interested tile.** Its value is JSX (`3` + a `.pair` span), and
`components/tween.jsx` counts `[data-count]` up with `Math.round` and overwrites the whole
cell — passing `raw` would replace "3 / 0.2%" with "3". Same trap Step 1 documented for
opened and bounce.

### Noticed, deliberately not fixed

The bounce tile renders **`2%`**, not `2.0%` — `pct()` rounds to one decimal and JS drops
the trailing zero. It is Step 1's tile, cosmetic, and the instruction is not to touch
Step 1 without a real bug. Logged here so it is a decision and not an oversight.

---

## 6. Step C — the click opens that pile · DONE

**File:** `app/replies/page.jsx`, rewritten. `lib/db.js` gains `tag` / `search` on
`responsePeople`.

The page was one row per **message**, both vendors, all time, `.limit(300)`, with sentiment
tabs. It is now one row per **person**, over the pile the tile counted, in the window and
rep the tile counted, because it calls the same function with the same `scope` object.

### The URL contract

| Click | URL | List |
|---|---|---|
| Total responses | `/replies?view=responded` + `range`/`d` + `rep` | Instantly people in Total |
| Interested | `/replies?view=interested` + the same | The interested slice |
| (tab) | `/replies?view=needs_label` | Homework — every message unread |
| (tab) | `/replies?view=all` | Both vendors, robots included. Nothing is deleted |

`TRUST_OPEN.md` §5 wrote this as two params (`view=human` for one pile, `tag=interested`
for another). It is one param here — `view` — because two params naming one concept is a
thing that can disagree with itself, and this page exists to stop numbers disagreeing.
Old `?tag=` links still work: `tag=unclassified` resolves to `needs_label`, any other tag
falls through to All inbound with the label filter still applied, so an old link narrows
rather than lies.

### The design question the PDF did not notice

`TRUST_OPEN.md` §8 Q4 answers "one row per person or per email?" with *"Person, expand for
the thread."* But `classify_reply` labels **a row** — `<input name="id" value={r.id}>`. One
set of buttons per person would have to pick which message to write to, silently, and a
thread can hold an out-of-office *and* a real answer. Bharat Mudgal's does.

So: person rows, message-level buttons. Open a person and each message in their thread
carries its own five buttons. Verified — his row renders 3 messages and 3 forms, with pills
`interested` + `unclassified`, and he is in Total and in Interested and **not** in the
homework pile, which is the `bool_and` rule doing its job on screen.

### Truncation is stated, not silent

The list caps at 300 people and says so: *"Showing the 300 most recent of N"*. The old page
capped at 300 messages and said nothing. A page that quietly stops is the failure this
change exists to end, so the cap is on the face of it.

### Kept

Five labelling buttons, unchanged. The lemlist "preview only" warning, unchanged. The
`from` field that returns you to your worklist — now carrying the pile, window, rep and
search, verified in the rendered HTML as
`/replies?view=responded&range=all&rep=Mark+Dolan`, which still satisfies the `backTo`
allowlist in `app/conflicts/actions.js`.

---

## 7. Step D — proof · DONE, and it caught a real bug

The test is mechanical and repeatable: load `/`, scrape each tile's number **and its own
href**, follow that href, count `.mrow` rows, compare. No hand-checking, no trusting the
build log.

**32 of 32 scopes match** — all time, 7 / 30 / 90 / today, five single days, and each of
the four reps, alone and crossed with a window.

Two independent sanity checks fell out of it:

- Justin 4 + Mark Dolan 5 = 9 = all reps. The rep scoping partitions cleanly.
- July 4 + August 6 = 10, but all-time is **9**. One person wrote in both months and is
  counted once. The rollup deduplicates across the union, which a sum of per-window counts
  would not.

### The bug it caught: 4 August

First run, two failures:

```
FAIL  d=2026-08-04  Total responses  tile=—  list=1
FAIL  d=2026-08-04  Interested       tile=—  list=1
```

On 4 Aug one person answered and **zero** new leads were contacted — that day's sends were
follow-ups. The tile's em-dash guard was `overall.new_leads_contacted ? … : "—"`, inherited
from when this tile was a rate. Total responses is a **count**, and a count needs no
denominator. The guard was blanking a tile whose list held a real human.

Fixed by testing the right thing: `scopeHasInstantly` — is there an Instantly campaign in
this view at all — which is the case the em dash was actually written for (a lemlist-only
rep, where `0` would say "nobody wrote back" instead of "not measured here"). And the
Interested tile now drops only its **percent** when there is no denominator, keeping the
count. Blanking a whole tile to avoid explaining a missing rate is the one thing
`TRUST_OPEN.md` §7 rule 5 says never to do.

Re-run: 32/32, and `rep=Tanay` — who owns no Instantly campaign — still correctly reads an
em dash rather than a 0.

**This is the argument for Step D existing.** Steps A, B and C were all individually
correct and the tile still lied on one day out of five tested. Matching a hand-written
query proves the number; only following the tile's own href proves the click.

### Routes still healthy

`/`, `/campaigns`, `/replies`, `/conflicts`, `/meetings`, `/calls`, `/health`,
`/list?metric=replied`, `/pipeline` — all 200, no errors in the dev log.

---

## 8. A second reviewer's read, and what came of it

A review came in partway through Step C, from a snapshot of this file taken before
`app/replies/page.jsx` was rewritten. Its headline — *"the click still opens a different
pile, `responsePeople()` is unused"* — was true of that snapshot and is not true now;
§6 and §7 above are the answer.

Two of its smaller points were right and are now fixed:

- **A failed RPC read as `0`.** `responseCounts` returned zeros on error, which puts
  "nobody wrote back" on a tile whose real answer is "the question never reached the
  database" — the `COALESCE(…, 0)` sentence the whole 18 August review exists to end. It
  now returns nulls, and `num(null)` is an em dash, so a failure reaches the screen as one.
- **`2%` vs `2.0%`** on bounce — agreed, cosmetic, Step 1's tile, deliberately left.

One point is **acknowledged and deferred**: when "N need a label" is not zero, the Total
tile mentions homework but only links to `view=responded`. The note cannot carry its own
link, because `Tile` renders the whole card as an `<a>` and a nested anchor is invalid
HTML. Today `needs_label` is 0 so nothing is hidden, and the pile is one tab away on the
page the tile already opens. Fixing it properly means letting `Tile` take a second action,
which is a `components/ui.jsx` change and not this pass.

---

## 9. State of the tree

| File | Change |
|---|---|
| `supabase/migrations/20260820120000_one_definition_of_a_response.sql` | new · applied live |
| `lib/db.js` | `PILES`, `responseCounts`, `responsePeople` |
| `app/page.jsx` | JS counting block deleted; two tiles; `g4` → `g5`; `pileHref` |
| `app/replies/page.jsx` | rewritten: person rows over the same pile |
| `RESPONSE_PILE.md` | this file |

Also dirty from **Step 1, which is not this work** and was already in the tree:
`app/globals.css` (`.pair`), `TRUST.md`, and the Step 1 hunks inside `app/page.jsx`.

**On committing.** The PDF §10 says to leave Step 1 for Tanay and commit Steps 2+3 as one.
That cannot be done as written — Step 1's hunks are in `app/page.jsx`, so any commit of
this work carries them unless someone stages by hunk. The honest options are to commit
Step 1 first on its own, or to accept one commit covering both. Nothing has been committed;
this is Tanay's call.

### Not done, on purpose

- **Step 4** — copying Instantly's interest guess onto new mail as `classified_by = 'ai'`.
  Needs a live `/emails` payload dumped first so the field names are measured, not guessed.
- **Step 5** — the by-campaign table under the tiles still shows the old piles.
- **T1** — `/campaigns` "Reply %" is a different page, denominator, and rule on
  unclassified. Still `OPEN`.
- `TRUST_OPEN.md` §5 has not been moved from `DECIDED` to `SHIPPED`. That happens on
  commit, with the hash, per its own convention.
