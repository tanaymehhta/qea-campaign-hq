# Campaign 02 — SAFE / Reliable Owners Reachout

**This is the single source of truth for this campaign. Everything gets tracked and updated here — status, decisions, results, next actions. If it isn't written here, it didn't happen.**

*Created: 2026-07-15 · Last updated: 2026-08-03 · Owner: Tanay · Status: **Ranked list built (Step 1–3 done). Pre-enrichment.** Contacts are name+address only so far; no emails/phones enriched, nothing sent. **Next: Step 3b — harvest the +1,023 free names from full filing history before spending on enrichment.***

---

## What this campaign is

The counterpart to Campaign 01 (UNSAFE). Where Campaign 01 chased buildings in **distress** (UNSAFE + unpaid fines + deadline), this campaign chases the opposite profile: buildings whose owners **take compliance seriously** — latest FISP status **SAFE**, **zero fines**, and a track record of filing **on time, cycle after cycle**.

The logic: these owners already budget for facade compliance, hire engineers on schedule, and never let it lapse. They are the reliable, paying, low-friction audience — the right pool for a **phone-first** reachout.

**The reachout is a phone-call list.** You asked to be able to call each person, ordered so the most reliable are at the top.

## The reliability filter (your "database" = the DOB fine columns)

There is no separate database — the signal lives in three columns already in the source CSV:

- `LATE_FILING_AMT`, `FAILURE_TO_FILE_AMT`, `FAILURE_TO_CORRECT_AMT` → the **fines**. "Not paying fines" = all three $0.
- `PRIOR_STATUS` + `CYCLE` → **history**. "Consistently doing it" = SAFE this cycle *and* SAFE prior cycles.
- `FILING_DATE` → filed **on time**.

## How the list was built (the process)

1. **Extract** every SAFE building from `../DOB_NOW__Safety___Facades_Compliance_Filings.csv`.
2. **Dedupe** to one row per building (BIN), keeping the **latest cycle** filing. (Raw SAFE = 44,003 filings → 11,723 zero-fine filings → **2,119 unique buildings** whose *latest* status is SAFE with zero fines.)
3. **Build a per-building history** across all cycles: how many cycles on record, how many were SAFE, lifetime fines.
4. **Score reliability** (inverse of the UNSAFE urgency score) and rank **most-reliable first**:
   - `Safe_Cycles` × 100 (consecutive SAFE cycles = the strongest reliability signal)
   - prior-cycle SAFE × 50
   - never-fined-ever × 30
   - length of track record × 5
5. **Pull both contact channels** from the CSV for free: **QEWI engineer** (name, firm, license, address) and **owner** (name, business name, address). Emails/phones come next, via enrichment.

## The numbers

| Metric | Count |
|---|---|
| Unique buildings (latest SAFE, zero fines) | **2,119** |
| — also SAFE prior cycle (repeat-compliant) | 703 |
| — never fined across any cycle (lifetime clean) | 2,047 |
| — with a QEWI engineer name (Channel A) | 2,071 |
| — with an owner name (Channel B) | 2,067 |

**By borough:** Manhattan 1,239 · Brooklyn 324 · Bronx 321 · Queens 224 · Staten Island 11.

**By SAFE-cycle streak:** 5 cycles 59 · 4 cycles 302 · 3 cycles 580 · 2 cycles 619 · 1 cycle 559. The top of the list (5→4 streaks) is the sharpest ~360 buildings.

## Contact concentration — THE key strategic fact

One name covers many buildings, and the two channels concentrate very differently. **This determines enrichment order and call order.**

| Channel | Reach 50% of buildings | Reach 80% | Buildings per person |
|---|---|---|---|
| **Engineers (QEWI)** | **top ~32 names** | **top ~92 names** | 8.2 avg / 3 median |
| **Owners** | top ~140 names | top ~620 names | 2.1 avg / 1 median |

**The engineer channel is ~7× more efficient per dial.** Cumulative engineer coverage: top 10 = 25% · top 20 = 39% · top 50 = 62% · top 100 = 83% · top 150 = 91%.

Owners have a long tail: **735 of 999 owners hold exactly one building** (single-purpose LLCs). Enriching that tail is the worst cost-per-contact in the set, and single-building LLCs are the least likely to hold a capital budget for an energy scan.

**Why the shapes differ.** QEWI is a small licensed profession — a few hundred people sign every facade filing in NYC, each carrying a portfolio. Owner records list one signatory per ownership entity, so portfolios collapse to a single name while the majority of buildings sit in their own one-off LLC.

**Bigger leverage than this campaign shows:** the 253 engineers on this list sign for **14,650 distinct NYC buildings** across all facade filings (37,768 filings, all statuses) — ~58 buildings each, not 8. One engineer relationship spans this campaign *and* Campaign 01's UNSAFE list.

## Name inventory — what we have vs. what exists

**We do not have all the names.** The build kept one row per building (latest cycle) and discarded every earlier filing — and those rows carry names. The 2,119 buildings have **9,768 filings total** (4.6 each); 7,649 name-bearing rows were dropped.

| | In the sheet today | Available in the source CSV | Free gain |
|---|---|---|---|
| Engineers | 253 | **732** | **+479** (2.9×) |
| Owners | 999 | **1,543** | **+544** (1.5×) |
| **Total distinct names** | **1,250** | **2,273** | **+1,023** |

Quality split of the free adds:

- **+479 engineers** — 396 at firms not yet on the list, 40 colleagues at firms already held (warm path), 43 ambiguous. All are prior QEWIs *on our own buildings*, so all are relevant.
- **+544 owners** — only **186 are a different person at the same owner entity** (a real second contact, highest value). **332 are at a different entity** = the building changed hands, so these are prior owners and mostly stale. 26 ambiguous.
- **Honest high-value free total: ~665 names** (479 engineers + 186 same-org owners).

**Context:** the full CSV holds 2,200 distinct QEWIs. We hold 11.5% of NYC's QEWI population today; 33% after the history pull.

**Beyond the CSV (UNCONFIRMED — needs a sample test):** HPD registration for the 1,376 owner entities should name head officer + managing agent, ~2–3 each. Not yet verified for these BINs.

| Source | Names | Status |
|---|---|---|
| In sheet today (deduped) | 1,250 | confirmed |
| + full filing history (free, CSV) | 2,273 | **confirmed** |
| + HPD owner registrations | ~4,000–5,000 | estimate only |

## Data-quality flags (open)

1. **The tabs overcount people.** `By_Engineer` has 321 rows but **253 unique people**; `By_Owner` has 1,048 rows but **999 unique people**. The extras are case/whitespace variants of the same name (e.g. `Nicholas Ferrara` vs `Nicholas  Ferrara`; Lloyd Valdez appears at rank 1 *and* rank 3). Normalize before counting or enriching — otherwise we pay twice for the same person.
2. **NYCHA is 169 buildings (8%)**, all at 24-02 49th Ave, behind **4 signatory names**. Three names (Valdez, Morrison, Patel) carry ~220 buildings across NYCHA labels. Public housing, procurement-gated — almost certainly not the buyer. **Decide whether to segment out**; it changes the denominator.
3. **`"PR"` is a junk owner business name** appearing on 119 buildings across unrelated owners. Not a company. Do not group on it.
4. **48 buildings have no name on either channel**; 4 have an engineer but no owner. **Effective reachable universe is 2,071, not 2,119.**

## The working file

`Campaign02_SAFE_Reliable_2119.xlsx`
- **Summary** — counts, borough split, reliability-streak split.
- **Ranked_Targets** — one row per building, ranked most-reliable first. IDENTITY (BIN, address, borough) → RELIABILITY (`Reliability_Score`, `Safe_Cycles`, `Prior_Safe`, `Cycles_On_Record`, `Lifetime_Fines`, `Filing_Date`) → OWNER contact → QEWI contact → BUILDING (wall type/material) → empty TRACKING columns (`Owner_Email`, `Owner_Phone`, `QEWI_Email`, `QEWI_Phone`, `Channel`, `Outreach_Status`, `Last_Contacted`, `Replied`, `Meeting_Booked`, `Notes`). Top-100 rows are shaded gold.

## The pitch (different from Campaign 01)

SAFE buildings have **no deadline and no fine pressure** — the UNSAFE urgency script does not apply. The angle is **energy / Local Law 97**: "Your facade passed FISP — but LL11 only checks falling hazards, not efficiency. QEA's drone scan finds where the building leaks energy, ahead of LL97 carbon penalties." Same two contacts, reliability-framed script.

## Data management rules (same as Campaign 01)

1. **Naming.** Every file self-describes: `Campaign02_<scope>_<contents>`. No `final`, no `_v2`.
2. **File Index is mandatory** (below). Not in the index = shouldn't exist.
3. **This README is the log.** Every step/decision/result gets a dated Changelog entry.
4. **Status lives in the sheet, narrative lives here.**
5. **Master CSV is read-only.** Pull from it, never work in it.
6. Close Excel before Claude writes to a file.

## File Index

| File | Purpose | Updated |
|---|---|---|
| `README.md` | This tracker — process, numbers, concentration, name inventory, data-quality flags, rules, changelog | 2026-08-03 |
| `Campaign02_SAFE_Reliable_2119.xlsx` | **THE DATA.** Tabs: Summary, Ranked_Targets (2,119 buildings, ranked, both-channel names + empty tracking/contact columns). | 2026-07-15 |

## Plan / next actions

- [x] **Step 1–3 — ranked list built** (2026-07-15). 2,119 buildings, most-reliable first, both-channel names from CSV.
- [ ] **Step 3b — NEW, do this before any paid enrichment.** Re-extract *all* filing history for the 2,119 BINs (not just latest cycle) to harvest the **+1,023 free names** (+479 engineers, +544 owners). Tag each as `Current` / `Prior-QEWI` / `Same-org-second-contact` / `Prior-owner-stale`. Cost: zero.
- [ ] **Step 3c — normalize names** across both directory tabs (321→253, 1,048→999) so we don't enrich duplicates.
- [ ] **Step 3d — decide on NYCHA** (169 buildings, 4 names): keep or segment out.
- [ ] **Step 4 — enrich contacts top-down** (needs Apollo + HPD). **Engineer channel first** — top 150 engineers reaches 91% of buildings; owners need ~620 names for the same 80%. Prioritize **phone** coverage (this is a call list). Enrich in waves (top 300 first). Test HPD on a 20-entity sample before committing to the owner tail.
- [ ] **Step 5 — build the phone-ordered call sheet** (mirror Campaign 01's Call Sheet): one row per person to dial, most-reliable buildings first, with their building list + LL97 talking points.
- [ ] **Step 6 — run the reachout**, log calls/replies in the Ranked_Targets tracking columns.

## Changelog

- **2026-08-03 (concentration analysis + name-inventory audit)** — Audited the two directory tabs against `Ranked_Targets` and the source CSV. Three findings, all now written up above. **(1) Concentration:** engineers reach 50% of buildings in ~32 names and 80% in ~92; owners need ~140 and ~620. Engineer channel is ~7× more efficient per dial — enrichment order should be engineer-first, and the owner tail (735 single-building LLCs) is the worst spend in the set. Also measured that the 253 engineers on this list sign for **14,650 distinct NYC buildings** across all statuses (~58 each), so an engineer relationship is worth far more than this campaign alone. **(2) We do not have all the names:** the latest-cycle dedupe discarded 7,649 name-bearing filing rows. Re-reading full history for the same 2,119 BINs yields **732 engineers (+479) and 1,543 owners (+544)** — 2,273 total vs 1,250 today, at zero cost. Of the new owners only 186 are same-entity second contacts; 332 are prior owners after a sale and are mostly stale. Added as **Step 3b**, ahead of any paid enrichment. **(3) Data quality:** tab row counts overstate people (321→253 engineers, 1,048→999 owners) due to case/whitespace name variants — must normalize before enriching or we pay twice; NYCHA is 169 buildings behind 4 names and needs a keep/drop decision; `"PR"` is a junk owner business-name value on 119 unrelated buildings; 48 buildings have no name on either channel, so the reachable universe is 2,071. HPD expansion to ~4,000–5,000 names remains an **estimate** — flagged as needing a 20-entity sample test before we plan against it. No enrichment run, nothing sent.

- **2026-07-15 (directory tabs + enrichment pass)** — Added **By_Engineer** (321 rows) and **By_Owner** (1,048 rows) tabs, each with buildings-carried counts (reconcile to 2,071 / 2,067), firm/license/business address from the CSV, case-variant duplicate flags, and empty email/phone/LinkedIn columns. **Seeded 75 engineers** with verified email/phone/LinkedIn reused from Campaign 01 (free). **Apollo enrichment** of the top unseeded engineers: matched 12 more real-firm engineers (9 verified emails, 7 firm phones, 12 LinkedIn), auto-rejecting wrong-country false positives (e.g. Nicholas Ferrara matched an Australian architect — discarded). **Engineers with ≥1 contact now: 94 / 321.** Learnings confirmed from Campaign 01: Apollo indexes engineers at established firms but not solo QEWI shops (match rate fell to ~20% in the tail); owners are mostly single-purpose LLCs / institutional (top "owner" = NYCHA) and need the HPD named-officer route, not blanket Apollo. No phone-reveal (direct-dial) tool is available in this connector, so phones captured are firm mainlines. **Still to do:** engineer tail via Exa/firm-site chase; owner enrichment via HPD + Apollo on management firms.

- **2026-07-15 (campaign created + ranked list)** — Built Campaign 02 from the source CSV. Filtered to latest-status SAFE + zero fines, deduped to 2,119 unique buildings, scored by reliability (SAFE-cycle streak, prior-SAFE, lifetime-clean, track-record length), ranked most-reliable first. Pulled both-channel contact **names + addresses** from the CSV (QEWI 2,071; owner 2,067). No enrichment yet — emails/phones and the call sheet are the next step. Nothing sent.
