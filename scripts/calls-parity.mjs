#!/usr/bin/env node
/**
 * Every figure on a Calls campaign page, against the pile behind its own click.
 *
 * Written 21 Aug 2026 as the gate on the Kanban board rebuild (CALLS_BOARD_PLAN
 * §8-§10). Run it before the refactor and after it: the nine numbers must be
 * identical on both sides, or the branch changed a fact while it was moving
 * pixels, which is the one thing a redesign is not allowed to do.
 *
 * The figures are recomputed here from raw rows rather than imported from
 * lib/calls.js on purpose. Importing callStats would only prove callStats
 * equals itself; this is a second implementation of the definitions written
 * down in CALL_LOGS.md §3, and parity means the two agree.
 *
 * Four invariants:
 *
 *   1 · PARTITION  the five statusOf() buckets sum to contacts.length exactly.
 *                  Nobody in two columns, nobody in none. On a list a lost row
 *                  is a short page; on a Kanban it is a person who does not
 *                  exist.
 *   2 · TILE=CLICK the count the rendered page prints for a filter equals the
 *                  count computed here. Needs a dev server; skipped without one.
 *   3 · CALLS≠PEOPLE  "Calls made" counts calls and its click lists people, so
 *                  they are allowed to differ — but the calls belonging to the
 *                  listed people must sum back to the tile.
 *   4 · MEETINGS   the tile counts `meetings` rows, its click lists contacts
 *                  with a booked_meeting call. Reported, and asserted only in
 *                  the direction that must hold: never more meetings than the
 *                  calls that could have booked them.
 *
 * Read-only. Safe against production, which is the point — same anon key, same
 * questions the page asks.
 *
 *   node scripts/calls-parity.mjs [campaign-slug] [rep]
 *
 * Exit 0 = everything agrees. Exit 1 = it says which figure did not, with both
 * numbers.
 */

const SLUG = process.argv[2] ?? "nyc-ll11-safe";
const REP = process.argv[3] ?? "Mark Vasu";
const ORIGIN = process.env.PARITY_ORIGIN ?? "http://localhost:3141";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/** Today in the company's timezone, the way lib/db.js does it. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

let failures = 0;
const ok = (name, got, want, note = "") => {
  const good = got === want;
  if (!good) failures++;
  console.log(`${good ? "  ok  " : "FAIL  "}${name.padEnd(34)} ${String(got).padStart(7)}${good ? "" : ` != ${want}`}${note ? `   ${note}` : ""}`);
};

const camps = await rest(`call_campaigns?slug=eq.${SLUG}&select=id,display_name`);
if (!camps.length) throw new Error(`no call campaign called "${SLUG}"`);
const camp = camps[0];

// Contacts page past PostgREST's 1,000-row cap, the same way contactsFor does.
const contacts = [];
for (let from = 0; ; from += 1000) {
  const page = await rest(
    `call_contacts?call_campaign_id=eq.${camp.id}&select=*&order=id&limit=1000&offset=${from}`
  );
  contacts.push(...page);
  if (page.length < 1000) break;
}

const calls = await rest(
  `phone_calls?select=*,call_contacts!inner(call_campaign_id)` +
    `&call_contacts.call_campaign_id=eq.${camp.id}&deleted_at=is.null` +
    `&order=call_date.desc,created_at.desc`
);

const meetings = calls.length
  ? await rest(
      `meetings?select=id,source_call_id,meeting_date,status&deleted_at=is.null` +
        `&source_call_id=in.(${calls.map((c) => c.id).join(",")})`
    )
  : [];

/* ── the definitions, second implementation ──────────────────────────────── */
const t = today();
const byContact = new Map();
for (const c of calls) {
  if (!c.contact_id) continue;
  if (!byContact.has(c.contact_id)) byContact.set(c.contact_id, []);
  byContact.get(c.contact_id).push(c);
}
const callsOf = (ct) => byContact.get(ct.id) ?? [];
const reached = (ct) => callsOf(ct).some((c) => c.outcome !== "not_reached");
const lastOutcome = (ct) => callsOf(ct)[0]?.outcome ?? null;
const statusOf = (ct) => (ct.dnc ? "dnc" : !callsOf(ct).length ? "never_called" : lastOutcome(ct));
const working = contacts.filter((ct) => !ct.dnc);

const fig = {
  callsMade: calls.length,
  peopleReached: contacts.filter(reached).length,
  meetingsBooked: meetings.filter((m) => m.status !== "cancelled").length,
  followupsDue: working.filter((ct) => ct.callback_date && ct.callback_date <= t).length,
  neverCalled: working.filter((ct) => !callsOf(ct).length).length,
  notReached: contacts.filter((ct) => callsOf(ct).length && !reached(ct)).length,
  notInterested: contacts.filter((ct) => lastOutcome(ct) === "not_interested").length,
  buildingsCovered: contacts.filter(reached).reduce((a, ct) => a + (ct.buildings_count ?? 0), 0),
  doNotCall: contacts.filter((ct) => ct.dnc).length,
};

console.log(`\n${camp.display_name}  ·  ${contacts.length} contacts · ${calls.length} calls · ${meetings.length} meetings\n`);
console.log("THE NINE FIGURES");
for (const [k, v] of Object.entries(fig)) console.log(`  ${k.padEnd(34)} ${String(v).padStart(7)}`);

/* ── 1 · PARTITION ───────────────────────────────────────────────────────── */
console.log("\n1 · PARTITION — the five board columns account for everyone");
const COLS = ["never_called", "not_reached", "follow_up", "not_interested", "booked_meeting"];
const bucket = new Map(COLS.map((k) => [k, 0]));
let dnc = 0,
  stray = [];
for (const ct of contacts) {
  const s = statusOf(ct);
  if (s === "dnc") dnc++;
  else if (bucket.has(s)) bucket.set(s, bucket.get(s) + 1);
  else stray.push(`${ct.full_name}: ${s}`);
}
for (const [k, v] of bucket) console.log(`  ${k.padEnd(34)} ${String(v).padStart(7)}`);
console.log(`  ${"dnc (a filter, not a column)".padEnd(34)} ${String(dnc).padStart(7)}`);
ok("buckets + dnc = contacts", [...bucket.values()].reduce((a, b) => a + b, 0) + dnc, contacts.length);
ok("no outcome outside the five", stray.length, 0, stray.join(", "));

/* ── 3 · CALLS vs PEOPLE ─────────────────────────────────────────────────── */
console.log("\n3 · CALLS != PEOPLE — the asymmetry is by design, but it must reconcile");
const called = contacts.filter((ct) => callsOf(ct).length);
ok("calls of the listed people", called.reduce((a, ct) => a + callsOf(ct).length, 0), fig.callsMade,
   `${called.length} people carry ${fig.callsMade} calls`);

/* ── 4 · MEETINGS ────────────────────────────────────────────────────────── */
console.log("\n4 · MEETINGS — rows, not outcomes");
const bookedCalls = calls.filter((c) => c.outcome === "booked_meeting").length;
const bookedPeople = contacts.filter((ct) => callsOf(ct).some((c) => c.outcome === "booked_meeting")).length;
console.log(`  ${"booked_meeting calls".padEnd(34)} ${String(bookedCalls).padStart(7)}`);
console.log(`  ${"people with one".padEnd(34)} ${String(bookedPeople).padStart(7)}`);
ok("meetings <= calls that booked one", fig.meetingsBooked <= bookedCalls, true,
   fig.meetingsBooked === bookedPeople ? "" : "tile and click differ — expected when a call has no meeting row");

/* ── 2 · TILE = CLICK ────────────────────────────────────────────────────── */
console.log("\n2 · TILE = CLICK — what the rendered page prints for each filter");
const base = `${ORIGIN}/calls/${encodeURIComponent(REP)}/${SLUG}`;
let live = true;
try {
  await fetch(base, { signal: AbortSignal.timeout(4000) });
} catch {
  live = false;
  console.log(`  (no server on ${ORIGIN} — skipped)`);
}
if (live) {
  const shown = async (f) => {
    const r = await fetch(`${base}?${f ? `f=${f}&` : ""}v=all`);
    // React writes <!-- --> between text nodes; strip them before matching.
    const html = (await r.text()).replaceAll("<!-- -->", "");
    const m = html.match(/[—-]\s*([\d,]+)\s*shown/);
    return m ? Number(m[1].replace(/,/g, "")) : NaN;
  };
  const PAIRS = [
    ["reached  (Spoke to someone)", "reached", fig.peopleReached],
    ["due      (Follow-ups due)", "due", fig.followupsDue],
    ["never    (Never called)", "never", fig.neverCalled],
    ["notreached (Didn't reach)", "notreached", fig.notReached],
    ["notint   (Not interested)", "notint", fig.notInterested],
    ["dnc      (Do-not-call)", "dnc", fig.doNotCall],
  ];
  for (const [name, f, want] of PAIRS) ok(name, await shown(f), want);
  ok("no filter = every working row", await shown(null), contacts.filter((ct) => !ct.dnc).length);
}

console.log(
  failures
    ? `\n${failures} disagreement(s). The branch is wrong, or a definition moved.\n`
    : "\nEverything agrees.\n"
);
process.exit(failures ? 1 : 0);
