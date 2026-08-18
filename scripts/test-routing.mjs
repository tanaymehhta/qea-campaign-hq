/**
 * node scripts/test-routing.mjs
 *
 * Every case below is a row that exists in inbound_people today. The two that
 * matter are London/ON and Chennai/TN: a naive reading of either sends the lead
 * to the wrong continent.
 */
import assert from "node:assert/strict";
import { locate, repsFor } from "../lib/inbound/routing.js";

const at = (city, state, company) => locate({ city, state }, company);

// Real rows
assert.equal(at("Boston", "Massachusetts").region, "US");
assert.equal(at("New York", "NY").region, "US");
assert.equal(at("Laguna Niguel", "CA").region, "US");
assert.equal(at("London", "ON").region, "CA", "London ON is Ontario, not England");
assert.equal(at("Toronto", "ON").region, "CA");
assert.equal(at("Benito Juarez", "CMX").region, "MX");
assert.equal(at("Monterrey", "NLE").region, "MX");
assert.equal(at("Dubai", "DU").region, "AE");
assert.equal(at("Chennai", "TN").region, "ASIA", "Chennai TN is Tamil Nadu, not Tennessee");
assert.equal(at("Osaka", "27").region, "ASIA");

// Precedence: a recorded country beats everything; the visitor's own city beats
// the company's domain; the domain only speaks when the visitor has no geo.
assert.equal(locate({ city: "Chennai", state: "TN" }, { hq_country: "US" }).region, "US");
assert.equal(locate({}, { domain: "mediclinic.ae" }).region, "AE");
assert.equal(locate({ city: "Toronto" }, { domain: "example.co.uk" }).region, "CA",
  "the person is in Toronto; the company's ccTLD does not move them");
assert.equal(locate({ city: "General Trias", state: "40" }, { domain: "asistio.ca" }).region, "ASIA",
  "a .ca domain must not pull a Philippines visitor into Canada");
// On a company-level payload there is no person row, and hq_city is where the
// visitor was sitting. It routes; the basis says so rather than calling it a
// head office.
assert.equal(locate({}, { hq_city: "Dubai" }).region, "AE");
assert.equal(locate({}, { hq_city: "Dubai" }).basis, "visiting city");

// Buildings are the last resort, below the visitor's own city, because they
// answer a different question — where the assets are, not where the human was.
const barings = [{ country: "US" }, { country: "US" }, { country: "DE" }, { country: "SE" }];
assert.equal(locate({}, { hq_city: "New York", hq_state: "NY" }, barings).region, "US");
assert.equal(locate({}, {}, barings).region, "US", "the larger half of a split portfolio wins");
assert.equal(locate({}, {}, barings).basis, "where their buildings are");
assert.equal(locate({}, {}, [{ city: "Toronto", state: "ON" }]).region, "CA",
  "a building with no country still resolves through its city");
assert.equal(locate({}, {}, []).region, "UNKNOWN");

// A place we hold but cannot read stops at unrouted rather than falling through
// to a weaker signal and landing in the wrong queue confidently.
assert.equal(locate({ city: "Nowhereville", state: "ZZ" }, { domain: "x.ca" }).region, "UNKNOWN");
assert.equal(at("", "").region, "UNKNOWN");
assert.equal(at("Nowhere", "ZZ").region, "UNKNOWN");
assert.equal(at("", "").basis, "nothing to go on");

// The division
assert.deepEqual(repsFor("US").map((r) => r.id), ["mark-vasu"]);
assert.deepEqual(repsFor("MX").map((r) => r.id), ["justin-kim"]);
assert.deepEqual(repsFor("GB").map((r) => r.id), ["justin-kim"]);
assert.deepEqual(repsFor("AE").map((r) => r.id), ["gulraiz-khalid"]);
assert.deepEqual(repsFor("ASIA").map((r) => r.id), ["gulraiz-khalid"]);
assert.deepEqual(repsFor("CA").map((r) => r.id), ["justin-kim", "mark-dolan"], "Canada is worked by both");
assert.deepEqual(repsFor("EU").map((r) => r.id), ["unrouted"]);
assert.deepEqual(repsFor("UNKNOWN").map((r) => r.id), ["unrouted"]);


// Three real rows that used to stop at Unrouted with the label "No location",
// while the row itself said plainly where they were. Two of them belong to a rep.
assert.equal(at("West Jakarta", "JK").region, "ASIA", "JK is Jakarta, not a US state");
assert.equal(at("Sugita", "14").region, "ASIA", "a bare prefecture number is unreadable; the city is not");
assert.equal(at("Paris", "IDF").region, "EU", "IDF is Ile-de-France");
assert.deepEqual(repsFor("ASIA").map((r) => r.id), ["gulraiz-khalid"]);
// Paris, Texas must not become Paris, France: the city is deliberately absent
// from the table and the state code settles it.
assert.equal(at("Paris", "TX").region, "US");

// Reserved TLDs never resolve, so a company under one was typed in.
const { RESERVED_TLD } = await import("../lib/inbound/routing.js");
assert.ok(RESERVED_TLD.test("metroharbor.example"));
assert.ok(RESERVED_TLD.test("foo.test") && RESERVED_TLD.test("a.invalid"));
assert.ok(!RESERVED_TLD.test("barings.com") && !RESERVED_TLD.test("example.com"));

// ── plain language ──────────────────────────────────────────────────────────
const { pageTitle, bullets, verdict } = await import("../lib/inbound/words.js");

// Is a company worth selling to. The pipeline answers in two columns and they
// disagree on 11 of the 42 companies that have visited, so both must be read:
// reading account_type alone filed every one of those as a prospect.
const lane = (account_type, research_status) =>
  verdict({ account_type, research_status }).lane;

assert.equal(lane("owner_operator", "needs_review"), "relevant");
assert.equal(lane("consultant", "ready"), "relevant");
assert.equal(lane("other_icp", "needs_review"), "relevant");
assert.equal(lane("not_icp", "not_icp"), "irrelevant");
// Ten real rows: ruled out by status, with no account_type ever written.
assert.equal(lane(null, "not_icp"), "irrelevant",
  "research_status alone must be able to rule a company out");
// New Horizons Preschool: the two columns contradict each other. Out wins, and
// the disagreement is shown rather than resolved silently.
assert.equal(lane("owner_operator", "not_icp"), "irrelevant");
assert.equal(verdict({ account_type: "owner_operator", research_status: "not_icp" }).conflict,
  "Owns buildings");
// Two lanes, not three: a company nobody has ruled out is a prospect. The old
// "not researched yet" lane held 49 companies that had all been researched and
// had all crashed, which is a fact about the run and not about the company.
assert.equal(lane(null, "new"), "relevant");
assert.equal(lane(null, null), "relevant");
assert.equal(verdict({}).short, "Not researched yet");

assert.equal(pageTitle("/"), "Home page");
assert.equal(pageTitle("https://qeatech.com/pricing"), "Pricing");
assert.equal(pageTitle("/about-us/"), "About us");
assert.equal(pageTitle("/how-ai-is-driving-a-new-era-of-efficient-building-envelope-retrofits/"),
  "How AI is driving a new era of efficient building envelope retrofits");
assert.equal(pageTitle("/projects/comparing-energy-efficiency-across-multiple-hospital-wings-2/"),
  "Projects: Comparing energy efficiency across multiple hospital wings");

// An abbreviation's full stop must not start a new bullet: the first sentence
// stays whole, and the genuine sentence break after it still splits.
const b = bullets("Assets (e.g. Franklin Distribution Center) are held for clients. Sectors are logistics.");
assert.equal(b.length, 2, JSON.stringify(b));
assert.ok(b[0].includes("Franklin Distribution Center) are held"), `e.g. split it: ${b[0]}`);

// Citations and the model's own labels are stripped.
assert.ok(!bullets("Scale: $502B AUM [https://x.com/a] as of June 2026.")[0].startsWith("Scale"));
assert.ok(!bullets("Scale: $502B AUM [https://x.com/a] as of June 2026.")[0].includes("http"));

// ── a failure is not a verdict ──────────────────────────────────────────────
const { isApiError, errorReason } = await import("../lib/inbound/words.js");

// 56 of the 95 companies carry this instead of a classification, verbatim.
const CREDITS_402 = "LLM/search failed (Error code: 402 - {'error': {'message': "
  + "'Insufficient credits. Add more using https://openrouter.ai/settings/credits', 'code': 402}})";
const APOLLO_422 = `422 {"error":"You have insufficient credits! `
  + `<a href='https://app.apollo.io/#/settings/plans/upgrade'>upgrade</a>"}`;

assert.ok(isApiError(CREDITS_402), "Canaccord's reason is a provider failure, not prose");
assert.ok(isApiError(APOLLO_422));
assert.ok(!isApiError("Raad is an aerial-intelligence/drone-services platform selling "
  + "facade & roof inspections."), "a real classification must not read as an error");
assert.ok(!isApiError(""), "an empty reason is neither");
assert.ok(!isApiError(null));

assert.equal(errorReason(CREDITS_402), "we were out of OpenRouter credits");
assert.equal(errorReason(APOLLO_422), "we were out of Apollo credits",
  "Apollo says 'insufficient credits' before it names itself");
assert.equal(errorReason("HTTP 429 rate limit exceeded"), "the provider rate-limited us");
assert.equal(errorReason("read timed out"), "the step timed out");
// An unrecognised failure falls to a sentence, never to undefined.
assert.equal(errorReason("boom"), "the step failed — see details");
assert.equal(errorReason(null), "the step failed — see details");

// ScanSource Chile, Self Employed and BAMO: filed "not a fit" off a call that
// returned 402. A verdict read from a crash is not a verdict, and all three
// belong in the queue with a Research-failed chip.
const scansource = { account_type: "not_icp", research_status: "not_icp",
                     account_type_reason: CREDITS_402 };
assert.equal(verdict(scansource).lane, "relevant",
  "a not_icp whose reason is a 402 must not rule the company out");
assert.equal(verdict(scansource).short, "Not decided");
// A real rule-out still rules out — the exception is the failure, not not_icp.
assert.equal(verdict({ account_type: "not_icp", research_status: "not_icp",
  account_type_reason: "Notion Labs is a pure software/SaaS company with no buildings." }).lane,
  "irrelevant");

// The chip carries what the lane used to: 39 researched, 56 failed, 0 never run.
const { researchChip } = await import("../lib/inbound/words.js");
assert.equal(researchChip(scansource).state, "failed");
assert.equal(researchChip({ account_type_reason: "Raad is an aerial-intelligence platform." }).state,
  "done");
assert.equal(researchChip({}).state, "none");
assert.equal(researchChip({}).label, "Not researched");

// ── the timeline ────────────────────────────────────────────────────────────
const { timeline } = await import("../lib/inbound/queue.js");

const state = (dots) => dots.map((d) => d.state).join(",");
const SEEN = "2026-08-10T18:19:07Z";

// Goodman Gold Challenge: three clean runs, nothing broke. Its stage 1 says
// `needs_review`, which is a verdict about the company and not a failure.
const clean = timeline(SEEN,
  [{ id: "r3", stage_no: 3, status: "ok", started_at: "2026-08-07T15:38:54Z" },
   { id: "r2", stage_no: 2, status: "ok", started_at: "2026-08-07T15:38:43Z" },
   { id: "r1", stage_no: 1, status: "needs_review", started_at: "2026-08-07T15:34:40Z" }],
  new Map());
assert.equal(state(clean), "ok,ok,ok,ok", "a clean run is green; needs_review is not a failure");

// Canaccord: the regression. The run's own status column never says error, and
// three nodes inside it returned 402.
const canaccord = timeline(SEEN,
  [{ id: "c3", stage_no: 3, status: "ok", started_at: "2026-08-10T21:52:49Z" },
   { id: "c2", stage_no: 2, status: "ok", started_at: "2026-08-10T21:52:29Z" },
   { id: "c1", stage_no: 1, status: "needs_review", started_at: "2026-08-10T21:51:20Z" },
   { id: "c0", stage_no: 1, status: "ok", started_at: "2026-08-10T19:22:14Z" }],
  new Map([["c1", [
    { node_name: "research_overview", status: "error", error: CREDITS_402 },
    { node_name: "find_locations", status: "error", error: CREDITS_402 },
    { node_name: "plan_research", status: "ok" },
  ]]]));
assert.equal(state(canaccord), "ok,bad,ok,ok", "an ok run holding a failed node is red");
assert.equal(canaccord[1].reason, "we were out of OpenRouter credits");
assert.equal(canaccord[1].failures.length, 2);
assert.equal(canaccord[1].attempts, 2, "two stage-1 runs — attempt 2 of 2");

// Barings' stage 2: every node reports ok and apollo_reveal carries its own 422
// in output_summary.errors. That is the shape that read as 32 clean nodes.
const baringsStage2 = timeline(SEEN,
  [{ id: "b2", stage_no: 2, status: "ok", started_at: "2026-08-05T19:26:21Z" }],
  new Map([["b2", [
    { node_name: "apollo_sweep", status: "ok", output_summary: { errors: [], org_total: 1781 } },
    { node_name: "apollo_reveal", status: "ok", output_summary: { errors: [APOLLO_422] } },
  ]]]));
assert.equal(baringsStage2[2].state, "bad", "a node reporting ok while carrying errors is red");
assert.equal(baringsStage2[2].reason, "we were out of Apollo credits");

// IBM Research: three clean runs, every node ok, and zero people and zero
// drafts at the end of them. The page showed four green ticks over a panel
// reading "No contacts found." Green has to mean something came out.
const IBM_RUNS = [
  { id: "m3", stage_no: 3, status: "ok", started_at: "2026-08-07T12:13:00Z" },
  { id: "m2", stage_no: 2, status: "ok", started_at: "2026-08-07T12:13:00Z" },
  { id: "m1", stage_no: 1, status: "ok", started_at: "2026-08-07T12:07:00Z" },
];
const ibm = timeline(SEEN, IBM_RUNS, new Map(), { 2: 0, 3: 0 });
assert.equal(state(ibm), "ok,ok,none,none", "a clean stage that produced nothing is not a tick");
assert.equal(ibm[2].label, "Nobody found", "the dot says what happened, not what it hoped for");
assert.equal(ibm[3].label, "No emails written");
assert.ok(ibm[2].when, "it still ran, and still says when");
assert.equal(ibm[2].failures.length, 0, "empty is not broken — nothing goes in the failure fold");

// One person found is a tick again, and stage 1 is never judged this way:
// nothing counts its output, so it is not in `produced` at all.
const partial = timeline(SEEN, IBM_RUNS, new Map(), { 2: 1, 3: 0 });
assert.equal(state(partial), "ok,ok,ok,none");

// A failure outranks emptiness. Canaccord's stage 1 broke, which is a different
// sentence from "it found nobody" and must not be softened into one.
assert.equal(timeline(SEEN,
  [{ id: "c1", stage_no: 1, status: "ok", started_at: SEEN }],
  new Map([["c1", [{ node_name: "research_overview", status: "error", error: CREDITS_402 }]]]),
  { 1: 0 })[1].state, "bad");

// Passing no counts at all leaves every clean stage green — the three arguments
// the rest of this file calls `timeline` with still mean what they meant.
assert.equal(state(timeline(SEEN, IBM_RUNS, new Map())), "ok,ok,ok,ok");

// A stage with no run is grey, and says so rather than claiming a date.
assert.equal(state(timeline(SEEN, [], new Map())), "ok,todo,todo,todo");
assert.equal(timeline(null, [], new Map())[0].state, "todo", "no arrival date is not green");
// 99 runs predate `stage_no` and are placed by graph name instead.
assert.equal(state(timeline(SEEN,
  [{ id: "g", graph_name: "research", stage_no: null, status: "ok", started_at: SEEN }],
  new Map())), "ok,ok,todo,todo");
// Stage order, never clock order: Canaccord's stage 3 ran before its stage 2.
assert.deepEqual(canaccord.map((d) => d.stage), [0, 1, 2, 3]);

// ── is this company running ─────────────────────────────────────────────────
// One boolean, read by five Restart buttons, two pages and the dock. The two
// cases that matter are the twenty-second gap where only the request row
// exists, and the press whose run never appeared.
const { busyOf } = await import("../lib/inbound/queue.js");
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const press = (mins, stage = 1) =>
  ({ stage, state: "dispatched", requested_at: ago(mins) });

assert.equal(busyOf([], null), null, "nothing pressed, nothing running");
assert.equal(busyOf([{ id: "r", stage_no: 2, status: "ok", started_at: ago(30) }], null), null);

// A live run, whatever the request row says.
assert.equal(
  busyOf([{ id: "r", stage_no: 2, status: "running", started_at: ago(1) }], null).phase,
  "running");
assert.equal(
  busyOf([{ id: "r", stage_no: 2, status: "running", started_at: ago(1) }], null).stage, 2);
// Placed by graph name where stage_no is null, same as the timeline.
assert.equal(
  busyOf([{ id: "r", graph_name: "research", stage_no: null, status: "running" }], null).stage, 1);

// The gap: GitHub is booting and this database holds no run at all. Without
// this the page a rep is staring at right after pressing looks exactly like the
// page that did nothing.
assert.equal(busyOf([], press(0.2)).phase, "starting");
assert.equal(busyOf([], press(0.2, 2)).stage, 2);

// The runner has written something since the press, so the run reports on
// itself now — two sources for one fact is how a page contradicts itself.
assert.equal(
  busyOf([{ id: "r", stage_no: 1, status: "ok", started_at: ago(1) }], press(3)), null,
  "a request whose run has already come and gone is spent");

// A dispatch that succeeded and then died leaves the row behind for good;
// nothing marks a request finished. Ten minutes is the bound.
assert.equal(busyOf([], press(9)).phase, "starting");
assert.equal(busyOf([], press(11)), null, "a press with no run after ten minutes is not running");

// ── the vocabulary a rep reads ──────────────────────────────────────────────
const { emailSource, roleWords } = await import("../lib/inbound/words.js");

// All six sources, and the one row that says `apollo(corrected rb2b)`.
assert.equal(emailSource("apollo"), "From Apollo");
assert.equal(emailSource("apollo(corrected rb2b)"), "From Apollo");
assert.equal(emailSource("stage1"), "From RB2B, when they visited");
assert.equal(emailSource("web_public"), "Found on their website");
assert.equal(emailSource("quarantined_off_domain"),
  "Guessed — a personal address, not a company one");
assert.equal(emailSource("quarantined_name_mismatch"),
  "Guessed — the name doesn't match the address");
assert.equal(emailSource("none"), "No address found");
assert.equal(emailSource(null), null, "no source is a row the page leaves off");

// `.replace(/_/g, " ")` alone gave "c suite" and "consultant leadership".
assert.equal(roleWords("c_suite"), "C-suite");
assert.equal(roleWords("svp"), "SVP");
assert.equal(roleWords("vp"), "VP");
assert.equal(roleWords("ic"), "IC");
assert.equal(roleWords("consultant_leadership"), "Consultant leadership");
assert.equal(roleWords("sustainability_energy"), "Sustainability energy");
assert.equal(roleWords(null), null);

// ── where each company stopped ──────────────────────────────────────────────
const { DROPOFF, stoppedAt, VIEWS } = await import("../lib/inbound/queue.js");

// A company that got all the way through, with one thing knocked out per case.
const co = (over) =>
  ({ chip: { state: "done" }, contacts: [{}], draftCount: 1, passing: 1, ...over });

assert.equal(stoppedAt(co()), "through");
assert.equal(stoppedAt(co({ chip: { state: "failed" } })), "at-research");
assert.equal(stoppedAt(co({ chip: { state: "none" } })), "at-research");
assert.equal(stoppedAt(co({ contacts: [] })), "at-people");
assert.equal(stoppedAt(co({ draftCount: 0 })), "at-drafts");
assert.equal(stoppedAt(co({ passing: 0 })), "at-gate");
// First missing, not last: a company whose research crashed is stuck at
// research, whatever an earlier successful run left behind further down.
assert.equal(
  stoppedAt(co({ chip: { state: "failed" }, contacts: [], draftCount: 0, passing: 0 })),
  "at-research", "the earliest gap is the one that stopped it");

// The property the section is built on: one bucket each, so the column adds up
// to the queue total and a reader can check the page against itself.
const sample = [co(), co({ passing: 0 }), co({ draftCount: 0 }), co({ contacts: [] }),
                co({ chip: { state: "none" } }), co({ chip: { state: "failed" } })];
assert.equal(
  DROPOFF.reduce((t, b) => t + sample.filter((l) => stoppedAt(l) === b.id).length, 0),
  sample.length, "every company in exactly one bucket");

// The bar's count and the list its link opens are the same predicate, so they
// cannot disagree about which companies are in a bucket.
for (const b of DROPOFF) {
  assert.deepEqual(
    sample.filter(VIEWS[b.id].of),
    sample.filter((l) => stoppedAt(l) === b.id),
    `${b.id}: the bar and the list it opens hold the same companies`);
}

console.log("routing + words + timeline + busy + drop-off: all cases pass");
