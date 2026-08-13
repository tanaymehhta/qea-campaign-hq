# Starting a new Instantly campaign

Written 10 Aug 2026, to be checked against the next campaign launch.

What happens to the dashboard when a campaign is created in Instantly that this
system has never heard of. Short answer: it arrives on its own within 30
minutes, and one field — the owner — has to be typed by a person, once.

---

## The one thing that needs a decision before you click anything

**Name it `Parent — Sub`, with an em dash.**

`regroup()` in `supabase/functions/sync/index.ts` splits the campaign name on
the first em dash. Everything before it becomes the group heading on
`/campaigns` and the homepage; everything after becomes the sub-campaign label.
A name with no em dash lands in the group called `Ungrouped`, alongside every
other stray, and no amount of waiting fixes it — only a rename or a manual
override does.

Matching an existing prefix exactly (`Chicago Retrofit — …`) files the campaign
inside that existing group. A new prefix creates a new group.

---

## The timeline

| When | What lands |
|---|---|
| Within 30 min | The campaign itself: name, status, daily limit, tracking flags, sender list. Its group. Leads, sends, bounces, replies. Every number on the homepage and `/campaigns`. |
| 03:00 ET next morning | The ten new mailboxes: warmup score, per-mailbox send volume, `/inboxes`. Also the sequence copy and per-step performance. |
| Sunday 04:00 ET | A 90-day re-pull that heals anything missed. |

Nothing is instant, and nothing is a live feed. `pg_cron` fires the sync edge
function every 30 minutes; the dashboard only ever reads Supabase. Average wait
after launch is about 15 minutes, worst case 30.

Verified 10 Aug 2026 — the last six runs were on the half hour, all `ok`:

```
20:30  incremental  ok   rows=2824
20:00  incremental  ok   rows=2821
19:30  incremental  ok   rows=2818
```

If a launch ever seems not to arrive, `/health` shows the sync run log — check
there before assuming the campaign is the problem.

---

## What is automatic

No config file, no allowlist, nothing to register. `syncInstantly()` pages
`/v2/campaigns` and takes whatever Instantly returns, so discovery is a side
effect of listing. Every write is an upsert keyed on the vendor's own campaign
id, so re-running is harmless.

Arriving on their own:

- The campaign row — name, status, daily limit, open/link tracking, text-only,
  which mailboxes send it, schedule timezone.
- Lifetime totals and per-day metrics.
- Every lead, into `people`.
- Every inbound reply, from the Unibox, with a first guess at out-of-office
  vs. a real reply. `/conflicts` is where a human settles the disagreements.
- Group membership, from the name.

Reflecting it without any help:

- Homepage tiles and the daily bar chart. The chart hides Sat/Sun only while
  they are empty — if the new campaign ever sends on a weekend, those columns
  come back by themselves.
- All time / 7 / 30 / 90 — same numbers, different windows.
- **By campaign — all time**: the new group appears as its own row. This table
  is built from whatever groups exist, not from a fixed list.
- `/campaigns`, `/leads`, `/list`, `/replies`, `/person/…`, `/meetings`.

Every page is `force-dynamic`, so there is no cache to clear and no deploy
needed. Refresh is enough.

---

## What is NOT automatic

`campaign_groups` has seven hand-kept columns the sync never writes: `owner`,
`platform`, `geography`, `segment`, `list_source`, `sequence_shape`,
`description`. A freshly auto-created group gets slug, display name and
`status='live'` — nothing else.

This is not hypothetical; the shape already exists in the database:

```
chicago-retrofit   owner='Mark'    plat=['instantly']  geo='Chicago, IL'
qea-resellers      owner='Tanay'   plat=['lemlist']    geo='Denver/Boulder, …'
lber               owner='Tanay'   plat=['lemlist','hubspot']
qea                owner='Justin'  plat=['instantly']  geo='Canada'
ungrouped          owner=None      plat=[]             geo=None    ← the new-group shape
```

What actually breaks, worst first:

1. **`owner` null** — the group disappears from the rep layer entirely.
   `repList()` skips owner-less groups, so: no rep avatar, no rep filter on the
   homepage, no entry in the `/calls` roster. This is the only one that costs a
   feature.
2. **`platform` empty** — `/campaigns` draws the volume bar in the lemlist
   colour, because `toolColor()` tests for `"instantly"` in that array.
3. **`sequence_shape` null** — "Emails in sequence" reads `—` even though
   `template_versions` holds the real steps after the 3am run.

### Why owner can't be pulled from Instantly

Checked against a real campaign's stored payload. The only ownership-ish field
Instantly returns is `organization`, which is the workspace UUID and is
identical on every campaign. Instantly has no concept of "Mark runs this one" —
that fact exists only in your head, so it has to be typed once.

`platform` is a different story: the row already records that it came from
Instantly, the group column just doesn't get filled from it. That one could be
derived and should be. `geography` usually sits inside the campaign name, but
only by convention, so deriving it would be guessing.

---

## Launch-day checklist

1. Name the campaign `Parent — Sub`.
2. Launch it in Instantly.
3. Wait up to 30 minutes. Homepage numbers should move.
4. Open `/campaigns` — confirm it grouped where you expected, not into
   `Ungrouped`.
5. Set the owner (see below). Until then it is invisible to every rep filter.
6. Next morning: check `/inboxes` for the ten new mailboxes and their warmup
   scores.

---

## Not built yet: setting the owner from /health

Today the owner has to be set directly in the database. The intended fix, agreed
10 Aug 2026 but not yet written:

A block on `/health`, next to the existing status-drift canary:

> **Groups missing an owner** — 1
> `New Campaign Name` · sent 340 · [ owner: Mark ▾ ] [ geography: ____ ] [Save]

Owner is a dropdown built from the reps who already exist, not a free text box,
so a stray `mark` can't appear next to `Mark`. `platform` fills itself in from
the campaign's source and is never typed. The row leaves the page once saved —
that is what keeps `/health` a health check rather than a settings screen.

Mechanism follows the pattern already in `app/conflicts/actions.js`: a server
action calling a `security definer` function in Postgres that validates its own
arguments. The dashboard's public key is select-only, so that function is the
only write door and it checks rather than trusts.

Roughly one migration plus one form. Build the migration first and look at it
before touching the page.

---

## Two things not verified live

Read from the code, not watched happening, so worth an eye tomorrow:

- That Instantly returns a **brand-new draft campaign with zero sends** in its
  campaign list. The code maps status `0` to `draft`, so it is clearly built for
  it — but nobody has watched one arrive.
- The exact moment the **ten new mailboxes** appear. Expected at the 03:00 ET
  deep run, never observed with accounts this new.

---

## What actually happened — Roof Campaign · Mark Dolan, 11 Aug 2026

The first launch under this doc. Instantly id `a998347d…`, created 11 Aug 16:37
UTC, 350 a day, ten mailboxes on `qeatechbuild` / `qeatechaudit` /
`qeatechretrofit`, five email steps, open tracking off, Canadian roofing
contractors.

**The timeline held exactly.** By the time anyone looked, the campaign row, 809
leads, 400 sends, 391 delivered, 9 bounces, 6 replies and 372 activities were
all there. The **ten mailboxes landed at 07:00 UTC on 12 Aug — the 03:00 ET deep
run**, to the minute, which answers the second open question above. The five
sequence steps arrived on the same run. Nobody touched anything to make that
happen.

**The name was hyphenated, not em dashed** — `Roof Campaign - Mark Dolan`. So it
went to Ungrouped, as predicted. Three things the doc did not predict:

- Ungrouped is not a fresh `status='live'` group. It **already exists, marked
  `abandoned`**, and it holds the errored AI SDR shadow campaign. So the new
  campaign inherited a wrong status as well as a null owner, and started
  tripping the status-drift canary on `/health` the moment it sent — which is
  the canary working, but it is noise pointing at the wrong row.
- `/inboxes` **drew all ten mailboxes twice**. They had been hand-seeded as
  `source='standby'` on 6 Aug; the deep run added the real `source='instantly'`
  rows, and the unique key is `(source, email)`. Any campaign launched on
  pre-seeded standby mailboxes will do this.
- Adding an owner surfaced an older ambiguity: `campaign_groups.owner` said
  `Mark` while `call_campaigns.owner` said `Mark Vasu`, and `callsRoster()`
  unions the two, so `/calls` had been listing one person as two reps. A second
  real Mark turned that from cosmetic into misleading.

**The fix**, in `supabase/migrations/20260812180000_group_mark_dolan_roof.sql`:
a group row with all seven hand-kept fields, membership pinned with
`assignment_source='override'` so the sync can never re-file it, `Mark` renamed
to `Mark Vasu`, and the ten orphaned standby rows deleted. No app code changed
and no deploy was needed — every page is `force-dynamic`.

Note `sequence_shape` was **read off `template_versions`, not typed**: the five
stored `delay_days` (0/4/5/6/7, each the wait before its step) accumulate to
`E1 d0 · E2 +4 · E3 +9 · E4 +15 · E5 +22`. Same arithmetic Chicago Retrofit's
string uses. `list_source` was left null — where the list came from is not
recorded anywhere readable, and a guess on that line is worse than a dash.

The lesson for next time is unchanged and now cost real work: **type the em
dash.** The override exists for when someone doesn't.

---

## Unrelated, so nothing to check

`/pipeline` and `/inbound` are the website-visitor system (`inbound_*` tables)
and `/calls` runs off `call_campaigns`. Neither shares data with Instantly
campaigns. A new campaign changes nothing there.
