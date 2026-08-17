# Inbound UI rebuild — execution plan

**Route:** `/inbound` · **Written:** 17 August 2026 · **Status:** shipped `b14d6fa`

This is a work order for whoever picks this up next. Read it end to end before touching a
file. `INBOUND.md` describes what is on the page today and why; this describes what is wrong
with it and what replaces it. Where the two disagree, this file is newer — and note that
`INBOUND.md` is itself stale on every number it quotes (see §9).

---

## 1. Who this page is for

A salesperson. They arrive with one question — **who do I contact right now, and what do I
say** — and every pixel that does not serve it is a tax. The current page fails them in a
specific way: it renders the pipeline's internal state (`needs_review`, `quarantined_off_domain`,
`c suite`, `not_icp`) and leaves the rep to guess what it means and whether anything is broken.

The recurring complaint, in the user's words: *"It leaves a bunch of questions in my mind. Why
are there no people? Did the system break?"* That is a page failing to answer a question the
database can answer.

---

## 2. What is actually wrong — measured, not assumed

Every number below was queried against the live database on 17 August 2026 with the anon key
in `lib/db.js`. Re-run them before you trust them; the data grows.

### 2.1 The credit outage is the root cause of most of it

**56 of 95 companies have an `account_type_reason` that *begins* with this string:**

```
Error code: 402 - {'error': {'message': 'Insufficient credits. Add more using
https://openrouter.ai/settings/credits' ...
```

Not "contains somewhere" — begins with. There is no classification prose for any of those 56.
OpenRouter ran out of credits mid-run and the classifier node (`research_overview` in stage 1)
returned 402. **Only 39 companies were ever actually classified.**

What follows from that:

- The 49 companies the queue files under **"Not researched yet"** are not undecided. Research
  ran and **crashed** on them. The lane label is false for all 49.
- Three were filed **Not relevant** off the failed call and are false negatives sitting in the
  ruled-out lane right now: **ScanSource Chile**, **Self Employed**, **BAMO**.
- `needs_human_review = true` on 67 companies and `review_reasons` names the failed nodes.
  Nothing in the UI reads that column.
- The raw 402 JSON is rendered to the rep, bulleted, under the heading "Why it decided that".

> **The credits are still not topped up as of 17 August 2026.** Plan for that. Every restart
> button in this plan queues a request that cannot run today, and the UI must say so rather
> than imply a fix is one click away. When credits return, one CLI pass over those 56
> companies will do more for this page than any change in this document.

### 2.2 A run can report success while failing inside

Canaccord Genuity's stage 1, node by node:

```
0 load_company        [ok]
1 research_overview   [error]  402 insufficient credits
2 find_locations      [error]  402 insufficient credits
3 plan_research       [ok]
...
6 research_pressure   [error]  402 insufficient credits
```

The **run's own `status` column says `ok`**. This is why nothing surfaced. `lib/pipeline.js`
already solved this — `nodeErrors()` reads both `error` and `output_summary.errors`, and
`nodeState()` returns `degraded` for the ok-run-failed-node case. Reuse them. Do not re-derive.

### 2.3 "Nobody found" has three different causes

46 of 85 visited companies have zero people, and they are not the same problem:

| Cause | Count | What the rep should read |
|---|---|---|
| Stage 2 never ran — stage 1 ruled the company out | 14 | Skipped on purpose |
| Stage 2 ran, Apollo had no organisation record | ~30 | "Apollo has no record of this company" |
| Stage 2 ran, Apollo found people and dropped them all | few | "Found people, none matched the buyer profile" |

Worked example — **Goodman Gold Challenge**, the screenshot that started this. Nothing broke:

| Stage | Status | Cost | Apollo credits |
|---|---|---|---|
| 1 Research | needs_review | $0.628 | 0 |
| 2 Find people | ok | $0.105 | 0 |
| 3 Write | ok | $0.00 | 0 |

Its `apollo_sweep` node returned `org_total: 0, apollo_orgs: []` and `web_supplement` found 0.
Apollo simply has no organisation for `laurentian.ca`. Not a crash, not credits.

### 2.4 The rest of the numbers

| | |
|---|---|
| Companies | **95** (85 with a visit) |
| People rows | 2,446 — **2,380 named** |
| — with an email address | 149 |
| — verified | 112 |
| — Ready to email | **62** |
| Drafts written | **639** |
| — passing the send gate | **5** |
| — ever pushed | **0** |
| Companies classified | 39 |
| Companies where classification failed | **56** |
| RB2B webhooks received | 206 — **37 failed to parse** |
| Total spent | **$29.99** — stage 1 $23.67, stage 2 $4.86, stage 3 $0.00 |
| Apollo credits consumed | 2,061 |

Two of those deserve a second look. **0 of 639 drafts have ever been pushed** and
`push_instantly` is a permanent no-op, which is why the timeline has no "Sent" dot. And **37 of
206 webhooks failed to parse** — inbound traffic that never became a company and appears
nowhere in this dashboard.

### 2.5 Fields that are empty far more often than the page implies

| Field | Empty | Consequence |
|---|---|---|
| `role_hypothesis` ("Why them") | **908 of 1000** sampled | Renders a dash on 91% of people |
| `outreach_status` | `not_started` on **all 2,446** | The row can only ever say one thing |
| `vertical` | `unknown` on 64 of 85 | Renders the word "unknown" as if it were data |
| `email_source` | NULL on 859 of 1000 sampled | — |

### 2.6 Where the runner lives

`/Users/tanaymehta/Desktop/QEA Tech/Inbound/agent/scripts/run_pipeline.py`, a Python CLI on
Tanay's laptop. **There is no scheduler** — no cron, no launchd, no HTTP trigger. The only
crontab entry on the machine is an unrelated ERP backup. The Vercel webhook
(`Inbound/webhook-vercel`) writes RB2B rows to Supabase and never starts a run.

The CLI already supports per-stage replay:

```
python scripts/run_pipeline.py --name durst --from 2 --to 2
python scripts/run_batch.py --all-new
```

So the capability exists and cannot be reached from the browser. This is the whole reason §B
below is a queue rather than a trigger.

---

## 3. What the page is being changed into

Two ideas govern every item:

1. **Never show a state without its reason and its remedy.** "Nobody found here yet" becomes
   "searched on this date, this is what happened, here is the button".
2. **Speak English.** No enum values, no snake_case, no "quarantined", no raw API errors, no
   em dashes strung into a paragraph.

---

## 4. File map

| Path | Lines | What changes |
|---|---|---|
| `app/inbound/page.jsx` | 277 | Header paragraph, stat cards, two lanes, status chips, industry filter |
| `app/inbound/company/[id]/page.jsx` | 221 | Timeline, cost, account box, link row, empty-people copy |
| `app/inbound/person/[id]/page.jsx` | 243 | Link row, ready toggle, draft box, field wording, dropped rows |
| `app/inbound/controls.jsx` | 91 | `ReadyToggle` becomes a state-labelled toggle; new `Restart` |
| `app/inbound/actions.js` | 85 | New `requestRerun` server action |
| `app/inbound/research.jsx` | 200 | Heading rename |
| `app/inbound/inbound.css` | — | Timeline, chips, cost popover |
| `lib/inbound/queue.js` | 473 | Load runs + node events; lane and chip derivation; stat counts |
| `lib/inbound/words.js` | 144 | Email-source and seniority translation; API-error detection |
| `lib/pipeline.js` | — | **Read only.** Reuse `STAGES`, `latestByStage`, `nodeErrors`, `nodeState` |
| `components/ui.jsx` | — | **Read only.** Reuse `Tile` for the stat cards |
| `scripts/test-routing.mjs` | — | Extend with the new pure functions |
| `INBOUND.md` | 421 | Rewrite the stale numbers |

**Reuse before writing.** `Tile` in `components/ui.jsx:78` is already the exact card in the
Overview screenshot — label, big number, note, "see who →". `lib/pipeline.js` already reads
`inbound_graph_runs` and `inbound_graph_node_events` and already knows that an `ok` run can
contain a failed node. Neither needs a second implementation.

---

## 5. The changes

### A — Company page: the timeline bar

**A1.** Four dots on a horizontal line at the top of every company page:

```
Visited ———— Researched ———— People found ———— Emails written
10 Aug          10 Aug            10 Aug             10 Aug
```

Sources: `inbound_visits.seen_at` (earliest) or `inbound_companies.first_seen_at`; then the
latest stage 1 / 2 / 3 run from `inbound_graph_runs`.

*Four, not three or five.* Three loses the arrival date, which is the rep's freshness signal.
Five would add "Sent", and **0 of 639 drafts have ever been pushed** — a dot that can never go
green is dead weight. Add it the day sending is wired.

**A2. Two colours only.**

- **Green** — the stage ran and nothing inside it failed.
- **Red** — anything else: never ran, hard-failed, or ran with a failed node inside.
- **Grey outline** — not reached yet.

No amber, no fourth state. A stage that half-worked is a stage a rep cannot rely on, so it
reads red.

**A3.** A run whose `status` is `ok` but which contains a failed node is **red**. Use
`nodeState()` from `lib/pipeline.js`; do not read `run.status` alone. Canaccord is the
regression case — its stage 1 is `ok` with three 402 nodes and must render red.

**A4.** Hovering a red dot gives the plain reason, translated:

> Ran 10 Aug 21:52 — 3 steps failed: we were out of OpenRouter credits.

Mapping from the raw text, done once in `words.js`:

| Contains | Say |
|---|---|
| `Insufficient credits` + `openrouter` | We were out of OpenRouter credits |
| `Insufficient credits` + apollo | We were out of Apollo credits |
| `rate limit` / `429` | The provider rate-limited us |
| `timeout` | The step timed out |
| anything else | The step failed — see details |

The raw error goes inside a native `<details>` underneath. Never delete it; never lead with it.

**A5.** **Every red dot carries a restart button, whatever the reason it failed.** No
conditional logic about which failures are retryable.

**A6.** Where a company has been re-run, the dot says **"attempt 2 of 2"**. Canaccord has five
runs and two stage 1s. Use `latestByStage()` for what to show and count the rest.

> Watch for out-of-order history: Canaccord's stage 3 ran at 19:58 and its stage 2 at 21:52 the
> same day. Order the dots by stage number, not by timestamp.

### B — Restart (blocked on backend)

**B1.** Restart writes a request — company id plus stage number — and the dot then reads
**"Requested — waiting for the next run"**.

**B2.** It cannot start anything, and the copy must not imply otherwise. See §2.6. Until a
runner listens, the honest state is *requested*, not *running*.

**B3.** Today, additionally: **the credits are still out**, so a queued stage 1 re-run would
fail the same way. Where the failure reason is the 402 and credits are still out, the tooltip
should say so plainly rather than offering false hope.

**B4. Backend work required.** Two pieces, neither in this repo:

1. `inbound_request_rerun(p_company uuid, p_stage int)` — a `security definer` function
   following the same shape as `inbound_set_person_ready`, writing to a small
   `inbound_rerun_requests` table (`company_id`, `stage_no`, `requested_at`, `status`).
   The anon key must be able to execute it and still not UPDATE any inbound table.
2. `run_pipeline.py` reads that table and honours a stage number, the way it already honours
   `--from N --to N`, and marks each request done.

Until (1) exists, build the button disabled with a tooltip naming what is missing. Do not
fake it.

**B5.** An existing half-measure worth knowing: `inbound_set_company_relevant(relevant=true)`
already writes `research_status = 'new'`, and `run_batch.py --all-new` picks that up. That is a
whole-company re-run mislabelled as a relevance toggle. Do not extend it into the restart
button — a rep pressing "restart find-people" must not silently re-run and re-bill stage 1
at $0.63.

### C — Company page: the account box

**C1.** Label the cost **Cost**, value **$0.73**. Click or hover opens a breakdown:

| | |
|---|---|
| Research the company | $0.63 · 5 AI calls, 98 searches |
| Find the people | $0.11 · 21 searches, 0 Apollo credits |
| Write the emails | $0.00 |
| **Total** | **$0.73** |

**No per-name row.** It was considered and dropped: most of the cost is stage 1, which is fixed
regardless of how many people turn up, so a per-person figure misleads.

**C2.** Move **Move to not relevant** out of the account box and up into the link row (§F). It
currently sits underneath a value inside a grid cell, which reads as part of the data.

**C3.** Never bullet a raw API error under "Why it decided that". When
`account_type_reason` starts with a 402 (56 companies do), suppress the bullets entirely and
render one line plus the restart button:

> **Research failed.** We were out of OpenRouter credits when this company was classified, so
> nothing was decided about them.

Detection belongs in `words.js` as a single predicate, because the queue cards need it too.

**C4.** Drop the **Vertical** row when it reads `unknown` — 64 of 85 do.

**C5.** Drop `via state` from **Visited from**. It is a debugging breadcrumb; the tooltip
already carries it.

**C6.** Replace the **Research: needs review** row with the status chip from D2.

**C7.** The empty People-found panel says what happened, per §2.3:

> **No contacts found.** Searched 7 Aug — Apollo has no record of laurentian.ca, and a web
> search found nobody either.

Read `apollo_sweep.output_summary.org_total` and `web_supplement.output_summary.found` from
`inbound_graph_node_events` for the stage 2 run. Where stage 2 never ran, say that instead.

**C8.** A not-relevant company shows **what kind of company it is** — the first sentence of
`account_type_reason`, which already says it plainly:

> Raad is an aerial-intelligence/drone-services platform selling facade & roof inspections,
> thermal capture, and 3D mapping…

`bullets()` in `words.js` already splits this. Only works for the 39 clean ones; the other 56
get C3 instead, which is the correct answer for them.

### D — Queue page: lanes

**D1.** Two lanes: **Relevant** and **Not relevant**. Delete the "Not researched yet" lane and
the `undecided` branch of `verdict()` in `lib/inbound/words.js`.

**D2.** A status chip on every card carries what the lane used to:

- **Researched** — a clean classification (39)
- **Research failed** — the 402 cases (56)
- **Not researched** — genuinely never run (0 today; keep the state, it will return)

**D3.** Research-failed cards get a restart button.

**D4.** Fix the three false negatives — ScanSource Chile, Self Employed, BAMO — currently
ruled out on a crashed LLM call. They belong under Relevant with a Research-failed chip, not
under Not relevant. This is a change to `verdict()`: **a `not_icp` verdict whose reason is an
API error is not a verdict.**

**D5.** Which lane a company sits in is derived in one place and read everywhere — `verdict()`
today. Keep that property. The queue, the card, the company page and the chip must not each
decide for themselves.

### E — Queue page: header and cards

**E1.** Delete the intro paragraph. One sentence replaces it:

> Every company that visited the site, in the queue of the rep who covers them.

**E2.** Two rows of stat cards, built with `Tile` from `components/ui.jsx:78`. Each is a link
that filters the list below.

**Row 1 — what a rep works with**

| Companies | People found | Ready to email | Emails drafted | New this week | Nobody found |
|---|---|---|---|---|---|
| 95 | 2,380 | 62 | 639 | — | 46 |

**Row 2 — whether the machine is healthy**

| Research failed | Visits dropped | Verified emails | Passing the send gate | Spent | Apollo credits |
|---|---|---|---|---|---|
| 56 | 37 of 206 | 112 | 5 | $29.99 | 2,061 |

Every number is computed, never written down. "Visits dropped" is
`inbound_webhook_events.parse_status = 'failed'` and is new to this dashboard — it is inbound
traffic lost before it can reach any page.

**E3.** Company-type filter chips from `industry` (28 distinct values across 83 companies).
Note the limitation honestly: `industry` gets you to "Information Technology" and
"Real Estate", not to "drone company" or "VC firm". The finer answer exists only inside
`account_type_reason` prose. Ask the backend for a short `what_they_do` field — three or four
words the classifier already knows — and swap the chips onto it later.

### F — Links and buttons

**F1.** Remove every arrow from the link rows. `← Queue`, `Website →`, `LinkedIn →` become
plain links: **Queue · Website · LinkedIn**. An arrow implies a next page; these are
sideways moves.

**F2.** Add **Move to not relevant** to that row, on both the company and the person page.
That row is where actions on the whole record belong.

### G — Person page

**G1.** The ready control becomes a toggle whose **label is its state**, not an instruction:

- Default: red **Not ready to email**
- Click: the word "not" drops away — green **Ready to email**
- Click again: back to red

One control, two labels, no separate status line above it. The existing three-state override
(`manual_sendable` null / true / false) stays underneath; keep the small "Undo" that hands the
row back to the classifier.

**G2.** The draft box header is **Draft**. Never "Draft · blocked" — nothing is blocked, the
draft is right there and can be copied. Under it, **one** plain line naming the top reason:

> Not ready to send — the address is a personal Gmail, not a company one.

The remaining `validator_reasons` go behind a "why" toggle. They are written for a pipeline
operator (*"account unassigned — drafted as Mark Vasu, set assigned_to before sending"*) and
must never be the first thing a rep reads. Copy stays visible in every state. No em dashes
strung into a paragraph.

**G3.** Email source in plain words. The full set is six values:

| Database | Page |
|---|---|
| `apollo` | From Apollo |
| `stage1` | From RB2B, when they visited |
| `web_public` | Found on their website |
| `quarantined_off_domain` | Guessed — personal address, not a company one |
| `quarantined_name_mismatch` | Guessed — the name doesn't match the address |
| `none` / NULL | No address found |

Nobody outside the pipeline knows what "quarantined" means.

**G4.** Capitalise `seniority_band` and `role_bucket`. Today `.replace(/_/g, " ")` yields
"c suite" and "consultant leadership". Wanted: **C-suite**, **Consultant leadership**. Handle
the acronym cases (`c_suite`, `svp`, `evp`, `vp`, `ic`) in the same table as the existing
`ACRONYMS` list in `words.js`.

**G5.** The LinkedIn cell reads **LinkedIn profile**, not the literal string "profile".

**G6.** Drop **Why them** when `role_hypothesis` is null — 91% of the time. A dash reads as a
missing value; the field is genuinely not collected at person level for most people.

**G7.** Drop **Outreach** entirely. `outreach_status` is `not_started` on all 2,446 rows.

**G8.** Drop `via state` from **Territory**.

**G9.** Rename the research block heading from `Research — {company}` to **About the
company**. It is company research — buildings, compliance hits, intent signals, all keyed on
`company_id` — and it is byte-identical for every person at that company. Calling it
"Research" on a person's page reads as research about that person.

### H — Documentation

**H1.** Rewrite the stale numbers in `INBOUND.md`. It documents 43 companies, 387 people and
355 drafts; it is 95, 2,380 and 639. Its "What the data says" and "What the pipeline needs to
do next" sections both need the 402 finding added — it is the single largest fact about this
dataset and predates none of the sections currently in that file.

---

## 6. Build order

1. **A** — the timeline. It is the instrument that makes everything else visible, and it is
   pure read: no backend dependency.
2. **C** — the company page around it. Cost, the account box, the honest empty state.
3. **D + E** — lanes, chips and the queue header. These depend on the error predicate written
   in C3.
4. **F + G** — wording and links. Independent of everything; safe to parallelise.
5. **B** — restart. Last, because it is blocked on a backend RPC that does not exist.

Do not start with D. Relabelling 56 broken companies into a prettier lane without the timeline
makes the page tidier and no more truthful.

---

## 7. Verification

`scripts/test-routing.mjs` is the existing suite — no framework, every case a row that exists
in the database today. Extend it, do not replace it:

```
node scripts/test-routing.mjs
```

New cases to add, all against pure functions:

- **The error predicate** — Canaccord's `account_type_reason` is an API error; Raad's is a real
  classification; an empty reason is neither.
- **Dot colour** — a run with `status: ok` and a node carrying `output_summary.errors` is red,
  not green. A clean run is green. A stage with no run is grey.
- **`verdict()` after D4** — a `not_icp` whose reason is a 402 is *not* ruled out.
- **The reason translation** — a 402 string becomes "We were out of OpenRouter credits"; an
  unrecognised error falls through to the generic line rather than to `undefined`.
- **Email-source and seniority translation** — all six sources, and `c_suite` → `C-suite`.

Then check by hand, because these are the rows that produced the complaints:

| Company | Should show |
|---|---|
| Goodman Gold Challenge | 4 green dots, "Apollo has no record of laurentian.ca", $0.73 |
| Canaccord Genuity | Stage 1 **red** despite `status: ok`; 402 in the tooltip; restart offered |
| ScanSource Chile | Under **Relevant** with a Research-failed chip, not under Not relevant |
| Codalio | Relevant lane, 28 people, no "Not researched yet" anywhere |
| Barings | $2.68 cost breakdown, 19 people |

---

## 8. Deliberately not in scope

- **Email verification.** There is no verification step to build a UI on yet. 112 of 2,380 are
  verified and nothing has moved in weeks.
- **Sending.** `push_instantly` is a permanent no-op and 0 of 639 drafts have been pushed.
- **A "Sent" dot** on the timeline, for the same reason.
- **Fixing the 37 dropped webhooks.** They are surfaced as a number (E2) and fixed in the
  Inbound repo, not here.
- **Backfilling `vertical`.** 64 of 85 are `unknown`; the fix is a pipeline change. This plan
  hides the field rather than pretending it holds data.
- **Person-level research.** Only `role_hypothesis` exists and it is null 91% of the time. The
  page stops implying otherwise (G6, G9) rather than inventing it.

---

## 9. Open items for the backend

In priority order. Each is a change in `github.com/tanaymehhta/qea-inbound`, not here.

1. **Top up OpenRouter credits and re-run the 56.** One pass of `run_batch.py`. This is worth
   more than every item in §5 and is not a frontend task.
2. **`inbound_request_rerun` + a runner that reads it.** Unblocks §B.
3. **Stop writing a verdict off a failed call.** A node that 402s should leave `account_type`
   null and set a distinct `research_status`, never `not_icp`. Three companies are currently
   misfiled because it does.
4. **A short `what_they_do` field.** Three or four words. Unblocks the good version of E3.
5. **One verdict column, not two.** `account_type` and `research_status` disagree on 11 of the
   companies that have visited. `verdict()` exists only to paper over that.
6. **Fix the 37 failed webhook parses.** 18% of inbound traffic is being dropped.
