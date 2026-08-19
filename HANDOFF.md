# Session handoff — 18 August 2026

For the next agent. Written after a visual/UX pass on Campaign HQ.
`main` at `c542e3e` is the only thing from this session that shipped.
Everything else from the pass was reverted so backend work is not sitting on a dirty tree.

Pre-existing untracked docs (not from this session, do not delete): `AUTH_PLAN.md`, `PLAN.md`, `TRUST.md`.

---

## What shipped (on `main`)

**Commit `c542e3e`** — `Overview shows the seven numbers a salesperson actually asks for`

Only `app/page.jsx` changed.

Overview tiles, in this order:

1. Active campaigns
2. People reached (`new_leads_contacted` — first touches, not follow-ups)
3. Emails sent
4. Emails bounced
5. Emails opened
6. Calls logged
7. Meetings booked

Removed from the tiles: LinkedIn sent, LinkedIn accepted, proposals sent, emails replied.

Removed from the by-campaign table: the **LinkedIn accepted** column. “New leads” was renamed **First touches** (hover explains it).

A sales funnel block was built and then rejected. It is not on `main`.

---

## What the product is

Two products share one nav.

**Outbound** — Instantly / lemlist campaigns, meetings, replies, call lists.
**Inbound** — site visitors → research → people → drafts. Pipeline is the ops trace of that machine.

A **campaign group** is what a human calls “a campaign” (Chicago Retrofit, Roof Campaign — Mark Dolan). Inside a group sit **lists** — one Instantly or lemlist campaign each.

---

## Every page (collectively exhaustive)

24 routes. `app/timeline/` is an empty folder, not a page.

### Outbound — campaigns

| Page | URL | Job |
|---|---|---|
| Overview | `/` | Company-wide KPIs. **Shipped tile change lives here.** |
| Campaigns list | `/campaigns` | Every campaign group |
| Campaign group | `/campaigns/[slug]` | One group — progress, people, lists inside |
| Sub-campaign / list | `/c/[id]` | One Instantly/lemlist list — sequence copy, people, replies |
| Leads | `/leads` | Frozen target lists, tagged sent / not sent |
| Replies | `/replies` | Every inbound from the tools |
| Meetings | `/meetings` | Hand-logged meetings |
| Conflicts | `/conflicts` | Tools disagree, or a meeting has no name |

### Outbound — one human

| Page | URL | Job |
|---|---|---|
| Person (email) | `/person/[email]` | One prospect across every campaign. Key is email. Opened from Overview / Leads / Replies / Meetings names. |

### Outbound — calling

| Page | URL | Job |
|---|---|---|
| Calls home | `/calls` | Pick a rep |
| Rep’s lists | `/calls/[rep]` | That rep’s phone campaigns |
| Call workspace | `/calls/[rep]/[campaign]` | One list to dial |

### Inbound — salesperson

| Page | URL | Job |
|---|---|---|
| Inbound queue | `/inbound` | Companies that visited. Queue view only on `main`. |
| Inbound company | `/inbound/company/[id]` | One account — research, people, drafts, restart |
| Inbound person | `/inbound/person/[id]` | One contact. Key is inbound id, not email. |
| Drafts | `/inbound/drafts` | Every draft the pipeline wrote |
| System | `/inbound/system` | Unfiltered inbound funnel |

### Inbound — ops

| Page | URL | Job |
|---|---|---|
| Pipeline log | `/pipeline` | Runs / by company / by person / research / stuck. Still in the top nav on `main`. |
| Pipeline company | `/pipeline/[companyId]` | Same company as inbound, stage/node trace |
| Pipeline person | `/pipeline/person/[personId]` | Older dossier for the same inbound person |

### Shared / ops

| Page | URL | Job |
|---|---|---|
| Number drill-down | `/list?metric=…` | Behind every “see who”. Not in the nav. |
| Inboxes | `/inboxes` | Sending mailboxes |
| Health | `/health` | Sync, caps, drift |
| Feedback inbox | `/feedback` | Submissions from the box on every page |

The three person pages are different objects. Do not collapse them without a decision.

---

## User complaints (original list)

1. **Overview as a salesperson funnel** — reached out → received (bounce) → opened → replied → meetings, plus active campaigns. **Settled:** no extra funnel section. Change the existing tiles. Shipped as the seven tiles above. Replies dropped from the tile row on purpose.
2. **“New leads” / “LI acc.” unclear.** New leads = first touches. LI acc. = LinkedIn accepted. **Settled:** rename first column; remove LinkedIn accepted from the table entirely. Shipped.
3. **Person page** (`/person/[email]`) — show replies to handle, meetings planned, active campaign. User later said the current person page is fine. A “now strip” was prototyped and **reverted**.
4. **Calls (Mark Vasu)** — many people have no phone. Measured: **1,252 people, 74 with a phone, 80 with email.** Missing from the source spreadsheet (`data/Campaign02_SAFE_Reliable_2119.xlsx`), not hidden by the UI. User said “ok”. A “no phone” filter / banner was prototyped and **reverted**.
5. **Inbound restart** — click is silent for seconds, then full reload jumps to the top. Cannot mash several restarts. A client button (instant “Starting”, `router.refresh()`, no redirect) was prototyped. User said “good step ahead”. **Reverted** so inbound backend is untouched. Worth re-doing as its own PR: `restartCompany` should return `{ ok, error }` instead of `redirect`; button should be a client component.
6. **Pipeline** — search companies; row click opens `/inbound/company/[id]`; pipeline should live on inbound. Prototyped as `/inbound?tab=pipeline` and Pipeline dropped from nav. User said “good”. **Reverted.** Pipeline is back in the nav.
7. **Campaign progress bars** — bar = emails sent / emails planned (people × sequence length). Show sent + bounced. Estimated end date (remaining ÷ weekday cap, skip weekends). People reached. Optional N bars, one per sequence email (80/100, 40/100, empty…). Hover: done, pending, end date.
8. **Campaign detail** — show end date when opened. Whole campaigns frontend feels like too much information; don’t know what to focus on.
9. **Leads** — click a name → person page. `PersonLink` already does this when email exists. A full-row click was prototyped and **reverted**.
10. **Replies** — eye hits the person; they want the **campaign** first. Group by campaign, plus ungrouped. Prototyped and **reverted**.
11. **Conflicts** — same: by name, and ungrouped. Prototyped and **reverted**.

---

## Campaigns — current tree and what to do next

This is the next visual job. User likes the pages functionally. They want **less information, more colour, less empty/dull.** A Lovable prompt was written in chat for screens 1–3 only.

```
/campaigns                 all groups
  /campaigns/[slug]        one group
    /c/[id]                one Instantly/lemlist list
```

Live groups: Chicago Retrofit, QEA Resellers, Canada — Justin’s list, Roof Campaign — Mark Dolan, LBER — Boston (ended), Ungrouped (abandoned).

**Progress math (agreed):**
- Planned emails = people × emails in the sequence (`sequence_shape` like `E1 d0 · E2 +7` → count of `E\d+`, or `step_metrics`).
- Bar fill = `sent / planned`. Bounced is a slice of the same bar.
- Sequence bars: `step_metrics.sent` for that step / people on the list.
- End date = remaining emails ÷ sum of `daily_limit` on **running** lists, weekdays only. No cap → cannot date it. Done → say finished.
- People reached ≈ first-step sent (email 1). `campaign_totals.reached` is 0 everywhere; do not trust it.
- Roof Campaign example: 809 people, 5 emails, 545 sent, cap 350/weekday, email 1 = 498, email 2 = 47, emails 3–5 empty, ends ~Tue 1 Sept.

**What each campaign page should keep (salesperson):**
1. List — name, status, owner, people reached/list, progress bar, end date, replies, meetings, bounce. Toggle all-emails vs per-step bars.
2. Group — hero is progress + end date. Then sequence bars. Then replies / meetings / bounce. Then people. Lists inside are secondary, not a spreadsheet.
3. One list — back to group, tool + status + cap, progress, people/replies/meetings, sequence as the main object (copy folded), recent replies.

**Cut from campaign screens:** LinkedIn as a first-class number, proposals as a hero tile, repeating the same stats in tiles and again in a table, the all-groups tab strip as the first thing you see, dumping full email HTML on load.

Design contract is `DESIGN.md`. Today the dashboard is deliberately quiet (warm paper `#f9f9f7`, colour only for decisions). User now wants campaign screens **less dull**: use Instantly `#2a78d6`, lemlist `#eb6834`, good / warn / crit washes on bars and status so live and dead campaigns do not look the same beige. Do not invent a fifth meaning colour. Light default, dark exists.

---

## Facts that are easy to get wrong

- **Phone numbers on Mark Vasu’s list are not in the database.** 74/1252. Do not “fix the UI” by inventing numbers. Source is the SAFE spreadsheet; import preserves hand-edits and only fills blanks.
- **Inbound restart** currently POSTs a server action that `redirect()`s back. That is the scroll-to-top. GitHub dispatch is ~1–2s; the page is silent until then. `inbound_request_rerun` refuses a second press on the same company for ~10 minutes.
- **`/person/[email]`** is outbound. **`/inbound/person/[id]`** is inbound. **`/pipeline/person/[id]`** is the older inbound dossier.
- Open tracking is off on most campaigns. A zero open count is often structural, not failure.
- Bounce on Overview for Instantly is a known honesty problem (`PLAN.md` / `TRUST.md`). Do not “fix” it in the frontend by attributing mailbox bounces to campaigns.

---

## What a backend agent can ignore

`app/page.jsx` on `main` is the only frontend delta from this session. Campaign / inbound / replies / conflicts / calls / pipeline / nav / `globals.css` match pre-session `main` (plus whatever was already there). No new tables, no migrations, no RPC changes from this pass.
