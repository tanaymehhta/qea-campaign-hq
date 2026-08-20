import { db, today, repList } from "./db";

/**
 * The Calls roster: campaign_groups.owner (the way /meetings derives reps)
 * unioned with call_campaigns.owner, so a rep who only runs a phone list
 * still appears. No rep table — same reasoning as repList().
 */
export async function callRepList() {
  const [{ reps }, { data: camps }] = await Promise.all([
    repList(),
    db.from("call_campaigns").select("id, slug, display_name, description, objective, owner, status, created_at"),
  ]);
  const campaigns = camps ?? [];
  const known = new Set(reps.map((r) => r.id));
  const extra = [...new Set(campaigns.map((c) => c.owner?.trim()).filter(Boolean))]
    .filter((o) => !known.has(o));
  // Extra reps get the neutral tint; repList already handed the others out
  // in group order, and stability matters more than variety.
  const all = [
    ...reps,
    ...extra.map((name) => ({
      id: name, name,
      initials: name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
      role: "Calls only", tint: "var(--tint-n)", ink: "var(--ink-1)",
    })),
  ];
  return { reps: all, campaigns };
}

/** Every contact in a call campaign. PostgREST caps a select at 1,000 rows
 *  and this list is ~1,250, so it pages until a short page comes back. */
export async function contactsFor(campaignId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("call_contacts")
      .select("*")
      .eq("call_campaign_id", campaignId)
      .order("id")
      .range(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Every call logged against a campaign's contacts — the same phone_calls
 *  rows the Overview tile counts; there is no second call table. */
export async function callsFor(campaignId) {
  const { data } = await db
    .from("phone_calls")
    .select("*, call_contacts!inner(call_campaign_id)")
    .eq("call_contacts.call_campaign_id", campaignId)
    .is("deleted_at", null)
    .order("call_date", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * The meetings that came off this campaign's calls, keyed by the call that
 * booked them. `source_call_id` is the link (migration 20260818201145) and it
 * is the only one — there is no copy of the meeting's date on phone_calls, so
 * the call row and the Overview tile cannot drift apart.
 */
export async function meetingsForCalls(calls) {
  const ids = calls.map((c) => c.id);
  if (!ids.length) return new Map();
  const { data } = await db
    .from("meetings")
    .select("id, source_call_id, meeting_date, booked_on, status")
    .in("source_call_id", ids)
    // The fourth reader of `deleted_at`. A call meeting cannot be removed from
    // /meetings — it is the call's — but the filter belongs here anyway, so the
    // rule is the same in every place that reads this table.
    .is("deleted_at", null);
  return new Map((data ?? []).map((m) => [m.source_call_id, m]));
}

/**
 * The call metrics, computed once so tiles and list filters agree.
 *
 * Four outcomes since 20 Aug 2026, and three of them mean you got through:
 * `booked_meeting`, `follow_up` and `not_interested` are all conversations.
 * `not_reached` is the fourth and the only one that isn't. Whether you left a
 * voicemail is a sentence in the note — it used to be three separate outcomes
 * feeding a tile called "No answer", which read 6 when no call in this
 * database had ever had that outcome.
 *
 * Two definitions that are easy to get wrong later:
 * - "Spoke to someone" = DISTINCT contacts with at least one call that got
 *   through. It is not the number of calls, and it is NOT the Overview's
 *   "People reached", which since 20 Aug counts anyone we emailed or dialled
 *   whatever the outcome. Narrower fact, different name.
 * - "Buildings covered" = the sum of buildings_count across contacts
 *   reached. This is the figure that makes the engineer channel's leverage
 *   visible — one reached engineer can cover 63 buildings.
 */
const NOT_REACHED = new Set(["not_reached"]);

export function callStats(contacts, calls, meetingOf = new Map()) {
  const t = today();
  const byContact = new Map();
  for (const c of calls) {
    if (!c.contact_id) continue;
    if (!byContact.has(c.contact_id)) byContact.set(c.contact_id, []);
    byContact.get(c.contact_id).push(c); // already newest-first
  }
  const callsOf = (ct) => byContact.get(ct.id) ?? [];
  const reached = (ct) => callsOf(ct).some((c) => !NOT_REACHED.has(c.outcome));
  const lastOutcome = (ct) => callsOf(ct)[0]?.outcome ?? null;

  const working = contacts.filter((ct) => !ct.dnc);
  const is = {
    due: (ct) => !ct.dnc && ct.callback_date && ct.callback_date <= t,
    never: (ct) => !ct.dnc && !callsOf(ct).length,
    called: (ct) => callsOf(ct).length > 0,
    reached,
    notreached: (ct) => callsOf(ct).length > 0 && !reached(ct),
    notint: (ct) => lastOutcome(ct) === "not_interested",
    meetings: (ct) => callsOf(ct).some((c) => c.outcome === "booked_meeting"),
    dnc: (ct) => ct.dnc,
  };

  return {
    is, callsOf, lastOutcome,
    // One Add is one row, so this is the count of Adds. A second dial to the
    // same person on the same day is a second call and counts as one.
    callsMade: calls.length,
    peopleReached: contacts.filter(reached).length,
    // Meetings, not calls that mentioned one. Two dials that confirm the same
    // 3 September meeting are one meeting, and the `meetings` row is the thing
    // the Overview tile counts — so this tile counts the same rows rather than
    // its own proxy for them. Cancelled ones are out, the rule every other
    // meetings reader applies. Falls back to the outcome count when the caller
    // hasn't loaded the meetings (the rep index does not).
    meetingsBooked: meetingOf.size
      ? [...meetingOf.values()].filter((m) => m.status !== "cancelled").length
      : calls.filter((c) => c.outcome === "booked_meeting").length,
    followupsDue: working.filter(is.due).length,
    neverCalled: working.filter(is.never).length,
    notReached: contacts.filter(is.notreached).length,
    notInterested: contacts.filter(is.notint).length,
    buildingsCovered: contacts.filter(reached).reduce((a, ct) => a + (ct.buildings_count ?? 0), 0),
    doNotCall: contacts.filter(is.dnc).length,
  };
}
