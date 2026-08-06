# Improvement backlog — UI/UX pass

---

## STATUS — executed 2026-08-06, all pushed to main, migrations applied to production

**UI/UX backlog:** 1–6, 8–14 DONE. 7 investigated — not a bug: the campaign is
pre-enrichment per `data/Campaign02_README.md` (steps 3b/4 never ran); as a partial fix,
a web/firm-site enrichment pass added phones/emails for 28 engineers carrying 562 buildings
(dialable 63 → 93, `contact_source = 'firm site / web, Aug 2026'`). Item 12's second half
(the `/inboxes` xlsx sync) is still open — waiting on the file's location.

**Data-layer audit:** A1–A9, A12 DONE. A10 obsolete (the section it described was deleted
in item 2). A11 documentation-only, no action. A13 DONE — `CALLS_FEATURE_PROMPT.md` and this
file are both committed as documentation rather than left untracked.

**Done beyond the backlog:**
- `log_meeting()` + a "Log a meeting" form on /meetings (STATE.md open item 4, the last
  missing write). Loud duplicate refusal, optional group scope, always inserts `booked`.
- Fixed `fill_meeting_identity()` — broken since it shipped (window function in HAVING);
  every meeting insert without an email crashed with 42P20 until 2026-08-06.
- Migrations applied to production and tested: `log_call_creates_meeting`,
  `preserve_first_contacted`, `fix_fill_meeting_identity`, `log_meeting`.

**Branding pass (2026-08-06, later session):** the site footer is now the "Swirl" shader
node from the QEA Tech Paper file, rendered live via `@paper-design/shaders-react`
(`components/mesh-footer.jsx`) — masked along a soft ragged edge so it merges into the page
with no section break, QEA mark (`public/qea-mark.png`) centred on the swirl's eye. Pushed
as `f1504e5` + `57c0f18`. A shader background on the "Leads contacted" hero tile was tried
and removed the same day — restore from `f1504e5` if ever wanted on a card again.

**Mailbox sync (2026-08-06, later session):** item 12b DONE. `email_accounts` was 25 standby
rows across 8 domains; `~/Downloads/Domains and Emails (3).xlsx` (col C = domain, D–G = emails)
carries 73 mailboxes across 23 domains. Upserted every sheet address not already present under
`source = 'instantly'` as `source = 'standby'`, and deleted standby rows absent from the sheet
(0 matched). Result: 73 mailboxes / 23 domains — 13 instantly (still owned by the 30-min sync
edge function, untouched), 60 standby. Missing set was mostly the `qeatechnolog*` /
`qeatechnology*` domain family. No importer script written — one-off export, no schedule; if
this becomes a monthly chore, write one under `scripts/`. The sheet has no warmup / daily-limit
columns, so standby rows carry nulls there.

**Still open:**
1. Item 9 — Inbound rebuild (by-company / by-person toggle, Research view, per-company and
   per-person pages). The only genuinely new UI, and it needs a design decision first.
2. Campaign 02 Step 3b free name harvest — needs the raw filing-history CSV.
3. Owner-channel enrichment via HPD (999 owners, no websites to chase) — needs scoping.
4. Optional: keep grinding the engineer tail (solo shops, ≤13 buildings each).

---

Source: Tanay's screenshot-by-screenshot feedback session, 2026-08-06. Every item below is
independently executable — pick one, do it, verify in the browser, move to the next. Do not
bundle unrelated items into one diff.

**Scope note:** most of this is restyling / decluttering / bug-fixing on top of the existing
page structure — same data, same routes, better layout. **Item 9 (Inbound) is the one exception
that calls for genuinely new UI**: new toggle views, new per-company/per-person pages, and a
research-presentation layer that doesn't exist yet. Everything else is a redo of an existing
card/table, not a new page.

Stack recap: Next.js App Router, plain `.jsx` (no TypeScript), Supabase via `lib/db.js`,
shared components in `components/ui.jsx`, styling in `app/globals.css` (no CSS framework —
class-based, custom properties for theme/color).

---

## 1. "Campaign" should mean the parent campaign, not the sub-campaign

Everywhere the UI shows a field labeled **Campaign** and it's actually rendering the
**sub-campaign** (e.g. "P2 F&B Operational — V1 (Stop Firefighting)" instead of "Lactalis" /
"Justin's campaign" / "Chicago Reseller"), swap it to the parent group name
(`campaign_groups.display_name`, exposed as `group.display_name` / `v_group_summary.display_name`).
The sub-campaign label is still useful but should read as a secondary/detail field, not as the
primary "Campaign" identity.

Known offenders:
- `app/meetings/page.jsx` — `nameOf(id)` (line ~62) returns `sub_campaign_label || name` from
  `v_campaign_summary`, and is shown as **Campaign** both in the meeting summary line (line 139)
  and the detail grid (line 157). Needs to resolve to the group's `display_name` instead — join
  `subs` → `group_id` → `groups` (groups already fetched via `repList()`/`v_group_summary`, or
  add a `db.from("campaign_groups").select("id, display_name")` fetch).
- `app/campaigns/[slug]/page.jsx` meta grid — "Segment" field (see item 10 below) — same fix,
  reuse whatever mapping you build here.
- Anywhere else `sub_campaign_label` is surfaced as a first-class "Campaign" (grep for
  `sub_campaign_label` and `nameOf` across `app/`).

Do this as one small shared helper if it's used in 3+ places (e.g. add a `groupNameOfCampaign`
helper to `lib/db.js`) rather than copy-pasting the join in each page.

## 2. Meetings tab — phone calls section

In `app/meetings/page.jsx`:

- **Filter to booked meetings only.** The "Phone calls" table (lines 182–210) currently lists
  every outcome (voicemail, no answer, etc.). Add a way to see booked-meeting calls only —
  either default the section to `outcome === 'booked_meeting'` with a toggle for "show all
  outcomes," or split into two sections. Confirm with the existing `Pill status={c.outcome}`
  values in `lib/calls.js` / `phone_calls.outcome`.
- **Make rows clickable, same detail as elsewhere.** Right now the phone-calls table
  (lines 187–210) is a flat `<table>` with no drill-down. When a call is tied to a
  `call_contacts` row (via `contact_id`), link the row to that contact's existing detail view —
  the same call history / crib / building list already rendered in
  `app/calls/[rep]/[campaign]/page.jsx` (the `mrow`/`details` block, ~line 243 onward). Don't
  rebuild that detail view; link into it (e.g.
  `/calls/{rep}/{campaign_slug}?open={contact_id}#c-{contact_id}`).
- **Card-ify the phone calls list.** Replace the plain `<table>` with the same
  `.mrow`/`<details>` card treatment used for the meetings list right above it (lines 107–180).
  Add a label on each row: **"Cold Call"** if the call has no `call_campaign_id` /
  no associated campaign, or **"Outbound — {group display_name}"** (parent campaign name per
  item 1, not the sub-campaign) if it does.
- **Delete "Replies waiting to become meetings" entirely** — the whole section (`app/meetings/page.jsx`
  lines 212–251) plus its data fetch (`replies`/`waiting`/`met`/`scopedIds`, lines 46–59). Not
  wanted at all.

## 3. Restyle: call-list group cards (`Mark Vasu — call lists`)

`app/calls/[rep]/page.jsx` (`.gcard` rows, ~line 49–94) — same visual pattern as the Campaigns
page. Too much crammed into the summary row (title, pill, byline, six stat columns, progress
bar note, two buttons). Redo the layout — you're free to restructure (fewer columns visible by
default with the rest in the expanded body, a cleaner stat grid, whatever reads better) but
**keep every piece of information that's currently there**, just laid out with more breathing
room. This same `.gcard` component/CSS is shared with `app/campaigns/page.jsx` — if you fix the
underlying `.gcard`/`.gstats`/`.gfoot` styles in `app/globals.css`, both pages benefit; don't
fork the CSS per page unless the content genuinely diverges.

## 4. Detail ⌄ / Open → button alignment

The "Detail ⌄" ghost button and "Open →" solid button in `.gfoot` (`app/globals.css` line ~240)
sit inside a flex row with `.gbar` (the progress track + a note line below it). Because
`.gfoot { align-items: center }` centers against `.gbar`'s *full* height (track + wrapped note
text), the buttons drift depending on how long the note text is — they're not aligned to the
track/stat row above them. Fix the alignment (e.g. `align-items: flex-end` on `.gfoot`, or pull
the buttons into their own fixed-height row) so "Detail ⌄" and "Open →" sit at a consistent
vertical position regardless of note length. This affects both `app/campaigns/page.jsx` and
`app/calls/[rep]/page.jsx` — one CSS fix covers both.

## 5. Restyle: campaign context card (the long markdown block)

`app/calls/[rep]/[campaign]/page.jsx`, the `Markdown` component render (~line 193–200,
rendering `camp.summary_md` — "WHAT THIS CAMPAIGN IS," "WHO WE'RE CALLING AND WHY," "THE PITCH,"
"OPEN QUESTIONS," etc.). Information is right, presentation is dense/cluttered — currently just
raw `<h2>`/`<p>`/`<ul>` stacked in one card. Redo the visual structure (section cards, better
spacing/typography hierarchy, maybe a two-column layout for short sections) without dropping any
content or changing what's stored in `summary_md`.

## 6. Contact avatar color should reflect call status, not be static grey

`app/calls/[rep]/[campaign]/page.jsx` line ~257: every contact row's `.glyph` circle is
hardcoded to `background: "var(--tint-n)"` (neutral grey) regardless of outcome. The page
already computes `statusOf(ct)` (line 167: `dnc` / `never_called` / last call outcome). Map that
to a color:
- never called / no answer → grey (`var(--tint-n)`)
- left voicemail / left email / follow up → blue (`var(--tint-1)`, matches the `active`/`assigned`
  category blue used elsewhere)
- booked meeting → green (`var(--tint-3)` / the `--good`/`--cat-4` outcome hue)
- not interested / dnc → could stay neutral or use the "closed" tint — check
  `components/ui.jsx`'s `CAT_OF` mapping (line ~90) for the established 4-category palette
  (`--cat-1..4` / `--tint-1..5`) and reuse those hues rather than inventing new colors, so this
  stays consistent with the rest of the app's color language.

## 7. Investigate: why do so many contacts have no phone number?

Not necessarily a bug — likely a data-completeness gap. In `app/calls/[rep]/[campaign]/page.jsx`,
the call list defaults to `ct.phone || ct.email` (line 156), and campaign `summary_md` content
for at least one list (NYC LL11) notes "Only ~63 of 1,250 people have any contact detail so far,
and the phones are firm mainlines, not direct dials" pending "the free name harvest and the
enrichment wave." Before treating this as a UI bug: check `call_contacts` in Supabase for how
`phone`/`email` get populated (import script under `scripts/`, or an enrichment step referenced
in `summary_md`/`STATE.md`/`README.md`), and confirm whether the enrichment pass has actually
been run for the campaigns in question. If it's a pending data step, this isn't a code fix —
flag it back to Tanay with what's blocking it (which import/enrichment step needs to run).

## 8. Add a row number column

Wherever there's a long list of names with no visible count-so-far (call lists, leads table,
people tables, etc.), add a simple `#` / serial-number column so it's clear how many rows deep
you are. `components/ui.jsx`'s `PeopleTable` (line 232) and the call-list `.mrow` map
(`app/calls/[rep]/[campaign]/page.jsx` line 243) are the two most obvious places — a plain
`i + 1 + offset` in the loop is enough, no new data needed.

## 9. Inbound — full rebuild (the one item that's genuinely new UI)

Current state: `app/inbound/page.jsx` + `app/inbound/[companyId]/page.jsx` (backed by
`lib/inbound.js`) render the research **pipeline trace** — stage-by-stage node execution,
costs, errors, LangSmith links. That's an engineering/debugging view. What's wanted is a
**sales-facing** view of the same underlying data (`inbound_companies`, `inbound_people`,
`inbound_visits`, `inbound_webhook_events`, `inbound_emails`, `inbound_intent_signals`,
`inbound_buildings`, `inbound_compliance_hits` — see `lib/inbound.js` for the full schema
already being queried).

Build:
1. **Two toggled views at the top of `/inbound`: "By company" and "By person."** A simple
   toggle/tab control (reuse the `Seg` component pattern from `components/ui.jsx`), not two
   separate pages. Each view is a wide, information-dense table (reuse the horizontal-scroll
   pattern already in `app/inbound/inbound.css` / `.ib-scroll` — the user explicitly wants
   scroll-to-see-more-columns, not truncation) showing the raw RB2B intake as it exists in
   Supabase right now — this is largely what `app/inbound/page.jsx`'s "Accounts" and "New from
   RB2B" tables already do (lines 49–134); the toggle mainly needs a genuine per-person table
   (query `inbound_people`/`inbound_visits` directly) alongside the existing per-company one.
2. **A separate "Research" view/tab** — this is new. Per company and per person, present what
   the pipeline actually produced in a readable (not cluttered) way: for a company, the
   buildings/compliance hits/intent signals already fetched in `companyDetail()`
   (`lib/inbound.js` line 102); for a person, their role/title/email status and **up to 3 draft
   emails** (`inbound_emails` rows scoped to that person — `companyDetail()` currently fetches
   `emails` by company only, at line 114; you'll need to filter/group by person, likely via
   whatever FK `inbound_emails` has to `inbound_people`).
3. **A page per company and a page per person.** Company page: list of people at that company,
   click through to each person. Person page: research notes + up to 3 draft emails for that
   person, presented as read content, not as a pipeline log. These can replace or sit alongside
   `app/inbound/[companyId]/page.jsx` — you decide whether the existing pipeline-trace view
   becomes a secondary "Pipeline" tab on the company page or is dropped from the primary nav
   entirely (Tanay didn't say to delete pipeline visibility, just that the current *primary*
   view is wrong).

This is open-ended on the "how do I show research on a person" question — Tanay explicitly said
"that's what we have to discuss and decide." Don't guess silently on the notes/presentation
format if it's ambiguous; check in before committing to a layout, since this is the one item
worth a real design pass rather than a quick restyle.

## 10. Restyle: Campaigns page detail card

`app/campaigns/page.jsx` (`.gcard`, expanded body ~line 147–189) and
`app/campaigns/[slug]/page.jsx` (meta grid ~line 166–176):
- **Detail ⌄ / Open → alignment** — same bug as item 4, same fix.
- **Drop "List source"** — remove the `List source` row from the meta grid entirely
  (`app/campaigns/page.jsx` line 157, `app/campaigns/[slug]/page.jsx` line 174).
- **Drop "Sequence" (the shape string, e.g. `E1 d0 · E2 +7 · E3 +14 · E4 +15`), replace with a
  plain "No. emails" count** — just `Sequence: 4` (however many steps `sequence_shape` encodes;
  count the `E{n}` segments rather than showing the full timing string). Applies to
  `g.sequence_shape` wherever it's rendered (`app/campaigns/page.jsx` line 156,
  `app/campaigns/[slug]/page.jsx` line 171).
- **Replace "Segment" with the campaign (group) name** — per item 1, `Segment` currently shows
  `g.segment` (a targeting description like "Property mgmt, facilities, ops, engineering,
  leadership"); Tanay wants the parent campaign name shown instead — likely means: drop the
  `Segment` field from this grid (it's redundant with the page's own H1/title, which is already
  the group name) rather than literally repeating the title in a field. Confirm the intent is
  "remove Segment" rather than "put a second copy of the campaign name here" — the field is
  already inside a page titled by the campaign name, so plumbing it into "Segment" would be
  redundant. If in doubt, drop `Segment` and free the space.
- **The blue/red on the campaigns list is unclear to the user** — this is the `.gbar` split-fill
  progress bar (`app/campaigns/page.jsx` lines 119–141): blue segment = sent minus bounced
  (`toolColor(g)`, blue for Instantly / orange for lemlist per `--s1`/`--s2`), red segment =
  bounced count, both as a fraction of `maxSent`. It currently has no legend. Either add one
  (small inline key: "sent" / "bounced," plus which color = which tool) or reconsider whether a
  two-color unlabeled bar is worth keeping given nobody can read it without asking.

## 11. Leads page — multi-select campaign filter + visual polish + missing pie chart

`app/leads/page.jsx`:
- **Multi-select campaign filter, not a single-select toggle.** The `<div className="seg">`
  group picker (lines 99–105) currently does `?group=slug`, one at a time (`activeGroup`,
  singular, line 41). Change to accept multiple groups (e.g. `?group=slug1,slug2` or repeated
  query params) with an "All" option, and update the data-fetch logic (`countWhere`,
  `activeGroup`-scoped queries around lines 44–64) to aggregate over the selected set instead of
  exactly one group.
- **The search input looks plain — restyle it.** Line 114–120, a bare `<input type="search">`.
  Give it real visual treatment consistent with the rest of the app (icon, focus state, etc.) —
  check if `frontend-design` skill guidance is useful here for a from-scratch pass, this isn't
  copying an existing pattern.
- **"Why is there no pie chart in the last 2 campaigns?"** — This is `ShareDonut` in
  `components/ui.jsx` (line 121–123): `if (rows.length < 3) return null` — the donut only
  renders when there are 3+ non-zero status buckets. Smaller/newer campaign groups (e.g.
  "LBER — Boston" at 84 people, "Canada — Justin's list" at 404) likely have leads concentrated
  in only 1–2 statuses (e.g. everything still `prospect`), so the donut silently disappears.
  This is a deliberate rule in `ShareDonut`, not a bug — decide whether to lower the threshold,
  show a simpler indicator (e.g. a single stat) when under 3 categories, or leave it and tell
  Tanay why it's blank. Don't just patch it without understanding why the threshold exists (see
  the comment above `ShareDonut`, lines 104–120, about a 2-slice donut being "a worse way of
  writing one number").

## 12. Replies page — table, not stacked cards; and sync `/inboxes` from the latest mailbox export

`app/replies/page.jsx`:
- Every reply currently renders as its own full-height `<div className="card">` (lines 58–81) —
  no click target, nothing collapses, which is why "when I click on it there's nothing." Rework
  into an actual table (or the collapsible `.mrow`/`<details>` card pattern used on Meetings/
  Calls, whichever reads better for a list this long) so the list is scannable at a glance, with
  full message body available on click/expand rather than every row already fully unrolled.

`app/inboxes/page.jsx`:
- Tanay shared `Domains and Emails (3).xlsx` (in Downloads) reflecting the current state of
  mailboxes/domains in InboxKit (73 mailboxes across 23 domains as of the export). Check whether
  `email_accounts` in Supabase is stale relative to that file/InboxKit's live state — if so this
  is a **data sync task**, not a UI change: find or write the import path that keeps
  `email_accounts` current (check `scripts/` and `supabase/functions/sync` for the existing sync
  mechanism before writing a new one) rather than manually re-typing the spreadsheet into the
  UI.

## 13. Health page — group by parent campaign, drill into sub-campaigns

`app/health/page.jsx`, "Capacity" table (lines 50–71): currently one row per sub-campaign
(`c.sub_campaign_label || c.name`, from `v_campaign_summary`/`campaigns`). Change the primary
list to one row per **campaign group** (parent), aggregating cap/sent-today across its
sub-campaigns, with a click-through to see the sub-campaigns underneath — this mirrors the
Campaigns page's group → sub-campaign drill-down (`app/campaigns/page.jsx` →
`app/campaigns/[slug]/page.jsx`), so reuse that pattern rather than inventing a new one.

## 14. Homepage — sync the "last N days" chart to the range picker, drop empty weekends

`app/page.jsx`:
- The "Last 14 days" chart (`DailyBars`, line 224–225) is **hardcoded** to the trailing 14
  calendar days (`chartFrom = shift(t, -13)`, lines 69–79) regardless of what's selected in
  `RangePicker` above it (`w.range` — today/7/30/90/all, lines 120–129). Make the chart respond
  to the picker: when `7 days` is selected, chart shows 7 days; `30 days` → 30 bars; etc. Default
  to 7 days per the request ("default — last 7 days").
- **Add a second, synced toggle directly above the chart** — a duplicate of the range control
  (or the same `RangePicker`/`Seg` component instance) placed right above `DailyBars`, wired to
  the same `w.range` state via the same URL param, so changing either toggle updates both.
- **Drop weekend columns when they're always empty.** In the `perDay` construction (lines 71–75)
  and `DailyBars` render (`components/ui.jsx` lines 297–331), filter out Saturday/Sunday columns
  — check `d.date` (a `YYYY-MM-DD` string) against day-of-week before adding to `perDay`, or
  filter the array passed to `DailyBars`. Confirm this only skips *display*, not the underlying
  send totals (weekday totals shouldn't silently absorb or drop weekend sends — weekend sends
  are already ~0 per the "always empty" premise, but verify before assuming).

---

## Cross-cutting notes for whoever executes this

- Items 4 and 10's alignment fix and item 3's `.gcard` restyle touch the same shared CSS
  (`app/globals.css` `.gcard`/`.gstats`/`.gfoot`/`.ghost`/`.chev`) used by both
  `app/campaigns/page.jsx` and `app/calls/[rep]/page.jsx` — do that one together, not twice.
- Item 1 (campaign vs. sub-campaign naming) is the one with the widest blast radius — grep for
  `sub_campaign_label` before starting to catch every occurrence, not just the ones listed here.
- Item 9 is the only genuinely new page/IA work. Everything else should be a diff against an
  existing file, not a new route.
- After each item, actually load the page in a browser and check both the collapsed and
  expanded states — several of these bugs (misaligned buttons, missing donuts) only show up in
  specific data conditions (long note text, <3 status buckets, etc.), not in every screenshot.

---

# Codebase audit — gaps, disconnects, and bugs (data layer)

**This is a separate list from the UI/UX backlog above.** The backlog above came from Tanay's
screenshot-by-screenshot feedback session. Everything below is from **Fable's own full-codebase
audit, 2026-08-06** — every page, `lib/db.js` + `lib/calls.js` + `lib/inbound.js`, all three
`actions.js` files, all 22 migrations, and `supabase/functions/sync/index.ts` were read. These
are data-layer and cross-section connection issues, not restyling. Each item is independently
executable.

## How this codebase works (read this before touching anything)

- **Stack:** Next.js 14 App Router, plain `.jsx`, React server components everywhere (the only
  client components are the nav, theme boot, and count-up). Data comes from Supabase via the
  shared anon-key client in `lib/db.js`. No ORM, no API routes — pages query PostgREST
  directly and forms post to server actions.
- **The write pattern (non-negotiable):** the site has no login. Every table has RLS with a
  select-only policy for `anon`. **All writes go through `security definer` Postgres functions**
  that validate their own arguments and are granted to `anon` — see `classify_reply()` in
  `20260728234500_conflicts_and_human_classification.sql` and `log_call()` in
  `20260803160000_calls_hardening.sql` for the canonical shape. A new write = a new migration
  in `supabase/migrations/` (timestamp-prefixed filename, banner comment explaining *why*,
  `set search_path = public`, explicit `grant execute ... to anon, authenticated` at the end).
  Never write to a table directly from a server action.
- **Migrations are applied to production Supabase by hand** (CLI or dashboard SQL editor) —
  the repo is not linked to Vercel locally; the Next app deploys from GitHub push to `main`.
  Test each new function the way STATE.md records: valid case, invalid enum, nonexistent id,
  and a direct `PATCH`/`INSERT` with the anon key that must change zero rows.
- **The error-handling pattern for server actions** is `done()` in `app/calls/actions.js`:
  never throw. On error, redirect back to the page with `?err=<message>` so the rep reads the
  database's sentence in a banner instead of a crash screen; on success, `revalidatePath` on a
  *decoded* path (the form carries `/calls/Mark%20Vasu/…` and `revalidatePath` matches real
  pathnames — an encoded path silently matches nothing). Reads are never cached: the shared
  client forces `cache: "no-store"` on every fetch, and every page exports
  `dynamic = "force-dynamic"`.
- **Two worlds share one database.** The *email* world: `campaigns` / `campaign_groups` /
  `people` / `activities` / `replies` / `daily_metrics`, filled by the sync edge function
  every 30 min from Instantly + lemlist. The *phone* world: `call_campaigns` /
  `call_contacts` / `phone_calls`, filled by hand-import and the Calls workspace. They meet
  only where the code deliberately joins them. `meetings` and `proposals` are hand-kept and
  belong to the email world's pages.

---

## A1. The headline disconnect: "Booked a meeting" in Calls never becomes a meeting

**Context.** The primary KPI of the whole dashboard is the `meetings` table (schema at
`20260728152635_core_schema.sql:170` — columns: `id`, `campaign_id` *(nullable)*, `group_id`
*(nullable)*, `prospect_name`, `prospect_email`, `company`, `meeting_date`, `status`
booked/held/no_show/cancelled, `evidence` tool/calendar/crm/chat, `logged_by`, `note`,
`created_at`). It feeds the Overview hero tile (`app/page.jsx`), the Meetings page, every
campaign card, and `/list?metric=meetings`.

The Calls workspace (`app/calls/[rep]/[campaign]/page.jsx`) has an outcome checkbox
**"Booked a meeting"**. Ticking it calls `log_call()` (latest definition:
`20260804120000_call_outcomes_voicemail_email.sql`), which inserts a `phone_calls` row with
`outcome = 'booked_meeting'` — **and nothing else**. The `meetings` table never hears about it.

**Consequence.** The Calls workspace tile "Meetings booked" (computed in `lib/calls.js`
`callStats()` from `phone_calls` outcomes) shows 1; the Overview "Meetings booked" hero tile
(from `meetings`) stays where it was, forever. Two tiles with the same label, different
sources, guaranteed to disagree. STATE.md open item 4 says "no way to log a meeting from the
dashboard" — but the Calls UI now *looks* like a way to log one, which is worse than missing:
the rep reasonably believes they logged it.

**Fix.** One migration that `create or replace`s `log_call()` (copy the **latest** body from
`20260804120000` — it has the 7-outcome enum and the one-minute dedup guard; do not copy the
older 5-outcome versions), adding after the `phone_calls` insert:

```sql
if p_outcome = 'booked_meeting' then
  insert into meetings (prospect_name, prospect_email, company, meeting_date,
                        status, evidence, logged_by, note)
  select ct.full_name, ct.email, ct.org_name, p_call_date,
         'booked', 'chat', nullif(trim(coalesce(p_rep,'')),''), v_note
    from call_contacts ct where ct.id = p_contact;
end if;
```

Notes a new agent will otherwise trip on:

- `campaign_id` and `group_id` stay **null** — call campaigns are not email campaigns and
  there is no FK between the two worlds. A null-campaign meeting is legal (the schema allows
  it) but interacts with item A2 below — do A2 in the same session or the new meeting will be
  invisible in some scoped views.
- The dedup guard `return`s *before* the insert, so a double-submit also skips the meeting
  insert — no extra guard needed. But add one anyway for the meeting itself
  (`if not exists (select 1 from meetings where prospect_email = ... and meeting_date = ...)`)
  because `log_call` dedups only within a one-minute window and a meeting double-logged an
  hour apart would otherwise inflate the KPI.
- `edit_call` / `delete_call` (`20260804130000_call_edit_delete.sql`) will **not**
  retro-update or remove the meeting row. That is an accepted limitation — say so in the
  migration comment. Fixing a wrongly-logged meeting stays a Conflicts/manual job.
- You need `ct.email` and `ct.org_name`, which the current `select ... into v_name, v_label`
  doesn't fetch — either widen that select or use the inline `select` shown above.
- Verify: log a call with only "Booked a meeting" ticked → one `phone_calls` row AND one
  `meetings` row; Overview hero tile moves; triple-submit within a minute → still one of
  each; invalid outcome still rejected; direct anon `INSERT` into `meetings` still blocked.

## A2. Group-only meetings vanish from the /list drill-down

**Context.** `meetings.campaign_id` and `group_id` are independently nullable. A meeting can
be logged against a group with no campaign (this is how hand-logged meetings sometimes
arrive), and after A1, against neither. The Overview scopes meetings by **either** —
`app/page.jsx:63-65`:
`(m) => !myGroupIds || myGroupIds.has(m.group_id) || myGroupIds.has(groupOf.get(m.campaign_id))`.
But the drill-down behind that tile, `/list?metric=meetings&rep=…` or `&group=…`, scopes with
`q.in("campaign_id", scopeIds)` only (`app/list/page.jsx:107`) — `scopeIds` is a list of
*campaign* ids resolved from `campaignIdsForRep()` / `campaignIdsForGroup()` in `lib/db.js`.

**Consequence.** A meeting with `group_id` set and `campaign_id` null is counted by the
Overview tile and absent from the list you reach by clicking that tile — the exact
"tile and list disagree" failure this drill-down system was built to prevent.

**Fix.** In `app/list/page.jsx`, the scope resolution already knows the group: `campaignIdsForGroup`
returns the group row, and for `sp.rep` the groups are fetched inside `campaignIdsForRep`.
Extend both helpers (or the page) to also carry the matching **group ids**, then in the
`meetings` branch of `build()` replace the shared `q.in("campaign_id", scopeIds)` with a
PostgREST or-filter:

```js
q = q.or(`campaign_id.in.(${scopeIds.join(",")}),group_id.in.(${groupIds.join(",")})`);
```

(UUIDs need no quoting in PostgREST `in.()` lists. Leave the other four table branches on the
plain `campaign_id` filter — only meetings has a `group_id`.) The unscoped case (no rep/group/
campaign param) needs no change. Verify by inserting a test meeting with only `group_id` set:
Overview tile and `/list?metric=meetings&group=<slug>` must both count it. Delete the fixture.

## A3. Meeting counts use two different status rules

**Context.** `v_campaign_summary` counts `status in ('booked','held')` only
(`20260728152702_views_and_rls.sql:39`); `v_group_summary` sums it and inherits the rule.
These feed `/campaigns` cards and `/c/[id]` tiles. Meanwhile the Overview (`app/page.jsx`),
`/meetings`, and `/list?metric=meetings` count **every** row regardless of status — including
`cancelled` and `no_show`.

**Consequence.** The moment any meeting is cancelled, the campaign card and the Overview
disagree by one, permanently.

**Fix.** Pick one definition and apply it everywhere. Recommended: **count `booked` + `held`**
(a cancelled meeting is not a KPI). That means a migration is *not* needed — the views are
already right; change the three JS read sites instead:
- `app/page.jsx` — add `.in("status", ["booked","held"])` to both meetings queries (the
  `all`-range one and the windowed one).
- `app/meetings/page.jsx` — keep showing all rows in the detail list (seeing a cancellation is
  useful there) but compute the tile/`countFor` numbers from booked+held only. Label the list
  so the difference is explained ("N booked or held · M cancelled/no-show shown below").
- `app/list/page.jsx` meetings branch — either filter to booked+held, or (better, matches the
  page's existing pattern) leave rows unfiltered and rely on the status breakdown donut; but
  then the tile→list count mismatch remains, so filtering is the honest option. Add
  `q.in("status", ["booked","held"])` unless `sp.status` asks otherwise.

## A4. Feedback filed from a Calls page loses the rep

**Context.** The feedback box sits in the layout on every page. `origin()` in
`app/feedback/actions.js:16-25` reads the `Referer` header and extracts
`u.searchParams.get("rep")` — correct for `/` and `/meetings`, which carry `?rep=`. But the
Calls section identifies the rep **in the path**: `/calls/Mark%20Vasu/nyc-ll11-safe`. So
feedback from the one section where a rep is always identified files with `rep = null`.

**Fix.** In `origin()`, after the query-param read, fall back to the path:

```js
const m = u.pathname.match(/^\/calls\/([^/]+)/);
const rep = u.searchParams.get("rep") ?? (m ? decodeURIComponent(m[1]) : null);
```

`/calls` alone (the roster page) has no rep segment — the regex correctly yields null there.
Verify: submit feedback from a rep's workspace page and check the row on `/feedback` shows
the rep.

## A5. Conflicts actions still show a crash screen on a rejected write

**Context.** STATE.md documents discovering that a thrown server-action error shows the rep a
stack trace instead of the readable sentence the database raised, and fixing it — but only
for Calls (`done()` in `app/calls/actions.js` redirects with `?err=`). The original two
writes, `classifyReply` and `recordMeetingDetail` in `app/conflicts/actions.js:21,33`, still
`throw new Error(error.message)`.

**Fix.** Mirror the `done()` pattern: on error,
`redirect(`/conflicts?err=${encodeURIComponent(error.message)}`)`; on success, keep the
existing `revalidatePath` calls and redirect to `/conflicts`. Then render the banner: the
page component (`app/conflicts/page.jsx`) currently takes no props — change to
`Conflicts({ searchParams })` and copy the `sp.err` warning card from
`app/calls/[rep]/[campaign]/page.jsx:183-190` (same classes, same "dismiss" link pointing at
`/conflicts`). No migration needed — the database functions are fine; this is presentation.

## A6. "Leads contacted" is mislabelled for Instantly rows

**Context.** The `contacted` metric (`METRICS` in `lib/db.js`) windows `people` on
`first_contacted_at` and its note promises "first touch per person — the moment they entered
a sequence, not a follow-up." The sync (`supabase/functions/sync/index.ts:314`) sets
`first_contacted_at: l.timestamp_last_contact ?? last` — Instantly's **last** contact — and
the upsert (`onConflict: "campaign_id,email"`) overwrites it every run. lemlist rows are fine:
`refresh_lemlist_people()` rebuilds them from the activity stream with a true minimum.

**Consequence.** A windowed "contacted today" list includes Instantly people first contacted
months ago whose *follow-up* went out today. The number reads as new-lead flow but partially
measures follow-up flow.

**Fix.** Stop the overwrite at the database, so no future writer can reintroduce it: one
migration adding a trigger on `people`:

```sql
create or replace function public.preserve_first_contacted() returns trigger
language plpgsql as $$
begin
  new.first_contacted_at := least(
    coalesce(old.first_contacted_at, new.first_contacted_at),
    coalesce(new.first_contacted_at, old.first_contacted_at));
  return new;
end $$;
create trigger people_preserve_first before update on public.people
  for each row execute function public.preserve_first_contacted();
```

`least()` keeps whichever timestamp is earlier, which is also correct for the lemlist rebuild
path. **Know the limitation and write it in the migration comment:** Instantly never exposes
historical first-touch, so rows already corrupted stay corrupted — the trigger only stops
further drift. Do not attempt a backfill; there is nothing to backfill from. (The
`activities` stream only holds each Instantly lead's most recent send, same vendor gap.)

## A7. Dead instruction on the Conflicts page

`app/conflicts/page.jsx:158` — the needs-review card says "if it is a booked call, log the
meeting from the Meetings page." The Meetings page has no logging form (that is STATE.md open
item 4). Minimal honest fix: reword to "…log the meeting — for now that means a hand-written
row in the meetings table" or drop the clause. Real fix: a "Log a meeting" form + a
`log_meeting()` security-definer function, which belongs with open item 4 and pairs naturally
with A1's migration. Don't build it as a drive-by; it needs the same test discipline as the
other writes.

## Smaller items

- **A8. Phone calls are invisible on the person hub.** `/person/[email]`
  (`app/person/[email]/page.jsx`) joins people, activities, replies, and meetings by email —
  but never the phone world. `phone_calls` itself has **no email column**; the join is
  `call_contacts.email = <email>` → `phone_calls.contact_id = call_contacts.id` (exclude
  `deleted_at is not null` rows, same as every other phone_calls read). A person emailed by a
  campaign *and* called from the Calls list currently shows half their history. Add a query +
  a "Calls" section (table shape: date · outcome pill · rep · note — same columns as the
  workspace history table). Note `call_contacts.email` is nullable and not unique across
  campaigns; match with `.eq("email", email)` and collect all matching contact ids.
- **A9. The Overview "Calls logged" tile links to `/meetings`** (`app/page.jsx:221`) — a
  leftover from before `/calls` existed (the tile predates the section; see commit
  `c94b3f3`). Point `href` at `/calls`. The note "not scoped to a rep" stays true and stays.
- **A10. "Replies waiting to become meetings" silently truncates.**
  `app/meetings/page.jsx:50-59` fetches `limit(120)` newest replies, *then* filters out
  auto-replies already handled by `.neq`, already-met emails, and other reps' campaigns, then
  slices to 40. Once total reply volume passes ~120, older still-waiting replies drop without
  a trace. Cheap fix: raise the fetch limit to 500 (replies are small rows) and add a note
  when the fetch came back full ("oldest shown: <date> — older replies not checked"). The
  fully correct fix (server-side anti-join) is not worth it at current volume.
- **A11. `logCall` partial failure.** `app/calls/actions.js:50-68` posts one `log_call` RPC
  per checked outcome and returns on the first error, so a failure on outcome #2 leaves
  outcome #1 committed. Acceptable: the one-minute dedup guard makes "fix the input and
  resubmit all boxes" safe (already-logged outcomes are swallowed). Documenting it here so
  nobody "fixes" it into a transaction wrapper the pattern doesn't need.
- **A12. `pct(part, whole, digits)` in `lib/db.js:52` ignores `digits`** — always rounds to
  one decimal. Either honor it (`Math.round(10**digits * ...) / 10**digits`) or drop the
  parameter. Grep callers first: nothing currently passes `digits`, so dropping it is the
  smaller diff.
- **A13. `CALLS_FEATURE_PROMPT.md` is untracked at the repo root** — the build spec for the
  Calls feature, which shipped. Decide: commit it as documentation (it is a good record of
  intent) or delete it. Don't leave it untracked where the next `git status` reads as
  someone's half-finished work.

## Suggested order of attack

1. **A1 + A2 + A3 together** (one session): they are all "what does a meeting count as and
   where" — doing them separately risks re-introducing a mismatch each time. A1 is the
   migration; A2/A3 are JS-only.
2. **A6** — one small migration, stops ongoing data corruption; earlier is strictly better.
3. **A4, A5, A9, A12, A13** — small mechanical fixes, each an independent diff.
4. **A7, A8, A10** — need small product decisions (wording, section layout, limit), fine to
   batch with the UI backlog above.

Nothing here is architectural. The one-database / no-second-table / validating-function
discipline held everywhere it was checked; every gap is at a *semantic* join — two features
using the same word ("meeting", "contacted", "rep") for two different columns.
