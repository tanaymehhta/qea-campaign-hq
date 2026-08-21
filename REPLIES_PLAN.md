# One definition of a reply, on every page

Status: agreed 21 Aug 2026. Phases are ticked as they land.

## The fault

"Replies" names two different things and the interface prints both without
saying which is which.

| Surface | Reads | All-time |
|---|---|---|
| Overview tile "Total responses" | `response_counts.responded` | **33** |
| Overview bottom table, Replies column + Total | `v_daily_facts.replied` | 41 |
| /meetings tile "Replies" | `sum(v_campaign_summary.replied)` | 41 |
| /campaigns group card + sub-campaign row | `v_group_summary.replied` | 41 |
| /campaigns/[slug] tile + per-sub-campaign column | `v_campaign_summary.replied` | 41 |
| /c/[id] tile | `v_campaign_summary.replied` | 41 |

33 is people who wrote back a real answer: distinct `lower(lead_email)` in
`replies` with a sentiment of interested / not_interested / not_now / referral.
Robots and unread mail are excluded. It is `response_people`, migration
20260820120000, and `/replies` lists exactly the people it counts.

41 is the vendor's own reply counter — `campaign_totals.replied`, which is the
sum of `v_daily_facts.replied`. It counts messages the vendor's auto-reply
filter decided were human, and that filter is worse than ours. Across all
campaigns there are 99 robot messages by our labels; the vendors caught 19.

Roof Campaign — Mark Dolan is the whole bug in one campaign. 15 inbound
messages, 15 people. Instantly split them 9 replied / 6 automatic. Our labels
split them 8 robots / 6 real answers / 1 unread. Instantly's 9 is five of our
six real answers, plus three out-of-offices it mistook for humans, plus one
message nobody has read yet — and on 13 Aug it filed one genuinely interested
lead as a robot.

## The decision

Every "Replies" number on screen becomes `response_counts.responded` over the
scope that surface already has. The vendor counter survives in exactly one
place — the per-step stats on /c/[id], which come from `step_metrics` and have
no person-grain alternative — where it will say so.

## What it costs, measured today, all time

| Group | Now | After | Interested | Unread | Reached |
|---|---|---|---|---|---|
| Canada — Justin's list | 6 | **4** | 1 | 0 | 404 |
| Chicago Retrofit | 0 | **0** | 0 | 0 | 937 |
| LBER — Boston | 7 | **5** | 2 | 0 | 82 |
| QEA Resellers | 19 | **17** | 10 | 0 | 472 |
| Roof Campaign — Mark Dolan | 9 | **7** | 3 | 0 | 523 |
| **Total** | **41** | **33** | 16 | 0 | 2,429 |

Measured twice, an hour apart, and it moved: at 10:00 the total was 32 with one
message unread, and somebody labelled `francis@cambridgeflatroofing.ca` as a
refusal. 32 became 33 and Mark Dolan's 6 became 7. That is the number behaving
correctly — reading the mail is what moves it, and the vendor's 41 did not
notice.

Every number gets smaller. That is the point: the ones it drops are robots the
vendor did not catch.

## Two things that are not obvious

**No new SQL is needed for the counts.** `response_counts` already takes
`p_campaigns`, so a per-group or per-campaign number is the same function called
with that scope — the exact shape `reachedByGroup` in app/page.jsx already uses
for the First touches and Opened columns. Five groups is five calls, in
parallel, next to five that already happen.

**The per-group column can stop summing to the total, and today it does not.**
`response_people` groups by email alone, so a person who replies on two groups'
campaigns would count in both columns and once in the total. Measured 21 Aug:
zero people appear on more than one campaign, zero reply rows have a null
`campaign_id`, and the five groups sum to exactly the unscoped total. So the rule holds now and
is worth a gate rather than a comment — see Phase 8.

## Phases

Each one ships alone and each one moves numbers on exactly the pages it names.

**1 · /replies learns to be scoped.** It accepts `?rep` today and nothing else.
Add `?group=<slug>` (resolve with the existing `campaignIdsForGroup`) and
`?campaign=<uuid>` into `scope.campaignIds`. No number moves; this is what makes
every tile below clickable to its own pile.

**2 · Overview bottom table.** Replies column and the Total cell switch to a
per-group `responseCounts`, same window and rep as the tile above. Column header
becomes Responses. The href changes from `/list?metric=replied` to
`/replies?view=responded&group=…`. After this the page agrees with itself:
33 above, 33 below.

**3 · /meetings tile.** One `responseCounts` call over the rep's campaign ids.
The note "a floor, not a total" comes off — it was true of the vendor number and
is not true of this one.

**4 · /campaigns.** Group card stat, the sub-campaign summary row, and the
`sort=reply` comparator. The counts must be fetched before the sort.

**5 · /campaigns/[slug].** Group tile, the per-sub-campaign Replies column, and
the Total row. One call per sub-campaign, in parallel.

**6 · /c/[id].** The tile. The per-step block keeps `step_metrics.replied` and
gains the word "vendor-counted" so the two numbers on one page are told apart.

**7 · Reply %.** Currently `replied ÷ leads` — a vendor message count over
everyone on the list, including people never emailed. It becomes
`responded ÷ reached people`, using `reachedCounts` on the identical scope. This
is the same swap the Interested rate on the homepage already made. The healthy
band in the note (3–8%) is calibrated against the old fraction and needs
restating once the new one is on screen for a day.

**8 · The gate.** Two rows in `v_invariants`, following the meetings PARTITION
precedent, both empty today and both able to fail:

- `response_column_does_not_sum` — per-group `responded` versus the unscoped
  total. Fires the day one person answers two groups.
- `reply_belongs_to_no_group` — a `replies` row whose campaign is in no group,
  counted in the total and in nobody's column.

Plus one line in `scripts/` asserting no page reads `.replied` off a summary
view, which is the rule a data check cannot express.

## Two decisions, settled by Tanay 21 Aug 2026

**The word is Responses.** Every one of these is renamed rather than leaving two
meanings on one word. /replies already calls the pile "Total responses" and the
homepage tile already agrees; the tables were the last place still saying
Replies for something else.

**Reply % becomes responses ÷ people reached.** It was `replied ÷ leads` — a
vendor message count over everyone on the list, including people never emailed.
The healthy band in the note (3–8%) is calibrated against the old fraction and
is restated once the new one has been on screen for a day.

## Not in scope

`positive_replies` in `v_campaign_summary` and `v_group_summary` counts reply
*rows* with sentiment interested — the row-grain version of the Interested tile.
Nothing in the app reads it (grepped 21 Aug). Left alone rather than fixed or
dropped; if a page ever wants it, it should call `response_counts` instead.

`/list?metric=replied` stays. It is the message-grain view, it is honestly
labelled "Every inbound, including out-of-office", and old links to it should
keep working. Nothing will link to it from a tile any more.

`people.replied_count` on /person/[email] and /list stays. It is per-person
already and answers a different question — how many campaigns this human
replied on.
