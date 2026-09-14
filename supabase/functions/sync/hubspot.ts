// QEA Campaign HQ — a reply marked interested becomes a HubSpot deal
//
// Mark Dolan has been doing this by hand. Excel Roofing replied on 10 Sep and
// got a deal on the 11th; Al Pro replied on 13 Aug and got one on the 25th.
// The typing was never the cost — the twelve days were. This closes it to
// thirty minutes by riding the sync that already runs.
//
// Trigger: `replies.sentiment = 'interested'`, whoever said so. The phrase
// rules label a reply the moment it arrives (see the reply_rules trigger); a
// person can label or relabel one from the dashboard. Both write the same
// column and this asks the column, not who wrote it. So a reply the rules
// abstain on sits as `unclassified` doing nothing until somebody clicks, and
// that click pushes it — no second mechanism, no button that means "and also
// send it", nothing to remember.
//
// It deliberately does NOT read Instantly's own lt_interest_status. That was
// the trigger in the first cut of this file, on the evidence that Instantly
// flagged 6 where the dashboard flagged 14 and the dashboard's extras were
// out-of-office replies. Those eight rows have since been corrected, both
// lists now hold 7, and on the single case where they still disagree Instantly
// is the one that is wrong: it flagged rashmi@wolfenburg.ca, a roofer
// soliciting work *from us* ("send me the project details and drawings"). The
// rules abstain on her. The argument for the vendor's flag died with the
// labels that motivated it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const HUBSPOT = "https://api.hubapi.com";

// The four salespeople as HubSpot owner ids, keyed by the owner strings in
// `campaign_groups.owner`. One portal, four owners — not four connections.
//
// Hardcoded, deliberately. These change when somebody joins or leaves, which
// is also when a human must decide whose campaigns are whose. A lookup table
// would let that decision be skipped and a campaign land silently on nobody.
//
// The second, inactive "Mark Dolan" in that portal is 942182461. Not that one:
// a deal filed to a deactivated owner vanishes from every view its owner uses.
const OWNER_ID: Record<string, string> = {
  "Justin": "158678802",
  "Mark Dolan": "379554204",
  "Mark Vasu": "1459998522",
  "Tanay": "93245804",
};

// "Sales Pipeline", stage "1-First contact" — where every outbound deal Mark
// has made by hand starts. Opaque numeric ids because HubSpot renamed the
// labels and kept the ids: the label is what you read, the id is what you send.
const PIPELINE = "default";
const FIRST_CONTACT = "78274900";

// A won or lost deal is finished, and a new reply from that company is a new
// opportunity rather than a continuation of the old one. Any other stage means
// a live conversation is open and a second deal would be a duplicate of it.
const CLOSED_STAGES = new Set(["closedwon", "closedlost", "17163426", "17163427"]);

const DEAL_TO_CONTACT = 3;   // HubSpot's own numbering, not ours
const EMAIL_TO_CONTACT = 198;
const EMAIL_TO_DEAL = 210;

// Domains where two addresses mean two unrelated people. The duplicate check
// below widens from the person to their company domain, which is right for
// excelroofing.ca and catastrophic for gmail.com — every Gmail lead would
// adopt a stranger's deal. A roofing list is nearly all company domains, but
// `canroof5@telus.net` is in it, so this is not hypothetical.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.ca", "aol.com", "icloud.com", "me.com", "msn.com",
  "protonmail.com", "proton.me", "gmx.com", "mail.com",
  "telus.net", "shaw.ca", "rogers.com", "bell.net", "sympatico.ca", "videotron.ca",
  "comcast.net", "verizon.net", "sbcglobal.net", "cox.net", "bellsouth.net",
]);

/**
 * The name, and the only place a deal may be named.
 *
 * `{Company} [Outbound]`, matching what is already in the portal — "Wolf &
 * Wolf Roof Services [Outbound]", "Iron Shield Roofing [outbound]".
 *
 * It takes the company name exactly as it arrived and adds nothing. Mark's
 * hand-made names are not uniform: he shortened "Excel Roofing & Solar" to
 * "Excel Roofing", added a word for "Al Pro Solutions Roofing", and used both
 * "[Outbound]" and "[outbound]". Which of those he would have done here is not
 * a rule anybody can write down, so this does the one thing that is the same
 * every time and a human renames the odd one in two seconds.
 *
 * hubspot_test.ts fails if this ever drifts.
 */
export function dealName(company: string): string {
  return `${(company ?? "").trim()} [Outbound]`;
}

const norm = (e: string) => (e ?? "").trim().toLowerCase();
const domainOf = (e: string) => norm(e).split("@")[1] ?? "";

/**
 * One HubSpot call, with the rate limit respected rather than discovered.
 *
 * HubSpot meters the search endpoints per *second*, separately from the daily
 * allowance, and the limit is low enough that a queue of nineteen leads trips
 * it — two of them failed this way on the first full dry run, each lead
 * costing two or three searches. Left alone it is the ugliest kind of bug: it
 * appears only when there is a backlog, which is exactly when the push matters
 * and exactly when nobody is watching it run.
 *
 * A 429 is not a failure, it is the server asking for a moment. Waiting and
 * asking again is the whole fix. 5xx gets the same treatment on the same
 * reasoning. Anything else is a real error and is raised at once — retrying a
 * 400 just sends the same broken request three times.
 */
async function hs(token: string, method: string, path: string, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${HUBSPOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.ok) return r.status === 204 ? null : r.json();

    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      await r.body?.cancel();
      // 1s, 2s, 4s, 8s. The secondly window is one second wide, so the first
      // wait clears it and the rest are there for a bad minute.
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`hubspot ${r.status} ${method} ${path} — ${(await r.text()).slice(0, 300)}`);
  }
}

/** The contact HubSpot already has for this address, or null. */
async function findContact(token: string, email: string): Promise<string | null> {
  const found = await hs(token, "POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: ["email"],
    limit: 1,
  });
  return found.results?.length ? String(found.results[0].id) : null;
}

async function createContact(token: string, lead: Lead): Promise<string> {
  const [first, ...rest] = (lead.name ?? "").trim().split(/\s+/);
  const created = await hs(token, "POST", "/crm/v3/objects/contacts", {
    properties: {
      email: lead.email,
      firstname: first || undefined,
      lastname: rest.join(" ") || undefined,
      company: lead.company || undefined,
    },
  });
  return String(created.id);
}

/** Every contact at this company domain, the person themselves included. */
async function contactsAtDomain(token: string, email: string): Promise<string[]> {
  const domain = domainOf(email);
  if (!domain || PUBLIC_DOMAINS.has(domain)) return [];
  const found = await hs(token, "POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: `*@${domain}` }] }],
    properties: ["email"],
    limit: 50,
  });
  return (found.results ?? []).map((r: any) => String(r.id));
}

async function openDealOn(token: string, contactId: string): Promise<string | null> {
  const assoc = await hs(token, "GET", `/crm/v4/objects/contacts/${contactId}/associations/deals?limit=100`);
  const ids = (assoc.results ?? []).map((a: any) => String(a.toObjectId ?? a.id));
  if (!ids.length) return null;

  const batch = await hs(token, "POST", "/crm/v3/objects/deals/batch/read", {
    properties: ["dealstage"],
    inputs: ids.map((id: string) => ({ id })),
  });
  for (const d of batch.results ?? []) {
    if (!CLOSED_STAGES.has(String(d.properties?.dealstage))) return String(d.id);
  }
  return null;
}

/**
 * An open deal for this company already, if there is one.
 *
 * Checks the person first, then anyone else at the same company domain.
 *
 * The widening is not tidiness, it is a real case: Mark's "Excel Roofing
 * [Outbound]" from 11 Sep hangs off `info@excelroofing.ca`, a generic inbox he
 * made that day, while the person who actually replied is
 * `osedki@excelroofing.ca`. Asking only about the replier finds nothing and
 * builds Mark a second Excel deal.
 *
 * The cost is honest and was accepted deliberately: at a large company two
 * people replying about two different buildings are two real opportunities,
 * and this will suppress the second one. On a list of roofing contractors that
 * is a good trade. On an enterprise list it would not be — if this ever runs
 * against one, narrow it back to the person.
 *
 * It is also the only guard against the failure the push cannot otherwise
 * survive: a crash after HubSpot accepts a deal but before we record its id.
 * The retry finds the orphan and adopts it instead of making its twin.
 */
async function existingDeal(token: string, contactId: string | null, email: string): Promise<string | null> {
  if (contactId) {
    const own = await openDealOn(token, contactId);
    if (own) return own;
  }
  for (const other of await contactsAtDomain(token, email)) {
    if (other === contactId) continue;
    const found = await openDealOn(token, other);
    if (found) return found;
  }
  return null;
}

/**
 * The reply itself, on the deal.
 *
 * Without it the deal is a company name and nothing else, and the salesperson
 * has to open Instantly to find out what the person actually said. HubSpot
 * fills in "Last Activity Date" from this by itself.
 *
 * Logged as INCOMING_EMAIL, which does not set "Last Contacted" — that field
 * means the last time *we* contacted *them*, and nobody has, from HubSpot.
 * Leaving it empty is the truthful answer, and it fills in on its own the
 * moment a salesperson emails or calls from inside HubSpot.
 *
 * Failure here does not fail the push. A deal without its reply attached is
 * worth much more than no deal.
 */
async function logReply(token: string, dealId: string, contactId: string, lead: Lead): Promise<void> {
  await hs(token, "POST", "/crm/v3/objects/emails", {
    properties: {
      hs_timestamp: lead.received_at,
      hs_email_direction: "INCOMING_EMAIL",
      hs_email_subject: lead.subject ?? "(no subject)",
      hs_email_text: (lead.body ?? "").slice(0, 60000),
    },
    associations: [
      { to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: EMAIL_TO_DEAL }] },
      { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: EMAIL_TO_CONTACT }] },
    ],
  });
}

type Lead = {
  email: string;
  name: string | null;
  company: string | null;
  owner: string;
  campaign_id: string;
  subject: string | null;
  body: string | null;
  received_at: string;
};

/**
 * Who still needs a deal.
 *
 * Recomputed in full every run from two facts already in the database: the
 * reply is marked interested, and `hubspot_pushes` holds no deal id for that
 * address. There is no list of pending work, so there is no list to lose — a
 * run that dies halfway leaves the rest exactly as it found them and the next
 * run picks them up. See the migration header.
 *
 * `since` is the go-live floor. Every reply ever marked interested is a
 * candidate by this rule, and most of them are months old and long since dealt
 * with by hand. Turning the schedule on without a floor would empty that whole
 * history into the pipeline in one pass. The backfill is a separate decision
 * and gets a separate, explicit run.
 */
async function needDeals(
  db: SupabaseClient,
  only: string | null,
  since: string | null,
): Promise<Lead[]> {
  const { data: groups } = await db.from("campaign_groups").select("id,owner");
  const ownerOf = new Map((groups ?? []).map((g: any) => [g.id, g.owner]));
  const { data: members } = await db.from("campaign_group_members").select("campaign_id,group_id");
  const ownerOfCampaign = new Map(
    (members ?? []).map((m: any) => [m.campaign_id, ownerOf.get(m.group_id)]),
  );

  const { data: done } = await db.from("hubspot_pushes").select("email").not("deal_id", "is", null);
  const already = new Set((done ?? []).map((r: any) => norm(r.email)));

  let q = db
    .from("replies")
    .select("lead_email,lead_name,company,campaign_id,subject,body,received_at")
    .eq("sentiment", "interested")
    .order("received_at", { ascending: false });
  // `only` names one person for a hand-run test and overrides the floor: the
  // whole point of naming them is that they are historical.
  if (since && !only) q = q.gte("received_at", since);

  const { data: replies } = await q;

  const out = new Map<string, Lead>();
  for (const r of replies ?? []) {
    const email = norm(r.lead_email);
    // Newest first, so the first sighting of an address is its latest reply
    // and every later one is older. One person, one deal, their freshest words.
    if (!email || already.has(email) || out.has(email)) continue;
    if (only && email !== norm(only)) continue;

    // A campaign with no group has no owner, and a deal with no owner lands in
    // a pipeline nobody looks at. Skipped rather than filed wrongly.
    const owner = ownerOfCampaign.get(r.campaign_id);
    if (!owner || !OWNER_ID[owner]) continue;

    out.set(email, {
      email,
      name: r.lead_name,
      company: r.company,
      owner,
      campaign_id: r.campaign_id,
      subject: r.subject,
      body: r.body,
      received_at: r.received_at,
    });
  }
  return [...out.values()];
}

/**
 * Push every interested lead that does not have a deal yet.
 *
 * Never throws. A HubSpot outage costs the sync this step and nothing else —
 * no number on the dashboard comes from here. Each lead is independent, so one
 * bad row does not abandon the rest.
 */
export async function pushInterested(
  db: SupabaseClient,
  token: string,
  opts: { only?: string | null; since?: string | null; dryRun?: boolean } = {},
): Promise<Record<string, unknown>> {
  const leads = await needDeals(db, opts.only ?? null, opts.since ?? null);
  const created: string[] = [];
  const adopted: string[] = [];
  const failed: string[] = [];

  for (const [i, lead] of leads.entries()) {
    const name = dealName(lead.company ?? lead.email);
    // Each lead costs two or three searches, and the limit is per second. A
    // short pause between them keeps the backoff above as the exception rather
    // than the rhythm. Only ever a handful of leads per run once live, so this
    // is paid in full only by a backfill.
    if (i > 0) await new Promise((res) => setTimeout(res, 350));
    try {
      // A dry run asks HubSpot both real questions — does this person exist,
      // and does this company already have an open deal — because those
      // answers are the whole point of previewing. A preview that reports
      // seven creations where four are adoptions has to be distrusted, and a
      // preview that has to be distrusted is worse than none.
      const contactId = opts.dryRun
        ? await findContact(token, lead.email)
        : (await findContact(token, lead.email)) ?? await createContact(token, lead);

      let dealId = await existingDeal(token, contactId, lead.email);
      const wasAdopted = dealId !== null;

      if (opts.dryRun) {
        (wasAdopted ? adopted : created).push(
          wasAdopted
            ? `${lead.email} → company already has deal ${dealId}, would adopt`
            : `${lead.email} → would create "${name}" (${lead.owner})` +
              (contactId ? "" : " + new contact"),
        );
        continue;
      }

      if (!dealId) {
        // No `amount` and no `closedate`. Both are guesses at this stage, and
        // a guessed close date is the worse of the two: it lands in somebody's
        // forecast as though a person had meant it.
        const deal = await hs(token, "POST", "/crm/v3/objects/deals", {
          properties: {
            dealname: name,
            pipeline: PIPELINE,
            dealstage: FIRST_CONTACT,
            hubspot_owner_id: OWNER_ID[lead.owner],
          },
          associations: [{
            to: { id: contactId! },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT }],
          }],
        });
        dealId = String(deal.id);
        try {
          await logReply(token, dealId, contactId!, lead);
        } catch (_) { /* the deal is the point; its transcript is a bonus */ }
      }

      // Written only once HubSpot has confirmed the deal exists. Until this
      // line lands the lead still reads as "needs a deal" and the next run
      // retries it — which is exactly what should happen.
      await db.from("hubspot_pushes").upsert({
        email: lead.email,
        deal_id: dealId,
        contact_id: contactId,
        deal_name: wasAdopted ? null : name,
        owner: lead.owner,
        campaign_id: lead.campaign_id,
        pushed_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        last_error: null,
      }, { onConflict: "email" });

      (wasAdopted ? adopted : created).push(lead.email);
    } catch (e: any) {
      failed.push(`${lead.email}: ${e.message}`);
      // A dry run reports and writes nothing, failures included. It wrote them
      // once: the rate-limit dry run left two rows behind with an error on
      // them, which is a preview altering the thing it previewed.
      if (opts.dryRun) continue;
      // The attempt is recorded; the deal id is not. Nothing is crossed off,
      // so this lead is in the next run's list unchanged.
      const { data: prior } = await db
        .from("hubspot_pushes").select("attempts").eq("email", lead.email).maybeSingle();
      await db.from("hubspot_pushes").upsert({
        email: lead.email,
        owner: lead.owner,
        campaign_id: lead.campaign_id,
        attempts: (prior?.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: String(e.message).slice(0, 500),
      }, { onConflict: "email" });
    }
  }

  return {
    considered: leads.length,
    created: created.length,
    adopted: adopted.length,
    failed: failed.length,
    detail: { created, adopted, failed },
  };
}
