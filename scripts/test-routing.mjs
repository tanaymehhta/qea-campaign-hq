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
assert.deepEqual(repsFor("US").map((r) => r.id), ["mark-wasu"]);
assert.deepEqual(repsFor("MX").map((r) => r.id), ["justin-kim"]);
assert.deepEqual(repsFor("GB").map((r) => r.id), ["justin-kim"]);
assert.deepEqual(repsFor("AE").map((r) => r.id), ["gul-reyes"]);
assert.deepEqual(repsFor("ASIA").map((r) => r.id), ["gul-reyes"]);
assert.deepEqual(repsFor("CA").map((r) => r.id), ["justin-kim", "mark-dolan"], "Canada is worked by both");
assert.deepEqual(repsFor("EU").map((r) => r.id), ["unrouted"]);
assert.deepEqual(repsFor("UNKNOWN").map((r) => r.id), ["unrouted"]);

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
// No verdict at all is its own answer, never a guess into either side.
assert.equal(lane(null, "new"), "undecided");
assert.equal(lane(null, null), "undecided");
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

console.log("routing + words: all cases pass");
