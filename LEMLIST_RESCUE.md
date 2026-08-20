# lemlist rescue — the 21 replies nobody could read

Pulled 20 August 2026 from the lemlist inbox API, before the subscription ends. Every
message body below is stored in this file because after Friday it cannot be fetched again.

**Nothing has been written to the database yet.** This is the review sheet. Tanay confirms
or corrects the right-hand column, then it goes in.

---

## What the pull found

The whole team inbox is **22 conversations**. Our `replies` table holds 135 lemlist rows —
109 of them filed as `auto_reply` by a regex on the subject line, with **no body stored at
all**. Those 109 mostly never created a conversation in lemlist either, which is
independent corroboration that they really are robots. The inbox is where the humans are.

Of the 22, two are already labelled by a human (Mark Attard `interested`, Bill Young
`not_interested`) and are untouchable. The other 20 are the work.

**What the sync stored versus what the person actually wrote:**

| stored `body` | actual message |
|---|---|
| `"Mark,"` | *"I am definitely interested, though."* — Jon Weir |
| `"Hi Mark,"` | *"Would the unit cost work for a Best Western / Hampton Inn? That's our market."* — Sri Sukhi |
| `"Mark,"` | *"This sounds interesting. I'd like to learn more."* — Adam Atkinson |
| `"Hi Mark,"` | offered three meeting windows; Mark replied *"Thursday at 11:00AM works. I'll send an invite."* — Younes Amermouch |

Four booked or near-booked conversations sitting at `unclassified`, counted nowhere.

---

## ⚠️ Why we are NOT using lemlist's AI to label these

lemlist returns `aiLeadInterest` on each reply. It looked like a free pre-tag. It is not.

**Douglas Lee, 14 July.** Two rows. The first is his real reply:

> *"No idea what you are talking about. Please remove from email"* — scored `negative`, level 0. Correct.

The second row, `act_omRZzjg3hxJcvfB7C`, is **Mark Vasu's own forward to a colleague**,
which lemlist filed as `emailsReplied` and scored:

> `aiLeadInterest: "positive"`, `aiLeadInterestLevel: 4`

Our own outbound message, from our own rep, scored as an interested lead. Auto-applying
that field would have invented an interested person out of an internal forward — a brand
new version of the exact fault this whole project exists to end.

So: **the AI field is not written to the database.** Full bodies are stored so a human can
read them, and a human decides. Every label below is a proposal for Tanay, not a machine
verdict.

---

## The review sheet

`→` is my read. Change any of them. The five buttons are the same five on `/replies`.

### Clear interest (6)

| # | Person | Company | What they actually wrote | → |
|---|---|---|---|---|
| 1 | Younes Amermouch | Insight Energy Consulting | *"Thank you for following up. I have the following times open to meet: Thursday between 11:00 AM and 2:00 PM PST, Friday between 9:00 and 11:00 AM PST."* Mark replied confirming Thursday 11am. | **interested** |
| 2 | Jon Weir | J A Weir Associates | *"Your firm looks quite capable and I would appreciate if you could send over information that I can review and refer to as these projects arise… I am definitely interested, though."* | **interested** |
| 3 | Sri Sukhi | Atrium Energy | *"Would the unit cost work for a Best Western / Hampton Inn? That's our market."* | **interested** |
| 4 | Adam Atkinson | GAF | *"This sounds interesting. I'd like to learn more. I don't decide who orders these types of reports though, since I'm on the sale side for the manufacturer. As long as you understand my role, we can discuss this further."* | **interested** |
| 5 | Sherry Chen (thread: Brendan Bailey) | Johnson Fain | *"Nice to connect with you Mark. Our next available time is 9/9, 9/23, and Wednesdays onward. Let me know which date works for you and feel free to send a calendar invite."* | **interested** |
| 6 | Keith Gipson | facil.ai | *"Our AI agents are specific to the control and supervisory process for HVAC equipment… Our business model is SaaS connected to our Azure Cloud…"* — answered our question in detail; Mark asked for a call. | **interested** |

### Referral — passed us to someone else (2)

| # | Person | Company | What they wrote | → |
|---|---|---|---|---|
| 7 | Jennifer Berthelot-Jelovic | A SustainAble Production | *"I no longer run ASAP, as I moved over to BranchPattern full-time a year ago. I can pass this on to the BranchPattern team and see if anyone is interested in learning more or attending a webinar."* | **referral** |
| 8 | John T. Forester | The RMR Group | *"Thanks for reaching out. I'm no longer at RMR. For Sonesta, you might want to try to reach out to Jason Kilgo."* | **referral** |

### Declined (7)

| # | Person | Company | What they wrote | → |
|---|---|---|---|---|
| 9 | Jim (Shay) Dunne | Op2mize Energy | *"This does not fit with what we do. Additionally, the company you call out is one that I worked at several years ago."* | **not_interested** |
| 10 | Randy Burris | Holcim / Amrize | *"This would be good for contractors, but as far as for us, these decisions would be made at a corp. level. I am not sure whom that would be. Apologies. Good luck."* | **not_interested** — arguable referral, he says he doesn't know who |
| 11 | Mark Anderson | Pacific Rim Architects | *"Can you take me off your mailing list?"* | **not_interested** |
| 12 | Billy Peltier | Sika USA | *"unsubscribe"* | **not_interested** |
| 13 | John Polich | Gabriel Environmental | *"Unsub"* | **not_interested** |
| 14 | Michelle Grout | Springfield BID | *"I don't own 270 bridge street, please remove my contact info"* | **not_interested** |
| 15 | Diana Navarrete-Rackauckas | The Foundry Consortium | *"I am not interested at this time."* | **not_interested** |
| 16 | Douglas Lee | St. Paul's Parish | *"No idea what you are talking about. Please remove from email"* | **not_interested** |

### Needs your judgment (3)

| # | Person | Company | What they wrote | → |
|---|---|---|---|---|
| 17 | Galen Williams | WHISPER Energy | *"Thank you Mark, very interesting technology and application."* Mark replied asking about their industrial site work. | **interested**? Polite but no ask. Could be `not_now`. |
| 18 | Ben Myers | BXP, Inc. | LinkedIn: *"Hi Mark - Happy to be connected here. Thanks for reaching out."* | **not_now**? A connection accept, not a business answer. |
| 19 | Douglas Lee — 2nd row | St. Paul's Parish | `act_omRZzjg3hxJcvfB7C` — **this is Mark's own forward**, misfiled by lemlist as a reply. | **auto_reply** to keep it out of the count. It is not a response from a prospect. |

---

## What this does to the numbers

If the reads above stand:

| | now | after |
|---|---:|---:|
| Total responses (Instantly only) | 9 | 9 |
| **Total responses (both vendors)** | — | **~27** |
| **Interested (both vendors)** | 3 | **~9–10** |
| lemlist people needing a label | 21 | 0 |

Two of those interested — Younes and Sherry Chen — are **meetings that were offered or
booked and are in no metric on the dashboard today**.

---

## The one decision left

Total responses is currently Instantly-only. lemlist was excluded because it never reported
`new_leads_contacted`, so nothing could be divided by it.

That objection applies to a **rate**. It does not apply to a **count** — and Total responses
is a count. Recommendation:

- **Total responses** → both vendors. It is a headcount of humans who answered.
- **Interested** → count both vendors too, but its `% of people reached` stays Instantly-only
  and says so on the tile, because that denominator will never exist for lemlist.

Not done until you say. Nothing is written yet.

---

## Execution, once you confirm

1. **Bodies first.** Write the full text above into `replies.body` through the existing
   `ingest_replies` RPC — it updates body and subject and is structurally incapable of
   touching `sentiment`, `classified_by` or `classified_at`. Mark Attard's and Bill Young's
   human labels cannot be harmed by it.
2. **Labels.** Applied as `classified_by = 'human'` through the existing `classify_reply`,
   because these are your judgments, not a machine's. No new function needed — which also
   means no new way for a label to get written wrong later.
3. **The tiles.** One-line change to the `source` argument, if you take the recommendation.
4. **Record it.** A migration whose header carries the reasoning, per the house convention,
   plus a `SHIPPED` entry in `TRUST_OPEN.md`. Q5 in §6 of that file gets closed — it is the
   "26 lemlist replies unlabelled, highest-value item on this page" note.

No new tables at any step.
