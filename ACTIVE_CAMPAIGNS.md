# What "Active campaigns" counts

Written 20 Aug 2026. Commit `ef97351`.

The homepage tile read **6 of 35** directly above a table listing **five
campaigns, three of them live**. Both numbers were correct about their own
noun, and the tile's noun was the wrong one.

---

## The complaint

Two, reported together:

1. The number never moved when the date range changed.
2. The number was wrong — "there aren't even 6 campaigns."

The first is not a bug. `Active campaigns` is a present-tense fact; no window
over August can change what is running today. Checked across every range and
every rep before touching anything — 6 of 35 in all twenty combinations. It
sits in a grid where all seven neighbours obey the range, which is why it reads
as broken. It isn't.

The second was real, and it was not what it looked like.

---

## What was actually wrong

`campaigns` holds one row per **vendor sequence**. Ten Instantly sequences make
up Chicago Retrofit alone. `campaign_groups` holds one row per **campaign** as
anyone here uses the word — the thing `/campaigns` lists, the thing a rep says
they own, the thing with a live/ended badge in the table six hundred lines
below the tile.

The tile was counting sequences:

```js
const scopedCampaigns = (campaigns ?? []).filter((c) => inScope(c.id));
const running = scopedCampaigns.filter((c) => c.status === "running").length;
```

Two faults in two lines. It counted the wrong noun, and it asked
`campaigns.status` — which is one signal, whatever the vendor last said.

---

## The fix

`app/page.jsx:386`:

```js
const live = shownGroups.filter((g) => g.actual_status === "live").length;
```

`shownGroups` was already built at line 58 and already used by the table at
line 644. `actual_status` was already in `v_group_summary` and already fetched
by `repList()`. No new query — the tile was reading the wrong pair of fields
that were both sitting on the page.

`actual_status` needs **two signals to agree** (migration
`20260818195031_group_actual_status_is_derived`): a sequence the vendor still
calls running, AND a send inside fourteen days. Its header explains why either
alone is measurably wrong. That second half is what quietly solved a problem we
were about to fix by hand — see below.

### Before and after

| View | was | now | what the table shows |
|---|---|---|---|
| All reps | 6 of 35 | **3 of 5** | Chicago Retrofit, QEA Resellers, Roof — live |
| Mark Vasu | 5 of 23 | **2 of 3** | Chicago Retrofit, QEA Resellers live; LBER ended |
| Justin | 0 of 11 | **0 of 1** | Canada — Justin's list, ended |
| Mark Dolan | 1 of 1 | **1 of 1** | Roof Campaign, live |

Still flat across every range. That is the point, not a defect.

### Where the six went

| Group | vendor-running sequences | last send | verdict |
|---|---|---|---|
| Chicago Retrofit | 2 | 18 Aug | live → 1 |
| QEA Resellers | 2 | 17 Aug | live → 1 |
| Roof Campaign | 1 | 20 Aug | live → 1 |
| LBER — Boston | 1 | 22 Jul | **ended** → 0 |
| Canada — Justin's list | 0 | 14 Aug | ended → 0 |

2+2+1 collapse into three campaigns, and LBER's stale sequence gets dropped by
the fourteen-day half of the rule.

---

## The two dead lemlist rows, and why they stopped mattering

Found while investigating, both marked `running` by lemlist:

```
QEA Resellers — LinkedIn (68)          1 daily row, 0 sent, 0 LinkedIn, ever
LBER — Batch 6 — Immediate Send        1 daily row, last activity 23 Jun
```

Not a tracking gap — the LinkedIn one has never recorded a single unit of
activity of any kind. lemlist is simply wrong about them.

The plan was to end them by hand in lemlist. `actual_status` made that
unnecessary: LBER — Boston's last group-wide send was 22 July, so the group
reads `ended` regardless of what its Batch 6 row claims, and QEA Resellers is
live on the strength of the LA campaign sending on 17 Aug, not on the strength
of the LinkedIn row. **Neither stale row can move the tile any more.** Still
worth ending them for hygiene; no longer blocking a number.

This is the argument for deriving from two signals rather than one, restated
with a live example.

---

## Two smaller things in the same commit

**A sync timestamp on the sentence.** The subline claimed "running right now"
and named no moment, so a correct 0 and a 0 from a sync that died on Tuesday
looked identical. `last_synced` joins the campaigns select and the sentence now
ends `as of 20 Aug, 18:00`. Reused the existing `prettyWhen` rather than adding
a formatter.

**lemlist's word for finished.** `sync/index.ts` allowed six status words and
`ended` was not among them, so five campaigns lemlist knew perfectly well were
done came back as `unknown`:

```
unknown  raw=ended  QEA Resellers — Denver/Boulder (Referral)
unknown  raw=ended  QEA Resellers — Seattle (Referral)
unknown  raw=ended  QEA Resellers — Co-sell (Mfr Reps)
unknown  raw=ended  QEA Resellers — Contractors
unknown  raw=ended  QEA Resellers — Chicago (Referral)
```

Now translated to `completed`; `status_raw` still keeps lemlist's own word, so
nothing is lost. Affects the status column on `/campaigns`, not this tile.

> **Not deployed.** This half lives in the edge function. Those five rows keep
> reading `unknown` until `supabase/functions/sync` ships and one sync runs.
> The `app/page.jsx` half is live on the next Vercel deploy.

---

## Starting a new campaign in Instantly

`NEW_CAMPAIGN.md` is the full launch document and it still holds. What follows
is only how a launch reaches *this* tile.

Within 30 minutes (`pg_cron`, `*/30 * * * *`), `regroup()` files the campaign
into a group by the name prefix before the em dash:

```
"Chicago Retrofit — Warehouses"   → joins the existing campaign, inherits its owner
"Boston Roofing — Batch 1"        → creates a new group, owner null
"Roofing campaign v2"             → no em dash → Ungrouped
```

**Matching an existing prefix is fully zero-touch.** A new prefix leaves exactly
one field for a person, and `/health` already flags it —
`v_groups_without_an_owner` exists and `app/health/page.jsx:29` reads it. It
returns empty today.

### What the tile does on launch day

`actual_status` requires a send inside fourteen days, and a brand-new campaign
has none, so it is `planned` — in the denominator, not the numerator:

| when | tile |
|---|---|
| now | 3 of 5 |
| ≤30 min after it appears in Instantly, before first send | 3 of 6 |
| after its first email goes out | 4 of 6 |

Deliberate. A campaign that exists but has never sent is not live.

### What Instantly can never tell us

| field | breaks anything? |
|---|---|
| **`owner`** | **Yes.** `repList()` skips owner-less groups: no avatar, no rep filter, no `/calls` roster entry. |
| `geography` | No — subtitle on the rep chip |
| `segment`, `list_source`, `sequence_shape`, `description` | No — descriptive text on `/campaigns` |
| `platform` | No — derived from `campaigns.source` when blank |

`NEW_CAMPAIGN.md` already establishes why: the only ownership-ish field
Instantly returns is `organization`, the workspace UUID, identical on every
campaign. Instantly has no concept of "Mark runs this one."

---

## Proposed: derive the owner from the sending mailbox

Not built. The signal is already synced — `campaigns.sender_emails`, a `text[]`
written on every campaign row — and it separates the three reps cleanly:

```
Mark Vasu   mark@ markv@ cmark@ mark1@       at qeatechgo / qeatechone / qeatech-ai
Justin      justin@ justin.k@ justin.kim@ justin_kim@   at qeatech1 (+ one qeatechone)
Mark Dolan  mark@ markd@ mark_d@ mark_dolan@  at qeatechaudit / qeatechbuild / qeatechretrofit
```

**Neither half alone is a usable key.** Measured, not assumed:
`justin@qeatechone.com` and `mark@qeatechone.com` share a domain;
`mark@qeatechaudit.com` (Dolan) and `mark@qeatechgo.com` (Vasu) share a local
part. The full address is the key. That is fine — 23 addresses are in use, and
`email_accounts` already holds 73 synced rows.

The change:

1. `alter table email_accounts add column owner text` — the table exists, it
   just has no owner column.
2. Backfill once from the addresses currently in use, derivable from existing
   group ownership.
3. In `regroup()` (`sync/index.ts:172`), when creating a new group, set `owner`
   to the rep owning the plurality of that campaign's `sender_emails`.

Then a launch from your own mailboxes lands in your view within 30 minutes with
no touch at all. **A genuinely new rep on new mailboxes still falls through** —
that is what `v_groups_without_an_owner` on `/health` is for, and it is the
right place for it. Do not try to make the derivation total.

Roughly one migration plus fifteen lines in the sync.

---

## Stale elsewhere

`NEW_CAMPAIGN.md`'s owner table still reads `qea-resellers owner='Tanay'` and
`lber owner='Tanay'`. The database says **Mark Vasu** for both, and the group
display names have changed since (`qea` → `Canada — Justin's list`, `lber` →
`LBER — Boston`). Left alone rather than bundled into this commit; worth a pass
next time that document is opened.

Its "Not built yet: setting the owner from /health" section is now **partly**
built — the view and the `/health` read exist; the inline owner dropdown does
not.
