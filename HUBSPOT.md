# Interested replies become HubSpot deals — 14 September 2026

How a reply marked interested turns into a deal in HubSpot, owned by the salesperson
whose campaign it answered, with nobody retyping anything.

`README.md` explains how the system is meant to work. `STATE.md` records what was built
and when. `TRUST.md` records what is true about the data. **This file records the one
path out of this dashboard into another company's system**, which is the only place
where being wrong costs somebody else's afternoon rather than a wrong number on a
screen. If you are picking this up, read it before changing anything that writes to
HubSpot.

Status: **live since 14 Sep 2026**, on the existing thirty-minute sync.

---

## 1. The problem it solves

Mark Dolan was doing this by hand. The evidence, from his own deals:

| Company | Reply arrived | Deal created by hand | Lag |
|---|---|---|---|
| Excel Roofing | 10 Sep | 11 Sep | 1 day |
| Iron Shield | 25 Aug | 26 Aug | 1 day |
| Wolf & Wolf | 26 Aug | 3 Sep | 8 days |
| Al Pro Solutions | 13 Aug | 25 Aug | **12 days** |

The typing was never the cost. The twelve days were — a prospect who asked a question
on the 13th and entered the pipeline on the 25th. Worst case is now **thirty minutes**,
and that is the sync interval, not a timeout.

At the time this was built there were three leads marked interested with no deal in
HubSpot at all. Nobody had noticed.

---

## 2. What fires it

**`replies.sentiment = 'interested'` — whoever set it.**

That column has exactly one writer path per source of truth and the push asks the
column, not its author:

- the phrase rules label a reply *before it is stored* (a BEFORE INSERT trigger)
- a person labels or relabels it from `/replies` or `/conflicts`, through `classify_reply()`

Both write `sentiment`. So a reply the rules abstain on sits as `unclassified` doing
nothing until somebody clicks, and **that click is what pushes it**. There is no second
mechanism, no "and also send to HubSpot" button, and nothing for anyone to remember.

### What does *not* fire it

**Instantly's own `lt_interest_status`.** This was the trigger in the first cut of the
file and was removed the same day. The argument for it was that Instantly flagged 6
leads where the dashboard flagged 14, and the dashboard's extra 8 were titled things
like "Re: Out of Office" and "Re: Retirement".

That argument died when those eight rows were corrected. Both lists then held 7, six of
them the same people, and on the single remaining disagreement **Instantly is the one
that is wrong**: it flagged `rashmi@wolfenburg.ca`, a roofer writing to *sell us* roof
replacement work ("send me the project details and drawings"). The rules abstain on her.

A deal was created for her, inspected, and deleted within the hour. That is the whole
case against the vendor's flag, and it is preserved in the header comment of
`hubspot.ts` so nobody re-derives the discarded reasoning.

Something inside Instantly sets that flag within 6–13 seconds of a reply arriving, at
hours like 23:35. It is not us — the sync makes eight calls to Instantly and every one
is a read; there is no code in this repo that can write an interest status. It is not a
webhook or a custom label rule; the workspace has neither. What it actually is remains
undetermined.

---

## 3. The five words, and which two of them reach HubSpot

`replies.sentiment` has allowed six values since the table was built. Until 14 Sep only
three were ever used.

| Sentiment | Counts as "interested" on tiles | Creates a HubSpot deal |
|---|---|---|
| `interested` | yes | **yes** |
| `referral` | yes | no |
| `not_now` | yes | no |
| `not_interested` | no | no |
| `auto_reply` | no | no |
| `unclassified` | no (it is "still to read") | no |

`referral` and `not_now` both mean **"chase this, it is not a deal yet"**:

- a **referral** names somebody who has not written to us — *"Colleen is the best person
  to manage roof repairs"*
- **not now** names a date that has not arrived — *"at the moment we don't need these,
  but keep us in mind"*

They count as interested on every tile because the question a tile asks is *who is worth
a follow-up*, and both are. They never reach HubSpot because the question a deal asks is
*who is a live opportunity*, and neither is one yet. One column, two readers, two
different questions.

### Why this is one flag and not a third bucket

The Not-interested tile is computed as `responded − interested`. Given a third bucket
beside `interested`, that subtraction would have quietly filed every referral as a
refusal — **and the parts would still have added up**, which is exactly what would have
stopped anybody noticing.

Widening the `interested` flag inside `response_people()` keeps the arithmetic correct
by construction. Verified after the change: 7 interested + 14 not interested = 21
responded.

There was also a hard constraint. `v_invariants` selects `response_counts()` into an
explicit five-column list, and `response_counts` reads `response_people`. Adding a
column to either would have broken the one view whose job is to catch silent drift of
this kind.

### SunFlow: why this section exists

`mike@sunflow.ca` replied *"Colleen is the best person to manage roof repairs. Call /
text my cell anytime."* Filed as Interested, it produced a deal named **SunFlow Solar &
Exteriors [Outbound]** — named after the company that had just declined and pointed
elsewhere. The lead is Colleen, who has no reply row and will get her own deal correctly
when she writes. The deal was deleted by hand.

---

## 4. The phrase rules

Thirteen patterns, checked in priority order, **first match wins**. The quoted thread is
stripped first by `reply_text()` — our own outbound copy ("Would this be useful to
you?", "Book a call with me") sits inside every reply body and would otherwise match
every interest rule, including on refusals.

| Pri | Sentiment | Catches |
|---|---|---|
| 10 | `auto_reply` | Subject declares itself an autoresponder |
| 20 | `auto_reply` | Out of office, away until, on leave |
| 30 | `auto_reply` | Retirement autoresponder |
| 40 | `not_interested` | Says not interested in as many words |
| 50 | `not_interested` | Asks to be removed from the list |
| 60 | `not_interested` | "Not what we do", wrong person |
| 65 | `not_interested` | Already has a supplier, under contract |
| **66** | **`not_now`** | **Postpones without refusing** |
| 70 | `interested` | Asks a price, a sample, more detail |
| 75 | `interested` | Asks what it costs, ballpark, quote |
| 80 | `interested` | Offers or asks for time |
| 90 | `interested` | Says it sounds interesting |
| **100** | **`referral`** | **Hands us to a named colleague** |

**No match means no opinion.** `guess_sentiment()` abstains rather than guessing, the
row stays `unclassified`, and nothing reaches HubSpot until a person looks. That
abstention is the safety valve that makes a fully automatic push tolerable — it fired 11
times out of 49 on the labelled history.

**`not_now` sits at 66, after every refusal.** Brenden Foster wrote *"at the moment we
don't need these services but we will keep you in mind for the future."* The refusal in
the first half is the more reliable half; a soft door at the end does not undo it. An
explicit no still wins, and 66 catches only replies that postpone without refusing.

**The interest patterns are the loose ones.** "more information", "can you send",
"pricing" are ordinary words. The refusal and autoresponder rules run first and win
ties, which bounds the damage, but false-positive deals will come from priorities 70–90
and not from anywhere else.

**A human label is never overwritten.** The update trigger fires only on
`UPDATE OF body, subject`, so changing a sentiment does not re-run the labeller, and the
labeller skips `classified_by = 'human'` regardless.

### Accuracy when it shipped

On the 49 human-labelled replies: **37 agree, 11 abstain, 1 disagrees** — and in that one
the machine is right (subject "Automatic reply: DBHMS + QEA", empty body, filed by hand
as not_interested). On the 40 real prospect replies: **37 right, 0 wrong, 3 abstained.**

That is 40 replies and one day of life. `v_rule_accuracy` and `v_rule_disagreements`
measure it against every human label; look at them before trusting the number above.

---

## 5. What happens, in order

```
A reply arrives at Instantly
        ↓
sync pulls it (every 30 min) → ingest_replies()
        ↓
BEFORE INSERT trigger → guess_sentiment() → labels it, or abstains
        ↓
   [ if abstained: waits as `unclassified` until a person clicks ]
        ↓
sentiment = 'interested'
        ↓
same sync run, last step → pushInterested()
        ↓
 1. who is interested and has no deal recorded?   (recomputed from scratch)
 2. whose is it?     campaign → group → owner → HubSpot owner id
 3. find the contact by email, or create one
 4. does this company already have an open deal?  → adopt it, stop
 5. create the deal, attach the contact, log the reply
 6. write the deal id down — this person is now finished forever
```

Steps 1 and 2 are database reads. Steps 3–5 are HubSpot. Step 6 is the only thing that
makes a lead stop being a candidate.

---

## 6. Creating it exactly once, forever

Creating a deal is easy. Creating it **exactly once**, across a job that runs every
thirty minutes and is allowed to die halfway through, is what the design is about.

### There is no queue

The obvious shape is a list of pending work, crossed off as it goes. Queues lose work: a
row crossed off before the write lands is lost, and a row crossed off after is a
duplicate when the process dies between the two.

So nothing is ever crossed off. `hubspot_pushes` holds **one durable fact per person** —
*this person has a deal, and here is its id* — and the question is recomputed in full
every run:

> interested, and no `deal_id` here yet.

Every failure mode then heals itself with no special handling:

| What happens | What the next run does |
|---|---|
| Run dies after 10 of 30 leads | The other 20 have no deal id, so it takes exactly those 20 |
| HubSpot is down for an hour | Two runs do nothing; the third does the work |
| A lead marked interested three weeks ago never went through | It is in **every** run's list until it succeeds — it cannot fall off a list it was never on |
| Crash between HubSpot accepting the deal and us recording it | Step 4 finds the orphan and adopts it instead of making its twin |

That last row is the one gap a table cannot close on its own, and it is why the existing-deal
search is not merely tidiness.

### The table

```
hubspot_pushes
  email            text primary key   -- lowercased; HubSpot matches case-insensitively
  deal_id          text               -- NULL until HubSpot has confirmed it. This column,
                                      -- and only this column, is what "done" means.
  contact_id       text
  deal_name        text               -- what we sent, so a wrong name can be explained
  owner            text               -- later without re-deriving it from a campaign
  campaign_id      uuid               -- that may since have been renamed
  pushed_at        timestamptz
  attempts         integer
  last_attempt_at  timestamptz
  last_error       text
```

Keyed on **email**, not `(campaign, email)` like `people`. A person in two campaigns is
still one person and gets one deal.

RLS on with no policy — service-role only, same posture as `app_users`.

---

## 7. Not duplicating Mark's hand-made deals

Step 4 asks whether this company already has an **open** deal. A won or lost deal is
finished, and a new reply is a new opportunity; any other stage means a live conversation
is already open.

It checks the person first, **then anyone else at the same company domain.**

The widening is not neatness. Mark's `Excel Roofing [Outbound]` hangs off
`info@excelroofing.ca` — a generic inbox he created the same day — while the person who
actually replied is `osedki@excelroofing.ca`. Asking only about the replier finds
nothing and builds him a second Excel deal.

**The cost was accepted knowingly.** At a large company, two people replying about two
different buildings are two real opportunities, and this suppresses the second. On a list
of roofing contractors that is a good trade. **If this is ever pointed at an enterprise
list, narrow it back to the person.**

**Public mail domains are excluded** — gmail, outlook, yahoo, icloud, and the Canadian
ISPs (telus.net, shaw.ca, rogers.com, bell.net, sympatico.ca, videotron.ca) among others.
Without that list every Gmail lead would adopt a stranger's deal. This is not
hypothetical: `canroof5@telus.net` is in the data.

---

## 8. What the deal looks like

```
SunFlow Solar & Exteriors [Outbound]

Pipeline    Sales Pipeline        (default)
Stage       1-First contact       (78274900)
Owner       Mark Dolan            (from the campaign group)
Amount      empty
Close date  empty
Contact     Mike McCann · mike@sunflow.ca
Activity    their reply, logged at the time they sent it
```

### The name

`{Company} [Outbound]` — matching the convention already in the portal. It takes the
company name **exactly as it arrived** and adds nothing.

`dealName()` in `hubspot.ts` is the only place a deal may be named, it is pure string
concatenation, and `hubspot_test.ts` fails if it drifts.

Mark's hand-made names are not uniform: he shortened "Excel Roofing & Solar" to "Excel
Roofing", added a word for "Al Pro Solutions Roofing", and used both `[Outbound]` and
`[outbound]`. Which of those he would have done for a new company is not a rule anybody
can write down, so this does the one thing that is the same every time and a human
renames the odd one in two seconds.

### No amount, no close date

Both are guesses at first contact. A guessed close date is the worse of the two: it
lands in somebody's forecast as though a person had meant it. Mark's own outbound deals
carry no amount either.

### The reply, logged on the deal

Without it the deal is a company name and nothing else, and the salesperson has to open
Instantly to find out what the person said.

It is logged as `INCOMING_EMAIL`, which sets **Last Activity Date** to when they actually
wrote. It deliberately does **not** set **Last Contacted** — that field means the last
time *we* contacted *them*, and nobody has, from inside HubSpot. Leaving it empty is the
truthful answer, and it fills in on its own the first time a salesperson emails or calls
from HubSpot.

Logging the *outbound* campaign sends would populate it, using Instantly's record of
them. Considered on 14 Sep and declined as not worth the extra call.

Failure to log the reply does not fail the push: a deal without its transcript is worth
much more than no deal.

### Owners

Four salespeople in **one** portal (account 6296540), not four connections. The campaign
group's `owner` string maps to a HubSpot owner id:

| `campaign_groups.owner` | HubSpot owner id |
|---|---|
| `Justin` | 158678802 |
| `Mark Dolan` | 379554204 |
| `Mark Vasu` | 1459998522 |
| `Tanay` | 93245804 |

Hardcoded in `hubspot.ts`, deliberately. These change when somebody joins or leaves,
which is also when a human must decide whose campaigns are whose; a lookup table would
let that decision be skipped and a campaign land silently on nobody.

> **A second, inactive "Mark Dolan" exists as 942182461. Not that one.** A deal filed to
> a deactivated owner disappears from every view its owner would look at.

**A campaign with no group has no owner, and is skipped rather than filed wrongly.**

---

## 9. The go-live floor, and the backfill

`HUBSPOT_GO_LIVE = 2026-09-14T00:00:00Z` in `index.ts`.

Every reply ever marked interested satisfies "interested and has no deal", and most are
months old and were dealt with by hand long ago. Without a floor, the first scheduled run
after switch-on would empty that entire history into the pipeline in one pass — which may
well be wanted, but is a decision somebody makes on purpose, not a side effect of turning
the schedule on.

`?only=<email>` overrides the floor, because the whole point of naming one person is that
they are historical.

**The backfill is the same code with `?since=1970-01-01`.** As measured on 14 Sep, after
the referral relabelling:

```
considered 14 · would create 7 · would adopt 7 · failed 0
```

Nine of the pending creations belong to **Mark Vasu**, whose Instantly invite was never
accepted (`accepted: false` since 30 July) — so he cannot see any of these replies in
the tool they arrived in.

**This has not been run. It is the one decision still open.**

---

## 10. Failure behaviour

**It never throws.** A HubSpot outage costs the sync this step and nothing else — no
number on the dashboard comes from here. Each lead is independent, so one bad row does
not abandon the rest.

**Rate limits.** HubSpot meters its *search* endpoints per second, separately from the
daily allowance, and the limit is low enough that a queue of nineteen leads trips it —
two failed this way on the first full dry run, each lead costing two or three searches.
Now: 1s/2s/4s/8s backoff on 429 and 5xx, and 350 ms between leads. A 429 is not a
failure, it is the server asking for a moment. Anything else raises at once — retrying a
400 just sends the same broken request three times.

> This is the ugliest kind of bug: it appears only when there is a backlog, which is
> exactly when the push matters and exactly when nobody is watching it run.

**Failures are recorded, not hidden.** `attempts` and `last_error` on the row. But a lead
that fails every time retries every thirty minutes forever and **tells nobody** — those
two columns are where to look when you suspect it. There is no alerting and no attempt
ceiling; a cap invented before the first real failure would be a guess about a failure
nobody has seen.

**A dry run writes nothing**, failures included. It wrote them once, which is a preview
altering the thing it previews. Fixed the same day.

**Relabelling after a push does nothing.** `interested → not_interested` on a reply whose
deal already exists leaves the deal alone. `hubspot_pushes` dedupes by email, so it never
re-pushes and never retracts. Deleting a deal in HubSpot does not bring the lead back
into the queue — the row still records the push. To genuinely re-push, delete the row.

---

## 11. Running it by hand

All calls need the service-role or anon key as a bearer token; it is in Vault as
`SYNC_INVOKE_TOKEN`.

```bash
BASE=https://yfnqszwlyoyfhuwfmcyl.supabase.co/functions/v1/sync
TOK=<anon or service-role key>

# preview what a scheduled run would do — writes nothing
curl -X POST "$BASE?mode=hubspot&dry=1" -H "Authorization: Bearer $TOK"

# preview the full backfill — writes nothing
curl -X POST "$BASE?mode=hubspot&dry=1&since=1970-01-01" -H "Authorization: Bearer $TOK"

# push one named person, ignoring the go-live floor
curl -X POST "$BASE?mode=hubspot&only=mike@sunflow.ca" -H "Authorization: Bearer $TOK"

# run the backfill for real
curl -X POST "$BASE?mode=hubspot&since=1970-01-01" -H "Authorization: Bearer $TOK"
```

`mode=hubspot` pulls nothing from Instantly. It still opens a `sync_runs` row, because
the point of that table is that every invocation is accounted for.

**A dry run is honest.** It asks HubSpot both real questions — does this person exist,
and does this company already have an open deal. An earlier version skipped both and
reported seven creations where four were adoptions; a preview that has to be distrusted
is worse than none.

```bash
# the deal-name test
deno test --allow-net supabase/functions/sync/hubspot_test.ts

# deploy
supabase functions deploy sync --project-ref yfnqszwlyoyfhuwfmcyl
```

Useful SQL:

```sql
-- everything pushed, and everything stuck
select email, deal_id, owner, attempts, last_error from hubspot_pushes order by pushed_at;

-- who is in the queue right now
select r.lead_email, r.sentiment, r.received_at from replies r
where r.sentiment = 'interested'
  and lower(r.lead_email) not in (select email from hubspot_pushes where deal_id is not null);

-- what the rules would say about a reply, and which rule said it
select r.lead_email, r.sentiment, g.sentiment as rule_says, rr.note
from replies r
left join lateral guess_sentiment(r.subject, r.body) g on true
left join reply_rules rr on rr.id = g.rule_id
where r.lead_email = '...';

-- are the rules any good yet
select * from v_rule_accuracy;
select * from v_rule_disagreements;
```

Editing a rule is a SQL insert or update on `reply_rules`; **there is no UI for it.**
`reclassify_replies()` re-reads history after an edit and only ever asserts — it never
blanks an existing label and never touches a human's.

---

## 12. Credentials

**HubSpot service key**, created 14 Sep 2026. Not a legacy private app — HubSpot moved
private apps to Legacy Apps that day and says plainly they will not receive new scopes or
platform support.

- Name: `QEA Campaign HQ` — no person's name in it, so it survives anyone leaving
- Scopes, and nothing else:
  `crm.objects.contacts.read`, `crm.objects.contacts.write`,
  `crm.objects.deals.read`, `crm.objects.deals.write`
- Stored in Supabase Vault as `HUBSPOT_TOKEN`, read through the same `get_secret()` RPC
  the Instantly key uses. Never in code, never in git.
- Does not expire.

It is **not** a user account, and the deals it makes are not attributed to whoever created
the key. Ownership is the `hubspot_owner_id` field, set per deal.

> Measured, not assumed: with only those four scopes the key can also write `emails` and
> `notes` engagement objects (both returned 201; `companies` correctly returned 403).
> Broader than the scope list suggests. The reply logging depends on it.

---

## 13. What was verified, and how

Every claim below was run, not reasoned about.

| Check | Result |
|---|---|
| Token reads contacts / deals / is denied companies | 200 / 200 / 403 |
| SunFlow — create, reuse an existing contact | deal created, contact 213051550736 reused |
| Lactalis — create under a **different** owner, new contact | deal 65033138097, owner **Justin Kim** |
| Iron Shield — already has a deal | **adopted** 64338373555, created nothing |
| Re-running the same push | `considered: 0` — one deal in HubSpot, not two |
| Excel Roofing, after domain matching | **adopted**, no duplicate |
| Rate limiting, 19 leads | 0 failed (was 2) |
| Rules on the deleted false positive | **abstain** on rashmi@wolfenburg.ca |
| Tiles still sum after widening the flag | 7 + 14 = 21 |
| `v_invariants` | clean (one unrelated Aug bounce warning) |
| Production-shaped `mode=incremental` run | `ok`, 4,349 rows, no errors |

Deals created and then deliberately deleted during testing: Wolfenburg Roofing (false
positive from the Instantly flag) and SunFlow (referral). Both removed with their logged
replies; Wolfenburg's contact was removed too, SunFlow's was left because it predates us.

---

## 14. The files

| Path | What it is |
|---|---|
| `supabase/functions/sync/hubspot.ts` | The push. `dealName()`, `needDeals()`, `pushInterested()` |
| `supabase/functions/sync/hubspot_test.ts` | The deal-name test. `deno test` |
| `supabase/functions/sync/index.ts` | `HUBSPOT_GO_LIVE`, `mode=hubspot`, the call at the end of an incremental run |
| `…/20260914120000_one_deal_per_person_and_the_row_that_proves_it.sql` | `hubspot_pushes` |
| `…/20260914121500_a_run_that_pulls_nothing_is_still_a_run.sql` | `sync_runs.mode` accepts `hubspot` |
| `…/20260914140000_the_phrases_that_say_what_a_reply_means.sql` | `reply_rules`, `guess_sentiment`, the triggers |
| `…/20260914173212_a_lead_worth_chasing_is_not_yet_a_deal.sql` | `referral` / `not_now`, the widened flag |
| `app/replies/page.jsx` | Five label buttons instead of three |

Commits: `80c7479` (the push and the migrations), `35c069f` (carried the `/replies`
buttons in alongside the thread-rendering work, since both sessions edited that file).

---

## 15. Open, and known limits

**Open decisions**

1. **The backfill.** 7 creations, 7 adoptions, 0 failures, verified by dry run, not run.
2. **Mark Vasu cannot log into Instantly.** Invite never accepted since 30 July. Nine of
   the pending backfill deals are his.

**Known limits, in the order they are likely to bite**

- **The rules are one day old** and now write to a CRM with no human in between. 40
  replies is the whole evidence base. Watch `v_rule_accuracy`.
- **No UI for editing rules.** Every phrase change is a SQL statement.
- **A permanently failing lead retries forever and tells nobody.** `attempts` and
  `last_error` are the only trace. No alerting by choice.
- **Domain matching will suppress a legitimate second deal** at a large company. Correct
  for roofing contractors; wrong for an enterprise list.
- **Interest patterns are loose.** False positives will come from priorities 70–90.
- **Whatever sets Instantly's interest flag is still unidentified.** It no longer
  triggers anything here, but it moves numbers on the dashboard.
- **`looksAutomatic()` in `index.ts` is now dead weight** — the trigger overrides it.
  Harmless, left in place, not worth a deploy of its own.
