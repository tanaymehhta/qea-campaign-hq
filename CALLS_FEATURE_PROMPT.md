# Prompt for Claude Code — add a Calls section to QEA Campaign HQ

Run this from `/Users/tanaymehta/Desktop/QEA Tech/Growth and Marketing/qea-campaign-hq`.

---

## Paste this

Read `README.md`, `STATE.md` and `DESIGN.md` first. They explain how this app works, what is
true right now, and the visual contract every new page has to honour. Follow them — especially
DESIGN.md, because there is no Tailwind and no component library here, only classes in
`app/globals.css`. Do not add a CSS framework, a state library, or a component kit.

I want a new **Calls** section: a place where a salesperson works a phone list, sees all the
context for that campaign in one screen, and logs what happened on each call.

### The shape of it

Four levels, each one click deeper:

1. `/calls` — **names only.** A list of reps, each with their call-campaign count and a couple
   of headline figures. Nothing else on this page. No login — clicking a name is how you say
   who you are, exactly like the existing `?rep=` picker on Overview and Meetings.
2. `/calls/[rep]` — **that rep's call campaigns**, as cards. Follow the card treatment already
   used on `/campaigns`.
3. `/calls/[rep]/[campaign]` — **the workspace.** This is the page that matters. Three regions,
   stacked:
   - **Context** — what this campaign is, who we're calling and why, the pitch, and the
     open questions. Prose, rendered from a `summary_md` column so it can be edited without a
     deploy.
   - **Data summary** — the campaign's own numbers as tiles (see "Metrics" below), plus the
     call-progress figures. Every tile links to the filtered list beneath it, the same way
     every number on this dashboard already opens the people behind it.
   - **The call list** — one row per person, ordered so the best call is at the top.
4. A contact expands in place using native `<details>`, per DESIGN.md. Do not build a modal.

### One row is one person, not one building

This is the important modelling decision. The source list is 2,119 buildings but only ~1,250
distinct people, because one engineer can carry 63 buildings. A rep dials Christopher Krepcio
**once**, not 60 times. So:

- Row = person. Columns: name, role (engineer / owner), org, phone, email, buildings carried,
  best building rank, call status, last outcome, callback date.
- Expanding the row reveals: their full building list (address, BIN, borough, reliability
  score), their firm details and licence, and the full history of calls logged against them.
- Sort default: buildings carried, descending. That is the whole strategic point of this list —
  the top 32 engineers reach 50% of the buildings, the top 92 reach 80%.

### Answering "how do both dashboards stay in sync"

They stay in sync by **not being two things.** There is one Postgres database. The Overview
page already has a Calls tile reading `phone_calls` (commit `c94b3f3`). Do not create a second
call-logging table. **Extend `phone_calls`** — add `contact_id`, `rep`, and `callback_date`
columns — so that a call logged in the new workspace is the same row the Overview tile counts.
Nothing to reconcile, nothing to sync, no way for the two pages to disagree. Say so in a
comment in the migration, because the instinct to add a parallel table is strong and wrong.

### Schema

Three new tables plus the `phone_calls` extension. Write it as one migration in
`supabase/migrations/`, following the naming and commenting style of the existing ones.

```
call_campaigns
  id, slug (unique), display_name, description, objective,
  owner            -- rep name, matches campaign_groups.owner convention
  source_file      -- where the list came from, for provenance
  summary_md       -- the Context panel, markdown
  status, created_at

call_contacts
  id, call_campaign_id -> call_campaigns
  source_key           -- stable dedupe key, unique with call_campaign_id
  full_name, role ('engineer'|'owner'|'other')
  org_name, license_no
  phone, email, linkedin
  city, state, zip
  buildings_count, buildings jsonb   -- [{bin, address, borough, rank, score}]
  best_rank            -- their best building's rank, for ordering
  contact_source       -- how we got the phone/email, e.g. 'Campaign 01 (verified)', 'Apollo'
  dnc boolean default false
  dnc_reason text
  callback_date date
  created_at, updated_at

call_contact_edits          -- audit trail for hand-corrected details
  id, contact_id, rep, field, old_value, new_value, created_at

phone_calls  (ALTER, do not replace)
  + contact_id -> call_contacts (nullable — existing rows have none)
  + rep text
  + callback_date date
```

Keep `phone_calls.campaign_label` as free text. Existing rows predate this feature and some
calls happened outside any campaign in the database; do not backfill or constrain them.

RLS: `public read` on all new tables, matching the existing policies. **All writes go through
`security definer` functions** — this is the established pattern in this codebase and the only
reason the app can be write-capable without a login. Read `app/conflicts/actions.js` and the
`classify_reply()` / `record_meeting_detail()` functions first, then mirror them:

- `log_call(contact_id, rep, call_date, outcome, note, callback_date)` — validates the outcome
  against the existing enum, validates the contact exists, inserts into `phone_calls`.
- `set_contact_dnc(contact_id, rep, reason)` — retires a name from every list.
- `update_contact_detail(contact_id, rep, field, value)` — whitelist `field` to
  phone / email / linkedin only. Writes the change **and** an audit row to
  `call_contact_edits`. A rep who finds a direct dial on a call must be able to save it, and
  the next person must be able to see who changed it and when.
- `set_callback(contact_id, rep, date)`.

Each function must reject an invalid argument with a clear message, the way the existing two
do. Test each one the way `STATE.md` records the last write path being tested — valid case,
invalid enum, nonexistent id, and a direct `PATCH` with the anon key that must change zero rows.

### Metrics for the Calls section

Not the same as Overview's email funnel — these are call metrics. Same tile format, same
`Tile` and `DrillCell` components in `components/ui.jsx`.

Top row: **Calls made · People reached · Meetings booked · Follow-ups due**
Second row: **Never called · No answer · Not interested · Buildings covered · Do-not-call**

Two of these need definitions written into the code as comments, because they are easy to get
wrong later:

- **People reached** = distinct contacts with at least one call whose outcome is not
  `no_answer`. It is not the number of calls.
- **Buildings covered** = the sum of `buildings_count` across contacts reached. This is the
  figure that makes the engineer channel's leverage visible, and it is the number worth putting
  in front of anyone asking whether this campaign is working.

**Follow-ups due** should also drive ordering: any contact with a `callback_date` of today or
earlier sorts to the top of the list with a marker, above the buildings-carried ordering.

### Getting the data in

Write `scripts/import_call_list.mjs` — a re-runnable Node script, not a one-shot. It reads an
xlsx and upserts into `call_campaigns` + `call_contacts`, keyed on
`(call_campaign_id, source_key)`, so running it twice equals running it once. That is the same
guarantee the sync job gives, and the same reason.

Source file: `data/Campaign02_SAFE_Reliable_2119.xlsx`, tabs `Ranked_Targets`, `By_Engineer`,
`By_Owner`. Seed the campaign as `nyc-ll11-safe`, owner **Mark Vasu**.

**The source data has known defects. The import must handle all five — they are documented in
`data/Campaign02_README.md`, and if you skip them you will load a corrupt list:**

1. **Name case-variants inflate the person count.** `By_Engineer` has 321 rows but 253 real
   people; `By_Owner` has 1,048 rows but 999. `Nicholas Ferrara` and `Nicholas  Ferrara`
   (double space) are one man; Lloyd Valdez appears at rank 1 *and* rank 3. Normalize
   whitespace and case to build `source_key`, but keep the best-formatted version for display.
2. **`"PR"` is not a company.** It appears as an owner business name on 119 unrelated
   buildings. Treat it as null, never group on it.
3. **NYCHA is 169 buildings behind 4 names.** Public housing, procurement-gated, almost
   certainly not the buyer. Import it but tag it — add a `segment` column or set
   `dnc_reason = 'institutional — review'` — so it can be filtered out of the working list
   without being deleted. Do not silently drop it.
4. **48 buildings have no name on either channel** and 4 have an engineer but no owner. They
   have no contact, so they cannot become a row. Log the count the script skipped; do not fail
   silently.
5. **Almost nobody has a phone number yet.** Only 64 engineers have any contact detail at all
   (88 emails, 64 phones across 94 rows, and the phones are firm mainlines, not direct dials).
   Import every contact regardless, but the default list view must filter to
   **has a phone or email**, with a toggle to show the rest. Otherwise the rep opens the page
   to 1,250 rows they cannot dial.

After importing, print a reconciliation: rows read, contacts created, contacts skipped and why,
contacts with a phone, contacts with an email, and total buildings covered. If the numbers do
not reconcile to the source, say so rather than proceeding.

### Reps

Don't build a rep table or an admin page. Derive the roster from `campaign_groups.owner` the
way `/meetings` already does, unioned with `call_campaigns.owner`. Mark Vasu is the only rep on
this campaign; every rep can see every list. Assignment of contacts to reps is explicitly out
of scope — leave the schema able to support it later, but build no UI for it.

### Constraints

- Next.js 14 App Router, React 18, `@supabase/supabase-js`. Nothing else added to
  `package.json` except an xlsx reader for the import script, which is a dev dependency and
  must not be imported by any page.
- Server components by default. The only client components in this app are the nav, the theme
  boot and the count-up. Keep it that way — a form can post to a server action.
- Expand/collapse is native `<details>`, so it works without JavaScript.
- Every class you use must already exist in `app/globals.css`. If you genuinely need a new one,
  add it as a token-based class and note it in `DESIGN.md`.
- Dark mode must work. If you only use existing tokens, it comes free.
- Add `Calls` to `components/nav.jsx`.

### When you are done

Update `STATE.md` with a dated section describing what was added, what the numbers reconciled
to after import, and anything left open — matching the style of the entries already in it. Add
the new migration filenames to the list at the bottom. Then show me the reconciliation output
from the import script before I deploy anything.

Do not run the import against production Supabase until you have shown me the plan and I have
said go.
```

---

## Files to put in the repo before you start

Copy these two into a new `data/` folder inside `qea-campaign-hq`:

| From | To |
|---|---|
| `Growth and Marketing/NYC Local Law 11/Campaign 02 — SAFE Reliable Reachout/Campaign02_SAFE_Reliable_2119.xlsx` | `data/Campaign02_SAFE_Reliable_2119.xlsx` |
| `Growth and Marketing/NYC Local Law 11/Campaign 02 — SAFE Reliable Reachout/README.md` | `data/Campaign02_README.md` |

`README.md`, `STATE.md` and `DESIGN.md` are already in the repo, so Claude Code will find them
on its own — the prompt tells it to read them first.

You will also need `SUPABASE_SERVICE_ROLE_KEY` available locally for the migration and the
import. It is not in the repo and the anon key cannot do either.

---

## Two things worth deciding before the build, not during

**The list isn't dialable yet.** 64 engineers have contact details; the other ~1,190 people
have a name and a mailing address. The dashboard will be correct and mostly empty. That is
fine — it is a real, working list of the 64 people who cover 46% of the buildings, which is
enough to test the pitch. But if you want a fuller list on day one, run the free-name harvest
(README Step 3b) and the enrichment wave first, then import once.

**The engineer pitch doesn't exist yet.** The `summary_md` Context panel needs content, and the
campaign README's pitch is written for a building owner, not a QEWI engineer. An engineer is a
referral channel, not a buyer. Write that script before the rep opens the page, or the page
will be a list of people with nothing to say to them.
