# Inbound queue

**Route:** `/inbound` · **Status:** shipped, read-only · **Date:** 17 August 2026

The sales-facing inbound pages. Nothing here writes to the database — the whole `inbound_*`
schema is read-only to this app, which is a locked decision on the backend side, not a gap.

`DESIGN.md` is the visual contract this follows. `README.md` explains the dashboard as a
whole. `RUNS.md` covers the operator side — the run log, the stuck list and the drafts list.
`FRONTEND_HANDOFF.md` in the backend repo (`github.com/tanaymehhta/qea-inbound`) is
the data contract. This file records what was built, why, and what it exposed about the data.

---

## The problem

The old `/inbound` answered *did the pipeline run correctly* — one row per company, a status
dot per stage, cost per run, a node-by-node trace. That is the right page for the person
maintaining the pipeline and the wrong page for a salesperson, who arrives with a different
question: **who should I contact right now, and what do I say?**

Everything below follows from swapping that question. The old page was not deleted: it
answers a real question for a different reader and now lives at **`/pipeline`**, where its
name says who it is for.

---

## What was built

| Path | What it is |
|---|---|
| `app/inbound/page.jsx` | The queue — rep chips, lanes, cards or table |
| `app/inbound/person/[id]/page.jsx` | One person: who they are, visits, research, draft |
| `app/inbound/drafts/page.jsx` | Every draft in one list, and why 634 of 639 are blocked — `RUNS.md` |
| `app/inbound/company/[id]/page.jsx` | One company: account, visits, research, people, drafts |
| `app/inbound/research.jsx` | The research block, shared by both detail pages |
| `app/inbound/draft.jsx` | The editable draft + copy button (the only client component) |
| `app/inbound/inbound.css` | Every `.lab-*` class — the prefix outlived the `lab/` folder |
| `lib/inbound/routing.js` | Territory, and the rep who covers it |
| `lib/inbound/queue.js` | All reads and the lead shaping |
| `lib/inbound/words.js` | Pipeline vocabulary translated into English |
| `scripts/test-routing.mjs` | `node scripts/test-routing.mjs` — the whole regression suite |
| `app/pipeline/**`, `lib/pipeline.js` | The former `/inbound`, moved intact |

---

## One list, of companies

Everything inbound produces hangs off a company: the person RB2B named, the colleagues
research found around them, the buildings, the laws, the drafts. So the queue is one list of
companies. Open one and its people are inside, whoever actually visited marked **visited** and
sorted to the top — at Barings that is Gabe Daly, then the seventy colleagues research found
around him.

An earlier version split People and Companies into two tabs. That was wrong for one reason:
the same person appeared in both, once as a name and once inside their employer.

**Before removing the People list, this was checked rather than assumed:**

| | |
|---|---|
| Named people with no `company_id` | **0** |
| Named people whose `company_id` does not resolve | **0** |

So no person becomes unreachable. Every one of the 2,380 is inside exactly one company.

### The eleven test accounts

Ten of the 95 companies have no visit. Checked against `inbound_webhook_events`: **no RB2B
payload for any of them**, and all ten were created in three batch inserts at identical
timestamps — 28 Jul 22:53 (Durst, Verdical, Notion), 28 Jul 23:22 (MedStar, JLL), 4 Aug 17:15
(BXP, Prologis, Oxford, Related). They are where the research → people → email stages were
tested.

An **eleventh** joins them on a different signal. Metro Harbor Properties has a visit *and* a
webhook row, and is still not real: its domain is `metroharbor.example`, and RFC 2606 reserves
`.example` (with `.test`, `.invalid` and `.localhost`) precisely so it can never resolve. A
domain that cannot exist never bought anything; its visit is what testing the webhook looks
like. It sat under **Relevant companies** with a Boston BERDO hook and a contact until the
reserved-TLD check caught it.

An earlier version **excluded** them, on the reasoning that a sales queue is for people who
came to the site. That was wrong, and the numbers say why: those ten hold the only drafts
that pass the send gate. Excluding them did not stop the queue looking busy — it made it look empty while hiding the only work a rep could
actually do. They are also not junk: BXP has 25 buildings researched, Related 25, MedStar 16.
Only Notion Labs (0 people, 0 drafts) is a genuine throwaway.

They are **excluded from the queue**. That is a deliberate call and it has a cost: those
eleven hold **all five drafts that pass the send gate**, so the queue shows no ready work at
all until something makes an address verify. The alternative — a lane of their own — was built first and rejected, because a sales queue that lists accounts nobody
can sell to is a queue a rep learns to skim past.

The number is not swallowed. The footer counts them out loud and is computed, not written
down, so it stays true the next time somebody types an account in by hand.

---

## Territory and the rep split

`hq_country` is null on 85 of 95 companies, so territory is derived in the frontend.
`lib/inbound/routing.js` shrinks to the rep table the day stage 1 writes a real country.

There **is** an owner column — `inbound_companies.assigned_to` — and it is filled in on 16 of
99 rows, which is why 48 drafts cannot send (see *Why nothing sends*). Territory and ownership
are not the same thing and should not be conflated: routing says whose queue a lead lands in,
`assigned_to` says who has actually taken it. Today the first is computed on every load and
the second is almost always blank, so the pipeline drafts in the name of a rep the record
never confirms.

**The division, as given:**

| Region | Rep |
|---|---|
| United States | Mark Vasu |
| Mexico | Justin Kim |
| United Kingdom | Justin Kim |
| Canada | Justin Kim **and** Mark Dolan — both queues, not split |
| Asia · UAE | Gulraiz Khalid |
| Anywhere else, or unknown | Unrouted |

**How a location is resolved,** best evidence first. The order is the whole trick and every
step earned its place against a real row:

1. **A country the pipeline recorded** — `hq_country`, when present. Only 10 of 95 rows.
2. **Where the *person* was.** RB2B geolocates the visitor, so this beats anything about the
   company. `Chennai, TN` is Tamil Nadu, not Tennessee. `London, ON` is Ontario, not England.
3. **The domain.** Only when the visitor has no location at all — `asistio.ca` visits from
   General Trias in the Philippines, so a `.ca` read before the visitor's own city sends the
   lead to the wrong continent.
4. **The city on the company row.** `hq_city`/`hq_state` is **not a head office** — RB2B
   fills it from the browsing session, so on a company-level payload it is the visitor's own
   city with no person attached. It routes for that reason and no other.
5. **Where their buildings are.** `inbound_buildings` is the only geography in the schema
   that is genuinely about the company, and it is the last resort precisely because it
   answers a different question. Barings reads "New York, NY" at step 4 because someone
   browsed from there; its buildings are in DC, Charlotte, Franklin MA, Germany and Sweden,
   and a rep is not chasing Germany. Ties break to whichever country holds the most
   buildings, so a split portfolio routes to its larger half rather than to whichever row
   sorted first.

A person whose city and state we hold but cannot resolve stops at **Unrouted** rather than
falling through to a weaker signal. An unowned lead someone claims is a better failure than
a confident lead in the wrong queue.

That rule has a cost, and it was being paid: three companies sat under Unrouted labelled *No
location* while their own row said where they were — `West Jakarta, JK`, `Sugita, 14` and
`Paris, IDF`. Two of them were real leads in nobody's queue. The fix is read off the **state
code**, not the city, because the cities are ambiguous and the codes are not: Paris is also a
town in Texas, but `IDF` is Île-de-France and nowhere else, and `JK` covers all five compass
variants of Jakarta at once. Japan is the exception — its state arrives as a bare prefecture
number, and a bare number means something different in every country RB2B reports from, so
those ride on the city. **Two** companies remain Unrouted, both with genuinely no geography.

Every card shows how it routed on hover, so an inferred territory is never mistaken for a
known one.

---

## Relevant vs not relevant — and the bug it uncovered

Companies split on whether they are worth selling to. Building that split found a real
defect: **the pipeline records its verdict in two columns and they disagree.**

| `account_type` | `research_status` | count |
|---|---|---|
| `not_icp` | `not_icp` | 16 |
| **null** | **`not_icp`** | **10** |
| `owner_operator` | `needs_review` / `ready` | 11 |
| **`owner_operator`** | **`not_icp`** | **1** |
| `consultant` / `other_icp` | — | 3 |
| null | `new` | 1 |

Reading `account_type` alone — the obvious single field — filed **11 companies the pipeline
had explicitly ruled out as prospects**: Space Cubics, Asistio.ca, Bicol University,
Expedia, Sony Airpeak, Mediclinic Middle East and five more. They also showed "No research
findings yet", which read as *not researched* when the truth was *researched, and the only
finding was a rejection*.

**The rule now** (`verdict()` in `lib/inbound/words.js`, read by every surface so they cannot
drift apart):

- **Not relevant** — either column says `not_icp`, *and* the reason it says so is a real
  classification rather than a crashed API call.
- **Relevant** — everything else. A company nobody has ruled out is a prospect.

**74 relevant · 10 not relevant**, over the 84 companies in the queue, cross-checked against
a direct Supabase count.

**Two lanes, not three.** There used to be a third, "Not researched yet", holding every
company with no verdict in either column. It was answering a different question and getting
it wrong: on 17 August that lane held 49 companies, and research had run on all 49 and
**crashed** on all 49 (see *When research fails* below). What happened to research is now a
chip on the card — Researched, Research failed, or Not researched — and which lane a company
sits in is this rule alone.

**A verdict read off a crash is not a verdict.** Three companies — ScanSource Chile, Self
Employed and BAMO — were filed `not_icp` off a call that returned HTTP 402 and never
classified anything. `verdict()` catches that case and leaves them in the queue with a
Research-failed chip. The proper fix is upstream: a node that 402s should leave `account_type`
null and set a distinct `research_status`, never `not_icp`.

New Horizons Preschool is typed `owner_operator` but ruled out by its status. It sits under
Not relevant and its card says `Not a fit (typed Owns buildings)` — the contradiction is
shown rather than silently resolved.

Consultants (BCG, ALBATOT) sit under Relevant, labelled "Advises owners". They are partners
rather than buyers; splitting them out is a one-line change if wanted.

---

## Two words, from the backend

Whether a person can be written to is **not decided here.** It is read from
`inbound_people_view`, which the backend added on 10 August precisely so no frontend has to
reason about `list_status`, `sendable`, `company_match` and `email_status` separately:

| Column | Value |
|---|---|
| `status` | `Ready` or `Needs a check`. That is the whole vocabulary |
| `note` | One plain-English sentence, or NULL when Ready |

An earlier version of this page derived its own three-way answer from `email`, `email_status`
and the draft's validator. That was a second opinion on a question the backend already
answers, and it would have said something different the first time either side changed its
mind. It is gone. The view's sentences render verbatim — *"Found on LinkedIn only — title
unconfirmed"*, *"Title is ambiguous — may not run buildings"* — because mapping them to our
own labels is how the two drift apart.

Two things follow from reading the view rather than the table:

- **There is no third state for "sent".** Nothing has ever been sent from this system and
  `push_instantly` is a deliberate permanent no-op, so a lane for it would be empty forever.
- **The ordering of the notes is the backend's**, and it is deliberate there: *who they are*
  beats *which field is empty*, because "no email yet" is true of almost everyone until
  addresses start verifying, and therefore says nothing.

Verified before switching: the view's join drops nobody — 417 of 417 rows survive it.

The company-level verdict below is the opposite case: the backend has no equivalent, so that
one *is* derived here.

---

## Plain language

Every classifier label a rep would otherwise have to learn is translated once, in
`lib/inbound/words.js`.

| The database says | The page says |
|---|---|
| `owner_operator` | Owns and operates buildings — the people who buy this |
| `consultant` | Advises building owners — a partner, not a buyer |
| `other_icp` | Fits the profile without being an owner or a consultant |
| `not_icp` | No buildings to survey — the pipeline ruled them out |
| `rb2b_unconfirmed` | Guessed, not verified |
| `/how-ai-is-driving-a-new-era-of-efficient-building-envelope-retrofits/` | How AI is driving a new era of efficient building envelope retrofits |
| `/about-us/` | About us |
| `/` | Home page |

The translation also runs **inside the model's own prose** — the classifier quotes its enum
in its reasoning ("Classified not_icp."), and a rep reading the research should not meet the
vocabulary there either.

The raw URL path survives as a tooltip on every visit line, so a page name can be checked.

---

## Research as bullets

The pipeline writes findings as one unbroken 400-word paragraph. Nobody reads that with a
phone in their hand, so nothing in the research block is a paragraph:

1. **The counts**, in bold with tabular figures — visits from this company, people found,
   how many have an address and how many are verified, drafts written. These numbers were
   in the database all along and appeared nowhere. Codalio opens with *6 visits · 28 people
   found here*; Durst with *43 people found here · 6 with an email address, 5 verified ·
   5 drafts written*.
2. **The facts** — what they are, how many buildings and where, portfolio, which laws apply,
   how many public commitments, staff, revenue.
3. **What they have said publicly** — the claim, the year, the quote, the source link.
4. **Background** — the model's paragraph split at its sentence ends, first four shown, the
   rest behind "N more".
5. **Every law** and **every building**, in native `<details>`.

The splitter guards against abbreviations (`e.g.`, `Inc.`, `U.S.`), strips the inline
`[https://…]` citations the model leaves behind, and drops its self-applied labels
(`Scale:`, `Portfolio:`, `IMPORTANT:`).

> **This is cosmetic surgery on prose.** The proper fix is the research prompt emitting a
> list in the first place — a pipeline change in the Inbound folder, not here.

---

## Interaction rules

- **One click opens a person.** On a company, the whole name block is a link. The draft sits
  behind a separate toggle, so reading a draft and opening a person are different actions
  rather than two clicks at the same one.
- **Everything on one page.** No "full research →" link. A rep asking "why would they care"
  never leaves the name they are looking at.
- **Every card has every row.** Domain · verdict, location, visits, research, names found —
  on all 42, with the empty cases naming which kind of empty they are ("Not classified yet",
  "No research findings yet"). Rendering a row only when it had content made half the grid
  look like it was still loading.
- **State lives in the URL.** `?tab=&rep=&range=&as=` — every view is linkable, the back
  button works, and every page renders on the server.
- **Cards or Table** is a density switch on the same leads, nothing more.
- **Nothing spins.** The only JavaScript on any of these pages is the copy button.

---

## Drafts

- The draft is a **textarea**, not a `<pre>`. A rep always changes a word before sending, and
  what they copy is what they edited.
- **Copy** puts subject and body on the clipboard and confirms in place. This is the only
  reason `draft.jsx` is a client component.
- **Open in mail** hands it to the local mail client with the address, subject and body
  filled.
- **Mark as sent is a stub.** It moves the card in front of you and says so on screen.
  Wiring it needs a server action and a write policy on `inbound_emails`, neither of which
  exists — every `inbound_*` table is read-only to this app today.
- **Borrowed drafts.** Someone with no draft of their own shows a colleague's from the same
  company, labelled: *the pitch is the company's, so this is what they would get, not a
  draft to send as is.* A person with no address still needs to be readable as a lead.

---

## What the data says

From the running page, 17 August 2026. Every number here is queried, not remembered; the page
computes its own and this table is a snapshot of the same queries.

| | |
|---|---|
| Companies on file | 95 — **85 with a visit** |
| Companies in the queue | 84 |
| *Excluded test accounts* | *11 companies* |
| Named people at them | 2,380 (of 2,446 people rows) |
| — with an email address | 149 |
| — verified | **112** |
| — ready to email | **62** |
| Drafts written | 639 |
| — passing the send gate | **5**, all at Durst |
| — with no address on the draft | 491 |
| — ever pushed | **0** |
| Companies classified | 28 in the queue, 39 across all 95 |
| Companies where classification failed | **56** |
| Companies with nobody found | 19 |
| RB2B webhooks received | 207 — **37 failed to parse** |
| Total spent | **$29.99** |
| Apollo credits consumed | 2,061 |

**Five of 639 drafts pass the send gate and all five are Durst's**, from 4 August, and
**none of the 639 has ever been pushed** — `push_instantly` is a permanent no-op. The layout
is not the bottleneck. What is, is less settled than it looks.

### When research fails

**56 of the 95 companies have an `account_type_reason` that begins with a raw HTTP 402** —
OpenRouter ran out of credits mid-run and the classifier node returned it verbatim. There is
no classification prose for any of those 56. Only 39 companies were ever actually classified.

What follows from it, and what the page now does about it:

- The old **"Not researched yet"** lane was false for every company in it. It is gone; a chip
  says *Research failed* instead, and the count is on the header.
- Three companies were filed **Not relevant** off the failed call. `verdict()` no longer
  believes a `not_icp` whose reason is an API error.
- The raw 402 was rendered to reps, bulleted, under the heading *"Why it decided that"* —
  and again under *Background*, because the run writes the failure into `summary` too. Both
  are suppressed by one predicate, `isApiError()` in `words.js`.
- **A run can report success while failing inside.** Canaccord Genuity's stage 1 carries
  `status: ok` on one attempt and `needs_review` on the other, with three 402 nodes in it.
  The timeline reads `nodeState()` from `lib/pipeline.js`, never `run.status` alone.

**The credits were still not topped up as of 17 August 2026.** One `run_batch.py` pass over
those 56 companies, once they are, is worth more than anything left in this file.

### Why nothing sends — two gates, and they disagree

A rep opens Ashley Honeyman at Consero Global and reads **Ready to email** in green next to
**Not ready to send**. Both are correct; they are answering different questions, and until
this was measured it looked like a contradiction on the page.

- **Ready to email** is about the *person*: is there an address, is it verified, is it on the
  company's domain, is the role right. Derived by the backend in `inbound_people_view`.
- **Not ready to send** is about *this draft leaving automatically*: the address **and** the
  account behind it — owner assigned, role confirmed, copy matching the account type.

**62 people are Ready. All 62 have a draft. 57 of those drafts are blocked.** Green person,
blocked draft is the normal case, not an anomaly, and the reasons are two:

| Reason on the blocked draft | Count |
|---|---|
| `account unassigned — drafted as Mark Vasu, set assigned_to before sending` | **57 of 57** |
| `consultant account — partner motion, and no consultant copy exists yet` | 9 |

**48 of the 57 carry nothing but the unassigned reason.** They span seven companies — General
Motors, Global Affairs Canada, KPF, Mediclinic Middle East, Sony Airpeak, Consero Global,
Arkema Coatings — and the tell is the other end: the five drafts that *do* pass all belong to
The Durst Organization, the only one of those accounts with `assigned_to` filled in.
`assigned_to` is set on 16 of 99 companies.

Nothing about this is a data-quality problem. Routing already says United States is Mark
Vasu's, the page says it, and the pipeline drafted the email *as* Mark Vasu — the column is
simply empty, and the validator will not sign a mail on behalf of someone the record does not
confirm. Which is right of it. One `UPDATE` on seven rows moves 48 drafts from blocked to
sendable, and it is the cheapest unblock anywhere in this system.

The draft stays fully readable and copyable in every one of these states, because a blocked
send is not a blocked rep.

### Nobody found is three different answers

19 of the 85 visited companies have no named contact, and they are not the same problem:

| Cause | Count |
|---|---|
| Stage 2 never ran | 11 |
| Stage 2 ran; Apollo has no organisation record | 6 |
| Stage 2 ran; Apollo had one and nobody survived the buyer-profile gate | 2 |

The company page says which one, read off the stage-2 nodes: Goodman Gold Challenge — the
screenshot that started this — now reads *"No contacts found. Searched 7 Aug. Apollo has no
record of laurentian.ca, and a web search found nobody either."* Nothing broke there.

The received account is "Apollo credits are exhausted until 22 August". Queried directly on
10 August, Apollo says otherwise:

| | |
|---|---|
| Current cycle | 22 Jul → **22 Aug 2026** — not yet reset |
| Lead credits | 32,610 limit · 30,178 used · **2,432 remaining** |
| Direct-dial credits | 32,500 of 32,500 used · 0 remaining |
| Credits the pipeline spent on 10 Aug | **200** |
| New verified addresses since 5 Aug | **0** |

So credits are being spent, thousands remain, and not one address has been verified in five
days. Today's validator blocks are dominated by *"no email address"* and *"found on web;
Apollo has no record"*. That points at the people stage 2 finds simply **not being in
Apollo**, rather than at a billing wall — in which case 22 August unblocks nothing.

Stated as confidence: the credit figures and the zero are measured. The conclusion drawn from
them is inference, and belongs to the backend to confirm against Apollo's per-call responses.
Either way, **design for both ratios** — *Needs a check* dominates today and may not later.

47 people show an obfuscated surname — `Matt Mo***a` — for the same reason. The first name is
what the draft uses, so those rows are shown as they are rather than hidden.

Two data oddities worth knowing:

- **Spedding Industrial** is recorded with a `colliers.com` domain and a Toronto head office,
  while its research describes an industrial estate in Whenuapai, Auckland. The pipeline
  caught the contradiction itself and wrote it into its own reasoning.
- **Codalio** — 6 visits, 28 names, ruled out. The research notes that QEA Tech's CEO appears
  as a customer testimonial on their site. They are a software vendor you already buy from.

---

## Tests

```
node scripts/test-routing.mjs
```

No framework. Every case is a row that exists in the database today.

- **Territory** — the ten real locations, including `London, ON` → Canada and `Chennai, TN`
  → Asia; the precedence chain; that an unreadable place stops at Unrouted.
- **The places that used to be unroutable** — `West Jakarta, JK` and `Sugita, 14` to Asia,
  `Paris, IDF` to Europe, and that `Paris, TX` still resolves to the United States.
- **Reserved TLDs** — `.example`, `.test` and `.invalid` are test data; `example.com` is not.
- **The two company-level fallbacks** — that `hq_city` still routes a company-level payload
  (it is the visitor's city), that buildings sit *below* it, that a split portfolio goes to
  its larger half, and that a building with no `country` still resolves through its city.
- **The division** — every region to its rep, Canada to both.
- **Plain language** — page-name translation, the abbreviation guard in the bullet splitter,
  citation and label stripping.
- **The verdict rule** — both columns read; `null` + `not_icp` rules out; `owner_operator` +
  `not_icp` rules out *and* reports the conflict; a `not_icp` written off a 402 does not.
- **A failure is not a verdict** — `isApiError()` on Canaccord's real reason string and on
  Raad's real classification; `errorReason()` translating both the OpenRouter 402 and the
  Apollo 422, and falling through to a sentence rather than to `undefined`.
- **The timeline** — a run with `status: ok` holding a node with `output_summary.errors` is
  red; a clean run is green; a stage with no run is grey; runs are ordered by stage number
  and never by clock, because Canaccord's stage 3 ran before its stage 2.
- **The vocabulary** — all six email sources, and `c_suite` → `C-suite`.

---

## What the pipeline needs to do next

The frontend is compensating for these. Each is a change in the Inbound folder, in priority
order.

1. **Set `assigned_to` on seven companies.** It takes **48 drafts from blocked to sendable**
   and is one `UPDATE`. See *Why nothing sends* above: General Motors, Global Affairs Canada,
   KPF, Mediclinic Middle East, Sony Airpeak, Consero Global and Arkema Coatings. Nobody
   disagrees about who owns them — routing already says so and the drafts are already written
   in that rep's name — the column is simply empty, and the validator will not sign a mail on
   behalf of someone the record does not confirm.

   Worth doing properly at the same time: **`inbound_set_company_owner(p_company uuid,
   p_owner text)`**, a `security definer` function shaped like `inbound_set_person_ready`, so
   a rep can claim an account from the dashboard instead of waiting on a backend write. The
   frontend already computes the answer — `repsFor(region)` in `lib/inbound/routing.js` — and
   has nowhere to put it. That is the whole gap: this app can read `assigned_to` and cannot
   write it, so it watches 48 drafts stay blocked on a fact it already knows.

2. **Top up OpenRouter credits and re-run the 56.** One `run_batch.py` pass. It is worth more
   than every frontend item on this list and none of them substitutes for it.
3. **Write consultant copy.** Nine of the blocked drafts are consultancies carrying
   owner-operator wording, refused on purpose. Until that copy exists they cannot pass, and
   the nine sit behind item 1 rather than beside it.
4. **Stop writing a verdict off a failed call.** A node that 402s should leave `account_type`
   null and set a distinct `research_status`, never `not_icp`. Three companies are misfiled
   because it does, and `verdict()` only catches them by pattern-matching an error string.
5. **`inbound_request_rerun(p_company, p_stage)`** — a `security definer` function plus a
   runner that reads its table. Until it exists, a red dot on the timeline can explain itself
   and cannot offer to fix itself: `run_pipeline.py` is a CLI on one laptop, there is no
   scheduler, and the webhook never starts a run.
6. **A short `what_they_do` field.** Three or four words the classifier already knows.
   `industry` gets the filter chips to "Information Technology", never to "drone company".
7. **Write one verdict, not two.** Or make the two agree. Eleven of forty-two disagreeing is
   a defect, not a nuance.
8. **Fix the failing webhooks.** 37 of 207 RB2B payloads carry `parse_status='failed'` — 18%
   of inbound traffic dropped before it can reach this page, and no amount of frontend work
   recovers it. The queue header counts them out loud.
9. **Write `hq_country`.** Then `lib/inbound/routing.js` is just the rep table, and steps 2–5
   of the location chain stop existing.
10. **Emit research as a list.** The sentence splitter is a workaround with a known ceiling.
11. **Backfill `vertical`.** `unknown` on 64 of the 85 visited companies, which routes office
   REITs — BXP, Related, Oxford — to industrial copy. The page hides the field rather than
   rendering the word "unknown" as though it were data.

~~**Set `inbound_emails.person_id`**~~ — **done, 10 August.** It is now set on all 639 drafts
and is the join key; `person_email` is the one that is NULL, on 491 of them. The email
fallback in `queue.js` survives only for rows written before the change.

And the one that decides whether any of this is useful on day one: **find out why no address
verifies.** The assumption has been that Apollo credits gate it and that 22 August clears the
gate. Apollo reports 2,432 lead credits still available and the pipeline spent 200 of them on
10 August, with zero addresses verified since 5 August — so the gate may not be credits at
all, and waiting would be waiting for nothing.

---

## What is deliberately not here

No kanban, no drag-and-drop, no send-from-the-dashboard, no notifications, no activity feed,
no manual rep reassignment. Sections in a list do what columns would do at a tenth of the
code, and a salesperson who wants a CRM already has one.
