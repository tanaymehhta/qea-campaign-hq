# The run log, the stuck list, and every draft

**Routes:** `/pipeline` (Runs · Stuck) · `/inbound/drafts` · **Date:** 10 August 2026

Three questions the dashboard could not answer before today, all of them versions of
*is this thing actually running, and what did it produce.*

`INBOUND.md` covers the sales queue. `DESIGN.md` is the visual contract. `FRONTEND_HANDOFF.md`
in the backend repo (`github.com/tanaymehhta/qea-inbound`) is the data contract.

---

## How to read it

**Everything below this section is *why*. This section is *how*.** Start here.

### The one line that answers "is it on"

The bar at the top of every `/pipeline` view:

> ● **Last scheduled run 1 hour ago** — On schedule — it fires every 3 hours. · 10 Aug, 15:27

| Colour | Means |
|---|---|
| Green, dot breathing | A GitHub run inside the last 4 hours |
| Amber | 4–8 hours. Later than the schedule should allow |
| Red | Over 8 hours. Something has stopped — the Actions tab link is right there |
| Grey | Nothing has identified itself as GitHub's yet |

It **ignores laptop runs on purpose.** A laptop run means a human was at a keyboard, which
says nothing about whether the schedule is alive, and a fresh one must never paper over a
dead one.

### A row in the run log

```
STARTED                     COMPANY    WHERE   STAGES   COST   TOOK  ERRORS
10 Aug, 15:58 · 51 min ago  Avrillon   Laptop  1 2 ③    $0     1s    —
```

- **Where** — `GitHub` is the 3-hourly schedule, `Laptop` is somebody running it by hand,
  `—` is an execution that wrote no workbook and therefore cannot say. See *Which machine
  ran it*.
- **Stages** — 1 research · 2 people · 3 draft. Green ok, amber flagged itself for review,
  red errored, dashed grey never ran. The stage name is a tooltip.
- **Errors** — nodes that recorded a failure, **including the ones whose status says `ok`
  while they wrote nothing.** That combination is this pipeline's recurring failure mode, so
  it counts as an error here rather than being folded into the clean total.

### Open a row for the cost of each step

A row expands to its stages, and each stage to its nodes, left to right in execution order:

```
③ Write + send                          ok · 1s · $0.0000 · 0 tokens · 0 searches

0. load_stage2 → 1. pick_opener → 2. render_all → 3. validate_all → 4. export_excel
   0.3s            0.0s             3 rendered      0 passed          3 rows
   3 contacts      0 evidence_urls  3 with_body     3 blocked

   emails 3   ·   passed 0   ·   pushed 0   ·   blocked 3
```

Every chip carries its own duration and dollar cost — the finest grain the pipeline records.
**An amber chip is where to look:** a node that failed while reporting success. Avrillon's
stage 1 carries one today, reading `Error code: 402` — the OpenRouter billing errors have not
stopped.

### The other tabs

| Tab | Answers |
|---|---|
| **Runs** | Did it run, when, where, what did each step cost |
| **By company** · **By person** · **Research** | The three original views, unchanged |
| **Stuck** | Which companies a run abandoned — and the button that requeues them |
| `/inbound/drafts` | All 455 emails, and why 450 cannot be sent |

### The number worth acting on today

Open **"Why the blocked ones are blocked"** on the drafts page. **149 drafts are blocked
only because `assigned_to` is empty** — *"drafted as Mark Vasu, set assigned_to before
sending"*. No API, no credits, no waiting for 22 August: somebody assigns those accounts and
149 drafts stop being blocked for that reason. It is the largest cause on the list that is a
decision rather than a data problem.

---

## What was missing

`/pipeline` was organised around the **company**: one row each, a status dot per stage, cost
per company, a node-by-node trace one click in. That answers "how did Barings go".

It could not answer "did the 3-hourly job fire this afternoon", because a run's *time* was
never a first-class thing on the page — a company researched on 28 July and one researched an
hour ago sorted next to each other by last visit. Nor could it answer "what has stage 3
actually written", because drafts only ever appeared inside the person or company they belong
to. And a company a run had abandoned appeared nowhere at all.

| Route | Question |
|---|---|
| `/pipeline` (Runs) | Did it run, when, where, and what did each step cost |
| `/pipeline?view=stuck` | Which companies did a run leave half-done, and put them back |
| `/inbound/drafts` | Every email it has written, and why 450 of 455 cannot be sent |

---

## Which machine ran it

The one fact that decides whether the schedule is alive, and **nothing in
`inbound_graph_runs` records it.** `triggered_by` says `pipeline` for the runner whether that
runner is GitHub Actions or a laptop, and `manual` for a one-off. Those are the same two
values for both machines.

`excel_path` gives it away for free. The Actions runner checks the repo out under
`/home/runner/work`; Tanay's Mac is under `/Users`:

```
/home/runner/work/qea-inbound/qea-inbound/agent/exports/Inbound — Accerta.xlsx   → GitHub
/Users/tanaymehta/Desktop/QEA Tech/Inbound/agent/exports/Inbound — Avrillon.xlsx → Laptop
```

Today that reads **26 GitHub executions and 286 laptop ones**, with the first GitHub run at
14:26 UTC on 10 August — the afternoon the workflow was wired up, which is the right answer.

This is inference from a side effect, so **an execution that wrote no workbook says `—`
rather than guessing.** Ten of 379 rows are in that state. The proper fix is one column on
the runs table; until it exists, this is honest and free.

---

## One execution, not one run

Each stage writes its own `inbound_graph_runs` row. Rows belonging to one end-to-end run
share a `pipeline_id`, and — checked, not assumed — **no group spans two companies**, so a
group is safely "this company, this execution".

`pipeline_id` is NULL on 197 of 379 rows: everything before the column existed, and every
stage fired one at a time by hand. **Each of those is its own execution.** Folding stray
stages together by timestamp would invent a history the database does not record, and the
row it invented would be the one somebody quoted a cost from.

379 runs group into 322 executions. 92 of the 125 real pipeline groups hold a single stage —
those are the accounts stage 1 ruled out, where stopping is the correct behaviour and not a
truncated run.

Two smaller things the table forces:

- **`duration_sec` is NULL on all 379 rows.** Every duration on the page is computed from
  `finished_at − started_at`, and an execution still in flight shows `—` rather than a
  number counted from a start it has not finished.
- **The worst stage decides the execution.** `error` ► `cancelled` ► `running` ► `needs_review`
  ► `ok`. An execution is only `ok` when every stage of it was.

---

## Is it on

The banner above every `/pipeline` view, and the reason the Runs tab is the default.

The workflow fires **every 3 hours**, and GitHub queues scheduled runs under load — the first
one ever to fire was **64 minutes late**. So:

| Silence | Reads |
|---|---|
| ≤ 4 hours | On schedule |
| 4–8 hours | Later than the schedule should allow |
| > 8 hours | Nothing has run. Check the Actions tab |

**Measured on GitHub-hosted executions alone.** A laptop run means a human was at a keyboard,
which is the opposite of the question being asked — and a fresh one must never paper over a
dead schedule. `scripts/test-runs.mjs` holds that case specifically.

The banner links to the Actions tab, which is the only place the *workflow's* own start time
lives. `started_at` on the first stage is within a minute of it and is what the page uses.

---

## The stuck list

`v_inbound_stranded`, grouped by `stranded_reason`, worst first. 21 rows today: 9 researched
with nobody found, 3 parked on geography, 9 judged not a fit.

**"Research this again" is one write** — `research_status = 'new'` — through
`inbound_set_company_relevant`, the same security-definer function the queue's relevance
toggle already uses, and the same value `python scripts/run_pipeline.py --stranded` writes.
The next scheduled run picks the company up like any new one. There is no queue, no job
runner and no new endpoint, and the button says out loud that it costs money.

**`judged not a fit` gets no button.** A model that actually ran said no; that is a verdict,
not a failure. The runner's own `--stranded` flag skips those for the same reason, and a
screen that offered to re-run them would be inviting somebody to pay to be told no twice.

---

## Every draft

455 drafts. **5 pass the send gate.** Nothing has ever been sent — `push_instantly` is a
deliberate permanent no-op — so there is no Send button and no "sent" filter.

A blocked draft **keeps its body**. When 450 of 455 do not ship, the reason has to sit next
to the sentence it stopped, or the only visible fact is a number.

The page does not derive its own verdict. `validator_status` is the send gate,
`validator_reasons` are the backend's own sentences rendered verbatim, and whether the person
is writable comes from `inbound_people_view` — the same rule `INBOUND.md` sets out for the
queue, for the same reason.

The **"why the blocked ones are blocked"** table is the useful thing on the page, and it was
not previously computable anywhere:

| Reason | Drafts |
|---|---|
| email not verified (unknown) | 387 |
| no email address | 371 |
| role unconfirmed — generic operator copy, check the title | 267 |
| stage 2 marked not sendable | 243 |
| found on web; Apollo has no record — title unverified | 175 |
| account unassigned — drafted as Mark Vasu, set `assigned_to` before sending | 149 |

A draft can be stopped by several at once, so the column sums past 450. **149 of them are
stopped by an unassigned account**, which is a decision somebody can make today rather than a
data problem to wait out.

The editable draft with the clipboard button stays on the person's page. Mounting 455
textareas to render a list would make this the one page in the section that spins.

---

## A bug this uncovered

`className="pill ok"`, `"pill warn"`, `"pill bad"` and `"pill dim"` have been written across
`/pipeline` since it shipped. **globals.css defines `.pill` and the `p-*` family and nothing
else.** `.ok` and `.bad` exist as bare text-colour utilities and were doing half the job by
accident; `.warn` matched nothing at all.

So every stage dot rendered the same neutral grey, and a stage that flagged itself for review
looked exactly like one that passed — on a pipeline whose stages are `needs_review` **31
times out of 322**. Defined now in `pipeline.css`, scoped to the two pages that use them, in
the `p-*` idiom: colour the type, tint the border.

---

## Tests

```
node scripts/test-runs.mjs
```

The two pieces of judgement, held to the shapes the table actually holds: `duration_sec`
NULL, `pipeline_id` NULL on half the rows, the machine knowable only from a workbook path.

- **Grouping** — three stages under one `pipeline_id` are one row and their costs, tokens,
  searches and Apollo credits add up; a row without one is its own execution; one stage
  naming the machine names the execution; newest first.
- **The worst state wins** — `needs_review` is not `ok`, `error` outranks `cancelled`, an
  unfinished run reads `running` and reports no duration, and a cancelled one does not.
- **The schedule** — 3 hours plus GitHub's delay is healthy, 8 is not, no GitHub run at all
  is `unknown`, and a laptop run never stands in for one.

---

## What the pipeline could do to delete code here

1. **Record the host.** One column, and `hostOf` and its ten unknown rows both go away.
2. **Write `duration_sec`.** It is declared and never populated.
3. **Set `pipeline_id` on every run**, including one-off stages, and the solo-execution
   branch disappears.
4. **Set `assigned_to`.** It blocks 149 drafts, more than any cause except the address itself.
