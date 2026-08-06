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
 * Inbound email replies matched to this list's contacts by address. The email
 * world (campaigns, replies) has no FK to call_contacts by design — the two
 * worlds only ever meet on a shared fact — so the join is a best-effort match
 * on lower(email). It is what lets a person's phone touches and their email
 * replies sit in one timeline. Returned as a Map keyed on lowercased email.
 */
export async function repliesForContacts(contacts) {
  const emails = [...new Set(
    contacts.map((c) => c.email?.trim().toLowerCase()).filter(Boolean)
  )];
  const byEmail = new Map();
  if (!emails.length) return byEmail;
  const { data } = await db
    .from("replies")
    .select("lead_email, lead_name, subject, sentiment, channel, received_at")
    .in("lead_email", emails);
  for (const r of data ?? []) {
    const k = r.lead_email?.trim().toLowerCase();
    if (!k) continue;
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k).push(r);
  }
  return byEmail;
}

// The single source of truth for the checkbox outcomes on the "Log the call"
// form. Both the form (labels) and logCall's priority sort read this, so a
// new phone outcome is added in one place, not three.
export const CALL_OUTCOMES = [
  ["booked_meeting", "Booked a meeting"],
  ["follow_up", "Follow up"],
  ["not_interested", "Not interested"],
  ["no_answer", "No answer"],
  ["left_voicemail", "Left voicemail"],
  ["left_email", "Left email"],
  ["other", "Other"],
];

// Every activity type's human label — the timeline, the edit dropdown and the
// stage buttons all read from here so a rename happens once.
export const ACTIVITY_LABEL = {
  booked_meeting: "Booked a meeting", follow_up: "Follow up", not_interested: "Not interested",
  no_answer: "No answer", left_voicemail: "Left voicemail", left_email: "Left email", other: "Other",
  email_sent: "Email sent", proposal_sent: "Proposal sent", won: "Won", lost: "Lost",
};

// Insert-order priority when a single dial ends more than one way: statusOf
// reads the newest row, so whichever outcome is inserted last wins the pill.
// The stage-advancing activities sit at the end (most advanced) so a marker
// like proposal_sent always wins the display over a plain dial submitted with
// it. An outcome missing here sorts first (indexOf -1), which is harmless for
// the single-outcome stage buttons that never submit a pair.
export const OUTCOME_PRIORITY = [
  "left_email", "left_voicemail", "no_answer", "email_sent",
  "other", "not_interested", "follow_up", "booked_meeting",
  "proposal_sent", "won", "lost",
];

// The rungs of the funnel, in order. A contact's stage is the highest rung
// their history reaches — derived, never stored.
export const STAGE_STEPS = [
  ["new", "New"],
  ["attempted", "Attempted"],
  ["connected", "Connected"],
  ["meeting", "Meeting"],
  ["proposal", "Proposal"],
  ["closed", "Closed"],
];

// A phone dial counts as "reached" (a live conversation) for these outcomes —
// the person picked up and talked. Voicemails, no-answers and emails do not.
const REACHED_OUTCOMES = new Set(["booked_meeting", "follow_up", "not_interested", "other", "won"]);

/**
 * One contact's whole story, oldest-first: every phone_calls row plus every
 * matched email reply, merged and sorted so it reads as the timeline it is.
 * `callsByContact` is the map callStats already built (newest-first); this
 * reverses into chronological order for reading.
 */
export function timelineFor(ct, callsByContact, repliesByEmail) {
  const calls = callsByContact.get(ct.id) ?? [];
  const key = ct.email?.trim().toLowerCase();
  const replies = key ? (repliesByEmail.get(key) ?? []) : [];
  const events = [
    ...calls.map((c) => ({
      date: c.call_date, at: c.created_at, kind: "call",
      channel: c.channel ?? "phone", outcome: c.outcome, note: c.note, rep: c.rep,
    })),
    ...replies.map((r) => ({
      date: (r.received_at ?? "").slice(0, 10), at: r.received_at, kind: "reply",
      sentiment: r.sentiment, note: r.subject,
    })),
  ].filter((e) => e.date);
  events.sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at ?? "") < (b.at ?? "") ? -1 : 1)
  );
  return events;
}

/**
 * The derived stage for one contact, plus the strip the UI draws.
 *
 * The rung is the furthest point the history reaches, so a later follow-up
 * call never drags someone back from Proposal to Connected. Won and Lost are
 * terminal and win outright — "then ended", in the user's words. A do-not-call
 * with no explicit close reads as Lost. not_interested is both a live contact
 * (they talked) and an ending, so it lights Connected's date and closes as Lost.
 */
export function stageOf(events, ct) {
  let touch = null, connected = null, meeting = null, proposal = null, won = null, lost = null;
  for (const e of events) { // oldest-first, so the first hit is the earliest date
    if (touch === null) touch = e.date;
    const posReply = e.kind === "reply" && (e.sentiment === "interested" || e.sentiment === "referral");
    const reachedCall = e.kind === "call" && (e.channel ?? "phone") === "phone" && REACHED_OUTCOMES.has(e.outcome);
    if (connected === null && (posReply || reachedCall)) connected = e.date;
    if (meeting === null && e.outcome === "booked_meeting") meeting = e.date;
    if (proposal === null && e.outcome === "proposal_sent") proposal = e.date;
    if (won === null && e.outcome === "won") won = e.date;
    if (lost === null && (e.outcome === "lost" || e.outcome === "not_interested")) lost = e.date;
  }
  if (ct?.dnc && lost === null) lost = (ct.updated_at ?? "").slice(0, 10) || touch;

  let key, variant = null;
  if (won) { key = "closed"; variant = "won"; }
  else if (lost) { key = "closed"; variant = "lost"; }
  else if (proposal) key = "proposal";
  else if (meeting) key = "meeting";
  else if (connected) key = "connected";
  else if (touch) key = "attempted";
  else key = "new";

  const rank = STAGE_STEPS.findIndex(([k]) => k === key);
  const dateOf = { new: null, attempted: touch, connected, meeting, proposal, closed: won || lost };
  const steps = STAGE_STEPS.map(([k, label], i) => ({
    key: k,
    label: k === "closed" && variant ? (variant === "won" ? "Won" : "Lost") : label,
    done: i <= rank,
    current: i === rank,
    date: dateOf[k] ?? null,
  }));

  return { key, variant, rank, badge: variant || key, label: steps[rank].label, steps };
}

/**
 * The call metrics, computed once so tiles and list filters agree.
 *
 * Two definitions that are easy to get wrong later:
 * - "People reached" = DISTINCT contacts with at least one call whose
 *   outcome is a live contact — not 'no_answer', and not a voicemail or
 *   email left in lieu of one. It is not the number of calls.
 * - "Buildings covered" = the sum of buildings_count across contacts
 *   reached. This is the figure that makes the engineer channel's leverage
 *   visible — one reached engineer can cover 63 buildings.
 */
const NOT_REACHED = new Set(["no_answer", "left_voicemail", "left_email", "email_sent"]);

export function callStats(contacts, calls) {
  const t = today();
  const byContact = new Map();
  for (const c of calls) {
    if (!c.contact_id) continue;
    if (!byContact.has(c.contact_id)) byContact.set(c.contact_id, []);
    byContact.get(c.contact_id).push(c); // already newest-first
  }
  const callsOf = (ct) => byContact.get(ct.id) ?? [];
  // A live conversation is a phone touch that connected — not an email/proposal
  // marker (another channel) and not a voicemail/no-answer.
  const reached = (ct) => callsOf(ct).some((c) => (c.channel ?? "phone") === "phone" && !NOT_REACHED.has(c.outcome));
  const lastOutcome = (ct) => callsOf(ct)[0]?.outcome ?? null;

  const working = contacts.filter((ct) => !ct.dnc);
  const is = {
    due: (ct) => !ct.dnc && ct.callback_date && ct.callback_date <= t,
    never: (ct) => !ct.dnc && !callsOf(ct).length,
    called: (ct) => callsOf(ct).length > 0,
    reached,
    noanswer: (ct) => callsOf(ct).length > 0 && !reached(ct),
    notint: (ct) => lastOutcome(ct) === "not_interested",
    meetings: (ct) => callsOf(ct).some((c) => c.outcome === "booked_meeting"),
    dnc: (ct) => ct.dnc,
  };

  return {
    is, callsOf, lastOutcome,
    callsMade: calls.length,
    peopleReached: contacts.filter(reached).length,
    meetingsBooked: calls.filter((c) => c.outcome === "booked_meeting").length,
    followupsDue: working.filter(is.due).length,
    neverCalled: working.filter(is.never).length,
    noAnswer: contacts.filter(is.noanswer).length,
    notInterested: contacts.filter(is.notint).length,
    buildingsCovered: contacts.filter(reached).reduce((a, ct) => a + (ct.buildings_count ?? 0), 0),
    doNotCall: contacts.filter(is.dnc).length,
  };
}
