# Where each company stopped, and a button that restarts it

**Written:** 17 August 2026 · **Status:** Part A shipped `bee6482`; Part B shipped 17 August,
except the per-company concurrency change, which was dropped — see the note under step 4 ·
**Repos:** this one, and `qea-inbound`

Two pieces of work. Part A is this repo alone and depends on nothing. Part B spans both
repos and should not be started until OpenRouter and Apollo have credit in them, for the
reason given at the bottom.

Everything below was checked against the database on 17 August 2026, not inferred.

---

## What already shipped (do not rebuild it)

`b14d6fa` on `main`. `/inbound/system` exists and holds the funnel, the per-stage table, the
blocker list and the cost. `lib/inbound/system.js` is its loader. Read both before adding to
them — the numbers in Part A are a different cut of data that page already loads.

Two rules that page follows, and Part A must follow too:

1. **Never compute a second version of an answer.** The stage table is drawn by `timeline()`
   from `lib/inbound/queue.js` — the same function, same arguments, that draws the four dots
   on a company page. A summary that computes its own "did research work" is a second opinion
   that goes stale the first time the real one changes.
2. **Never divide one population by another.** The cost card did that and read 15% high. Every
   figure in a section is the same set of companies, and anything outside that set is named
   out loud rather than folded in.

---

## Part A — where each company stopped

**Repo:** this one. **No schema changes, no other repo, no credentials.** Roughly half a day.

Every company falls out at exactly one point. Today, of 90 in the queue:

| Where it stopped | Companies | What unsticks it |
|---|---|---|
| Stuck at research | **61** | OpenRouter credit, then re-run stage 1 |
| Researched, nobody found | **17** | Apollo credit, then re-run stage 2 |
| People found, nothing written | **1** | re-run stage 3 |
| Drafts written, none pass the gate | **9** | **not a re-run** — see below |
| All the way through | **0** | |

They sum to the queue total, which is the property worth preserving: a reader can add the
column up and check the page against itself.

The bucketing is the first missing outcome, in order — this is the query, verified:

```sql
case
  when not researched   then 'stuck at research'
  when not has_people   then 'researched, nobody found'
  when not has_draft    then 'people found, nothing written'
  when not has_sendable then 'drafts written, none pass the gate'
  else 'all the way through'
end
```

where `researched` is `account_type_reason is not null` **and** not an API error — the same
test `researchChip()` in `lib/inbound/words.js` applies. Reuse that function; do not re-write
the regex.

**Build it in JS off `loadSystem`'s existing arrays, not as a new query.** That loader already
holds every company with its contacts, drafts and chip. A fifth database round-trip to
recount them is how the page starts disagreeing with itself.

### What the section must say

- A bar per bucket with the count and the share, in funnel order.
- Each bar links to that list of companies. "61" is not actionable; sixty-one names are.
- One plain sentence per bucket saying what would unstick it.

### The one that is not a re-run

The 9 at the send gate are blocked on facts, not failures. Per `INBOUND.md`, 48 drafts across
seven companies are blocked only because `assigned_to` is empty — the validator will not sign
a mail for an owner the record does not confirm — and nine more are consultancies carrying
owner-operator copy, refused on purpose. **Re-running any of them changes nothing.** The
section must say so, or it invites someone to pay to be told no twice.

---

## Part B — the retrigger buttons

**Repos:** both. Roughly two days, most of it here.

### What already exists (this is smaller than it sounds)

`~/Desktop/QEA Tech/Inbound` — the `qea-inbound` repo, on this machine.

- `agent/scripts/run_pipeline.py` already accepts `--company-id <uuid>`, `--from <1|2|3>` and
  `--to <1|2|3>`. **No Python needs writing.**
- `.github/workflows/inbound-pipeline.yml` already has `workflow_dispatch` with `name` and
  `from_stage` inputs, a 3-hourly schedule, and `concurrency: inbound-pipeline` with
  `cancel-in-progress: false` — so a second request queues rather than colliding.

We are building a doorbell for a machine that already runs.

### Step 1 — `qea-inbound`: accept a company id

The workflow takes a company **name** as a substring match. That is how you re-run the wrong
company. Add a `company_id` input and pass it to `--company-id`, which the script already
takes. Two lines. Keep `name` for humans clicking "Run workflow" in the GitHub UI.

### Step 2 — this repo: a GitHub token

A fine-grained PAT, scoped to `tanaymehhta/qea-inbound` only, with Actions: write. Stored as a
Vercel environment variable. **Tanay creates it — do not mint credentials on his account.**
It is read only inside a `"use server"` action and must never reach the browser.

### Step 3 — Supabase: remember who asked

`inbound_rerun_requests` (company, stage, requested_by, requested_at, github_run_id, state)
plus an `inbound_request_rerun(p_company uuid, p_stage int)` `security definer` function,
shaped like the three that already exist — `inbound_set_person_ready` is the model.

Without it the button fires into the dark: the page cannot say "already queued four minutes
ago", and nothing stops a rep pressing it eleven times.

### Step 4 — this repo: wire the button

`RestartButton` in `app/inbound/controls.jsx` is already rendered disabled in all four places
it appears, with a title naming the missing function. Give it a server action that writes the
request row and POSTs to:

```
POST /repos/tanaymehhta/qea-inbound/actions/workflows/inbound-pipeline.yml/dispatches
{ "ref": "master", "inputs": { "company_id": "...", "from_stage": "1" } }
```

Same call everywhere; only the stage number differs. Stuck at research → 1. Stuck at the
email node → 3. That is the whole reason this works for a stuck draft as well as stuck
research.

### What was dropped, and why

The obvious speed-up — giving each company its own `concurrency.group` so a click never
waits behind the 3-hourly batch — **must not be made.** `DAILY_CREDIT_CAP` in
`agent/src/tools/apollo.py` says so in its own comment: the 150/day ledger reads its base
from `inbound_daily_metrics` once per process, so it is only a cap because
`concurrency: inbound-pipeline` guarantees one process at a time. Two runners would each
spend the full 150. Splitting the group needs an atomic reservation in Postgres first.

The wait it would have saved, measured on 17 August: dispatch to work starting is 17
seconds, and batch runs that day took 21s, 24s, 25s, 30s, 5m32s and 6m26s.

### Two things to be honest about in the UI

- **It is not live.** GitHub takes 30–60s to pick up a dispatch and the pipeline runs for
  minutes. The button says "asked for — queued", then shows the result when the new
  `inbound_graph_runs` row appears. Do not fake a progress bar.
- **It should refuse when it is pointless.** 195 recorded failures are "out of OpenRouter
  credits" and 46 are "out of Apollo credits". Re-running those spends money to fail
  identically.

---

## Open decisions — ask before building

1. ~~Can Claude edit the `qea-inbound` repo?~~ **Yes, confirmed 17 August.**
2. **Does the "who asked" table get built, or is fire-and-forget acceptable?** Part B step 3
   assumes it does. If not, the button cannot report state and steps 3 is dropped.
3. **Should the button refuse to fire on a credit error, or warn and allow it anyway?**

## Do this first, before either part

Top up OpenRouter, then Apollo, then run one `run_batch.py` pass. That recovers more than
every frontend item in this document combined, and none of them substitutes for it. 61 of 90
companies are stuck behind an empty account, not behind a missing button.

## Also outstanding

- `INBOUND_LOOK.md` and `INBOUND_UI_PLAN.md` both read `Status: not started`. The work in
  both is done and shipped in `b14d6fa`. Flip them.
- The "1 error" badge in dev is pre-existing and has never been diagnosed. It appears on
  `/pipeline`, which this work has not touched.
