# Handoff — Overview dashboard, the response→meeting funnel

Written 20 August 2026, end of session; **amended the same evening** — see §2 and §5b,
where "People reached" stopped being Instantly-only. Everything below is measured against
the live Supabase project `yfnqszwlyoyfhuwfmcyl`, not inferred from code.

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
| `abda53b` | `reached_people` / `reached_counts` — People reached becomes a headcount of humans across **both** tools. The tile said 1,839 and its own click opened 2,393. T4 in `TRUST_OPEN.md`. |
| *(this session)* | Opened becomes people over people: `23.5% / 351`, where the tile said `6.3% / 225` and its click opened 351. Opens are a column on the reached pile, not a pile of their own. T5. |

Migrations: `20260820120000` (the definition), `20260820160000` (the lemlist rescue),
`20260820180000` (the rep move), `20260820200000` (people reached, both tools).

**Live numbers, all time, all reps, scraped from the tiles:**

```
People reached    2,393   =  1,839 Instantly + 554 lemlist
People who opened   351   =  23.5% of the 1,491 who could register one
Total responses      32   =  16 interested + 16 not interested
Interested           16   =  50% of the 32 who replied
Meetings booked       5   (4 distinct people — still unfixed, §5a)
```

Every one of those is a headcount of humans from both tools, and every one opens onto
exactly the people it counted. Meetings is the last that is not.

Two of those moved after the body of this handoff was written and neither is a bug in the
code:

- **People reached 1,839 → 2,393.** The 554 are lemlist, they were always in `people`, and
  the click had been opening them the whole time. §5b and `TRUST_OPEN.md` §7.
- **Responses 31 → 32, interested 15 → 16.** Tanay labelled Ken Day (Irvcon, "Re:
  Retirement") **interested** at 15:32 on 20 Aug, where §5c below had proposed Automatic.
  Worth a second look — the message is a retirement notice — but it is a human label and
  nothing may overwrite it without asking him.

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
reached_people(p_from date, p_to date, p_campaigns uuid[], p_source text)
-- one row per person ever emailed: id, campaign_id, source, email, name, company,
--   status, sent_count, opened_count, clicked_count, replied_count, bounced,
--   can_open, first_contacted_at (corrected — see below), last_contacted_at
reached_counts(same args)      -- people, instantly, lemlist, opened, trackable

response_people(p_from date, p_to date, p_campaigns uuid[], p_source text)
-- one row per person: lead_email, lead_name, company, sources[], labels[], msgs,
--   first_at, last_at, responded, interested, needs_label, robot_only
response_counts(same args) -- people, responded, interested, needs_label, robot_only
```

- `p_from`/`p_to` are **inclusive New York calendar dates**; NULL = unbounded. They match
  `v_daily_facts.metric_date`, which is why the window boundaries are not UTC.
- `p_source`: `'instantly'`, `'lemlist'`, or NULL for both. **Every tile uses NULL now.**
  It defaults to `'instantly'` on the response pair and to NULL on the reached pair: the
  Instantly default existed to protect a rate's denominator, and `reached_people` **is**
  that denominator.
- **Opens and clicks are columns on this pile, not piles of their own.** `/list` filters
  `opened_count > 0` on the same rows the tile counted; `can_open` is
  `open_tracking is distinct from false`, which is the only honest denominator for a rate —
  902 of the people we reached are in campaigns with no pixel and can never register one.
  A scope with `trackable = 0` prints `—` and says so, never `0%`.
- `reached_people` dates a person by `least(stored first contact, earliest surviving send)`.
  Instantly's API never exposes first-touch — the sync writes `timestamp_last_contact` —
  so before the 6 Aug trigger a July person could be stored as 4 August. The `least` cuts
  the misdated cohort from 1,171 people to 423. All-time totals are exact either way;
  lemlist's dates were always exact. Full measurement in `TRUST_OPEN.md` §7.
- `p_campaigns`: NULL = everything the anon key can see. A rep's scope is resolved to
  campaign ids first — `campaignIdsForRep()` in `lib/db.js` is the only thing that should
  know a rep owns groups rather than campaigns.
- `security invoker` on purpose. RLS already hides hidden campaigns from anon; a
  `security definer` read here would leak 58 rows the dashboard has never been allowed to
  see.

Call them **only** through `lib/db.js`:

```js
reachedCounts(scope)                     // -> {people, instantly, lemlist}
responseCounts(scope)                    // -> {people, responded, interested, needs_label, robot_only}
responsePeople(scope, {pile, limit, offset, tag, search})
PILES                                    // responded | interested | not_interested | needs_label | all
pileArgs(scope)                          // the four RPC args, so /list builds them the same way
```

There is deliberately **no** `reachedPeople()` helper: `/list?metric=contacted` calls the
RPC itself through `pileArgs`, because it needs the exact count and the status breakdown
too, and two ways into one function is how two definitions start.

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
| `app/list/page.jsx` | Every drill-down. `build()` has one `m.rpc` branch — the only metric whose list is a function, `contacted`. Chain `.select()` **before** `.order()` there. |
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
People reached 2,393  →  Total responses 32  →  Interested 16  →  Meetings 5
```

Each of those four is now a headcount of humans from both tools, and each one opens onto
exactly the people it counted. That was not true of the first tile this morning and is
still not true of the last one (§5a).

**Two things are true about that chain and both need handling honestly:**

1. **It is not a strict funnel.** 2 of the 5 meetings (Krishnan Gowri, Baris Acar) have **no
   reply row at all** — they came from calls or channels outside the sequence. So
   "meetings ⊂ interested" is false, and a funnel chart drawn as nested subsets would lie.
2. **~~`People reached` is Instantly-only.~~ FIXED this session — and the reason it was
   ever true is worth keeping.** lemlist never wrote `new_leads_contacted`: 0 across all
   234 of its campaign-days, which is why every document here says "lemlist never reported
   people reached". That sentence is true of the **daily notebook** and false of the
   **per-person table**, where lemlist's 554 have been sitting since June, dated from its
   own activity stream. Nobody had drawn the distinction, so the front of the funnel stayed
   one vendor short of the responses beside it — and the tile's own click had been opening
   all 2,393 the whole time.

   `reached_counts` now answers it for both tools, and the two lemlist groups that used to
   read **zero** — QEA Resellers 472, LBER 82, both Mark Vasu's — read their real numbers.

   **So a top-of-funnel rate is now computable, and it is still not free.** 32 ÷ 2,393 is
   1.3%, but **2 of the 32 responders are not in the reached pile**: Ben Myers (a LinkedIn
   connection accept — lemlist multichannel, never emailed) and John Forester (replied from
   an address `people` has never held). Both are real answers from real humans. So the
   honest sentence is "32 people wrote back, 30 of them from the 2,393 we emailed", not a
   clean percentage. Decide that wording with Tanay before printing a rate; the Interested
   tile's `16 of the 32 who replied` remains exact because both sides are one pile.

So: a response→interested→meeting progression is honest **within** the responses pile, and
reached→response is now honest to within two named people who came in off-channel — the
same shape as the two meetings that came from calls. A funnel drawn as nested subsets would
still lie at both ends; a funnel that names its leaks would not.

### 5c. ~~One click of housekeeping~~ — done, differently

`1 still to read` was **Ken Day, Irvcon Limited**, 15:10 UTC on 20 Aug via the Roof
Campaign, a retirement notice ("as of April 30, 2025, I am retiring"). This section
proposed **Automatic**. Tanay clicked **Interested** at 15:32, which is why Total responses
reads 32 and Interested 16. `needs_label` is 0 either way. Flagged in §2 for a second look
and left alone: it is a human label.

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

0. **Nothing from this session is half-finished.** T4 shipped whole: definition, tile,
   per-group column, drill-down, docs, 19 scopes and 12 group cells verified. The next
   thing on the Overview is §5a, Meetings.
1. **T1 · `/campaigns` "Reply %"** — the last known-wrong number on the site. Renders
   `pct(replied, leads)` in three places including the sort comparator; `leads` is imported
   list size, and sends-per-lead swings 5× between groups (Chicago 3.8, Mark Dolan 0.7).
   LBER reads 8.0% and ranks first off 87 leads. Decision written and awaiting go —
   `TRUST_OPEN.md` §4. Tanay said campaigns is *not* this session's work.
2. ~~**Q4 · `/list?metric=opened` says 351 against the tile's 225.**~~ **Closed** — T5,
   `TRUST_OPEN.md` §8. Both are 351.
3. **Q1 · `/campaigns` shows `0` opened where tracking is off.** **Half closed by T5**: the
   Overview's per-group column and its rep-scoped tile now say *"No campaign here can
   register an open"*. `/campaigns` still prints `0` on 1,504 Canadian sends across 11
   campaigns that cannot register one. That page reads `v_campaign_summary`, so it needs
   its own fix.
4. **Did the sync drop lemlist replies?** Two replies existed in lemlist's inbox that were
   never in `replies` (Younes 3 Aug, Sherry Chen 20 Jul). That is a *dropped row*, not a
   truncated body. Nobody counted how many. **The API is gone, so this can no longer be
   measured** — it is now a known unknown, recorded here so it is not mistaken for
   completeness.
5. **`/leads` says "SENT 1,536 · Confirmed in Instantly/lemlist".** It is the human
   `status` column off the source spreadsheets, not vendor confirmation — the tools say
   2,393. 49 rows marked `sent` have no send in either tool; 906 people with a real send
   are not marked `sent`; and the three tiles sum to 1,970 against a total of 2,780 because
   810 people were never on a spreadsheet at all. Q7 in `TRUST_OPEN.md` §8. Same family as
   T4, one page over, and the next-largest lie on the site now.
6. **Two "Mark" chips.** `components/ui.jsx:67` renders `r.name.split(" ")[0]`, so Mark Vasu
   and Mark Dolan both read "Mark", separated only by avatar initials and subtitle. More
   confusing now that one owns three of five groups. ~15 minutes.
7. `OUTCOME_PRIORITY` in `app/calls/actions.js:43` contradicts its own comment — see
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
