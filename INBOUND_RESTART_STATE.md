# The restart button: what it does, and what is still wrong

**Written:** 17 August 2026, evening · **Status:** shipped to `main` · **Repos:** this one, and `qea-inbound`

Every number below was read from the database on 17 August 2026, not inferred. Where a
figure comes from one measurement rather than a population, it says so.

---

## What a rep can now do

Open a company in `/inbound`, and where a stage failed there is a **Restart** button. It
runs that company again, from that stage through to the written draft, on the same GitHub
Actions workflow the 3-hourly schedule uses.

Measured on 17 August: **the POST is accepted and GitHub creates the run one second
later**, and Python is running about 17 seconds after that (3s to allocate a machine, 14s
for checkout, Python and a cached `pip install`). The plan of record said 30–60 seconds;
that was pessimistic.

A restart always runs **through to the end**. `run_pipeline.py --to` defaults to 3, and a
stage whose input was never produced has nothing to read, so there is no such thing as
re-running one step alone.

### Why this matters more than a convenience

The 3-hourly schedule runs `--all-new`, which selects `research_status = 'new'`. **That is
0 companies right now.** `run_pipeline.py --stranded` covers 70. Of 95 companies that have
visited, most sit at `needs_review` after a classifier 402, and nothing in the automation
ever revisits them.

For those companies a rep pressing this button is the only route back.

---

## Where the queue actually stands

| | |
|---|---|
| Companies that have visited | **95** |
| In `v_inbound_stranded` | **86**, of which **70** are worth running (the rest are ruled out) |
| Waiting for the schedule (`research_status = 'new'`) | **0** |
| Drafts written | **707** |
| Drafts on companies with no owner on file | **401**, across **59** companies |
| Apollo reveals spent today | **170** against a 150/day cap |

Research is costing roughly **$0.40–0.75 a company** tonight, so clearing the 70 is on the
order of **$30–50** plus Apollo credits for whoever gets found.

---

## The three states you will see, and what they mean

The four dots on a company page — Visited, Researched, People found, Emails written — each
read **the latest run of their own stage**, and those runs can be hours or days apart.
That caused two bugs today, both fixed:

- While a stage is running, every stage after it now says **"waiting its turn"** rather
  than showing last time's answer. Vicinity Energy drew research spinning beside a red
  People and a green Emails from three hours earlier, which reads as the emails having been
  written before the research.
- A dot's colour now follows **the outcome, not the run's health**. PowerOptions has ten
  people and ten drafts and was drawing a red cross, because one step inside the last run
  hit the Apollo cap.

The People dot, precisely:

| Shown | When |
|---|---|
| Green | People on file, nothing went wrong |
| Green, with a note naming the problem | People on file, but the last run hit something |
| Red | Something went wrong **and** there are no people |
| Grey dash, "Nobody found" | Ran cleanly, genuinely found nobody |
| Dashed ring, "not yet" | Never run |

---

## Errors and gaps that still exist

Ordered by how likely each is to waste money or mislead a reader.

### 1. `apollo_sweep` will not search again, so a fixed research changes nothing

**This is the big one.** When stage 2 runs, `apollo_sweep` skips the Apollo search if this
company has ever been swept:

```
apollo_sweep: "already swept — 0 Apollo records billed", reused_prior_sweep: true
```

**All 70 recoverable companies already have a prior sweep on record**, and every one of
those sweeps ran while research was 402-ing — so they searched Apollo using an empty
picture of the company. Re-running research now produces a real classification (Greens
Farms Academy went from a 402 stack trace to `owner_operator`, confidence 0.92, with three
buildings and Westport CT), and then the people stage refuses to look again.

Re-run the backlog today and you get 70 beautifully classified companies with no new
contacts, and it will look like the pipeline worked.

**Fix:** in `qea-inbound`, let the sweep run again when stage 1 has produced new
information since the last sweep — new geos, new buildings, a changed account type. Not
"always re-sweep", which burns credits. Not yet done; it spends Apollo credits, so it needs
a decision first.

### 2. The Apollo daily cap is spent, and it fails silently

Today's ledger reads **170 against a 150/day cap**. When the cap is hit, the run still
records `ok` — the failure appears only inside a node:

```
apollo_reveal → errors: ["apollo daily cap: 10 of 10 not revealed (150/day)"]
```

So a company can show ten people found and no email addresses, with nothing at run level
saying why. The dashboard now names it in plain English, but the pipeline does not.

The cap resets on the New York date. At ten reveals a company that is about **15 companies
a day**, which is the real ceiling on any backlog recovery.

### 3. The cap is not atomic, and only half the spend is gated

`DAILY_CREDIT_CAP` in `agent/src/tools/apollo.py` says so itself: the ledger reads its base
from `inbound_daily_metrics` **once per process**, and it is only a cap at all because the
workflow's single `concurrency: inbound-pipeline` group guarantees one runner at a time.

Two consequences:

- **Do not give the workflow a per-company concurrency group.** It was proposed today as a
  one-line way to stop a restart waiting behind the batch, and it would silently uncap
  Apollo spend. Splitting the group needs an atomic reservation in Postgres first.
- The cap gates `/people/match` and `/people/bulk_match` only. Search records are counted
  after the fact and not gated at all — measured tonight, **216 records booked internally
  against 17 lead credits actually billed**.

### 4. A credit failure is invisible in the run row

`inbound_graph_runs.error` is NULL when the LLM nodes 402, because they soft-fail and the
run still records `needs_review`. I read that column this morning and told Tanay the credit
gate was clear; it was not. **Never judge credit health from the run row** — the 402s live
in `inbound_graph_node_events.error`.

The restart button's own credit refusal was written against the run column and never fired,
which is how a press cost $0.70 to learn nothing. It reads node events now.

### 5. Anyone with the URL can spend money

The dashboard has **no login**. `lib/db.js` carries the anon key inline, and
`inbound_request_rerun` is granted to `anon`, so a restart is executable by anyone who can
reach the page. Whether the deployed site is protected has not been confirmed — my Vercel
connection 404s on that project.

Sign-in (Microsoft Entra ID via Supabase Auth) is being built in a parallel session and
will revoke `anon` across the schema. Until then, **check Project → Settings → Deployment
Protection**. When that work lands, this button should be admin-only and pass the actor
into `p_actor`, which is null today because there is no session to name.

### 6. A hung run blocks that company for two hours

There is no per-stage timeout. The job has `timeout-minutes: 90`, and the longest research
run on record took **77 minutes while making one LLM call and twelve searches for seven
cents** — it was not working, it was waiting on a call that never returned.

While a run is `running`, the restart button refuses that company, using a 2-hour window.
So a hung or crashed runner locks the company out for up to two hours. A per-stage timeout
in `qea-inbound` would cap both. Not done.

### 7. A restart can wait behind the batch

Because the concurrency group is workflow-wide (see #3), a press while the 3-hourly batch
is mid-flight waits. Measured on 17 August, batch runs took 21s, 24s, 25s, 30s, 5m32s and
6m26s — so the wait is usually seconds. Left alone deliberately.

### 8. `github_run_id` is never filled in

The dispatch API returns 204 with no body, so nothing tells us which run it created. The
column exists and stays null. The evidence a rep actually needs is the new
`inbound_graph_runs` row, so this has not been chased.

### 9. Smaller things

- **Nothing cleans up `inbound_rerun_requests`.** Five rows today; it will grow forever.
- **Only the company page self-refreshes.** `/inbound` and `/inbound/system` do not, so a
  run finishing does not update the queue you are staring at.
- **The queue cards have no running state.** The spinner exists only on the company page.
- **Stage 3 cannot be fixed by restarting** where the block is an empty `assigned_to`: 401
  drafts across 59 companies are held only by that, and re-running writes the same mail for
  the same refusal. The button says so where it can see the case.
- **The "1 error" badge on `/pipeline`** is pre-existing and has never been diagnosed.
- **`--stranded` now runs 70 companies**, not the 33 it did this morning, because the view
  was widened today. Anyone reaching for it should know what they are about to spend.

---

## What to check when you try it on Vercel

1. **The env var is set** (`GITHUB_DISPATCH_TOKEN`, Production and Preview) but a
   deployment made **before** it was added will not have it. If the button says "this
   deployment has no GitHub token", redeploy.
2. **The token is narrow on purpose**: `tanaymehhta/qea-inbound` only, Actions: read and
   write. If it is ever rotated, the button stops and nothing else does.
3. **`ref` is `master`.** That repo's default branch is not `main`, and the dispatch 422s
   if it is wrong.
4. **Press once and wait.** A second press inside the same run is refused by design, and
   the refusal now reads "Not started — …" rather than "That didn't save".
