/**
 * node scripts/test-phase1.mjs
 *
 * The acceptance tests for Phase 1, run against the live database.
 *
 * Every one of them compares two sources read in the same breath. None of them
 * asserts a constant. The sync runs every 30 minutes and sent/opened/replied
 * grow legitimately, so "equals 7,542" would be a test that fails on Tuesday for
 * being right — which is how a suite gets deleted instead of fixed.
 */
import assert from "node:assert/strict";
import { db, everyRow, dailyRange } from "../lib/db.js";

const all = (t, cols) => db.from(t).select(cols).then((r) => r.data ?? []);
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);

const [facts, totals, campaigns] = await Promise.all([
  dailyRange("2020-01-01", "2100-01-01"),
  all("campaign_totals", "campaign_id, sent, bounced, opened, replied, clicked"),
  all("campaigns", "id, source"),
]);
const sourceOf = new Map(campaigns.map((c) => [c.id, c.source]));

// ---------------------------------------------------------------- 1 · bounce
//
// The Overview's figure: lemlist's per-campaign-day bounces plus the
// company-wide Instantly overlay. The /campaigns figure: the vendors' own
// lifetime totals. These disagreed 77 to 149 for a month.
const overviewBounce =
  sum(facts.filter((r) => r.campaign_id), "bounced") +
  sum(facts.filter((r) => !r.campaign_id), "bounced");
const campaignsBounce = sum(totals, "bounced");
assert.equal(overviewBounce, campaignsBounce,
  `Overview bounce ${overviewBounce} != /campaigns bounce ${campaignsBounce}`);

// -------------------------------------------------- 2 · tile opens its own list
//
// Clicking the Bounced tile opens `people where bounced`. The tile and the list
// behind it have to be the same set of humans, or the promise the dashboard is
// built on ("every number opens the people behind it") is not kept.
const { count: bouncedPeople } = await db
  .from("people").select("*", { count: "exact", head: true }).eq("bounced", true);
assert.equal(overviewBounce, bouncedPeople,
  `tile ${overviewBounce} != ${bouncedPeople} people in the list it opens`);

// ------------------------------------------------------------ 3 · the canary
const { count: drift } = await db
  .from("v_reconciliation").select("*", { count: "exact", head: true });
assert.equal(drift, 0, `v_reconciliation is reporting ${drift} disagreement(s)`);

// -------------------------------------------------------- 4 · regression guard
//
// These four were correct before this work and must not have moved. Checked
// against the same lifetime totals, at the same instant.
for (const k of ["sent", "opened", "replied", "clicked"]) {
  const daily = sum(facts, k);
  const lifetime = sum(totals, k);
  assert.equal(daily, lifetime, `${k}: daily ${daily} != lifetime ${lifetime}`);
}

// ----------------------------------------------- 5 · no Instantly campaign-day
//                                                      bounce is invented as 0
const invented = facts.filter(
  (r) => r.campaign_id && sourceOf.get(r.campaign_id) === "instantly" && r.bounced != null
);
assert.equal(invented.length, 0,
  `${invented.length} Instantly campaign-days claim a bounce figure we do not have`);

// ------------------------------------------------------------ 6 · the ceiling
//
// PostgREST caps a response at 1,000 rows whatever .limit() asks for. Both of
// these read past it today.
const people = await everyRow(() =>
  db.from("inbound_people_view").select("id").order("id", { ascending: true }));
const { count: peopleCount } = await db
  .from("inbound_people_view").select("*", { count: "exact", head: true });
assert.equal(people.length, peopleCount,
  `loadDrafts reaches ${people.length} of ${peopleCount} inbound people`);
assert.equal(new Set(people.map((p) => p.id)).size, people.length,
  "paging returned the same person twice");

const { count: factsCount } = await db
  .from("v_daily_facts").select("*", { count: "exact", head: true });
assert.equal(facts.length, factsCount,
  `dailyRange reaches ${facts.length} of ${factsCount} daily rows`);

// -------------------------------------------------------- 7 · the invariants
//
// Statements that cannot be true without something being genuinely wrong. Each
// rule in the view was made to fire once, against a deliberately corrupted row,
// in a transaction that was rolled back.
const { data: broken } = await db.from("v_invariants").select("rule, subject, detail");
assert.equal(broken.length, 0,
  `v_invariants: ${broken.map((b) => `${b.rule} on ${b.subject} (${b.detail})`).join("; ")}`);

// ------------------------------------------------- 8 · delivered is a formula
//
// Both halves of the dashboard now compute it the same way. It was stored on
// this side, and one campaign's stored copy had drifted 2 high.
const summary = await all("v_campaign_summary", "name, sent, bounced, delivered");
const wrong = summary.filter((c) => c.delivered !== c.sent - c.bounced);
assert.equal(wrong.length, 0,
  `delivered is not sent - bounced on: ${wrong.map((c) => c.name).join(", ")}`);

// --------------------------------------------------- 9 · no run left hanging
//
// A crashed sync leaves `status = 'running'` forever; one row sat that way for
// ten days. trigger_sync reaps anything older than 30 minutes before it
// dispatches the next one.
const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const { count: stuck } = await db.from("sync_runs")
  .select("*", { count: "exact", head: true })
  .eq("status", "running").lt("started_at", cutoff);
assert.equal(stuck, 0, `${stuck} sync run(s) stuck at "running" past the 30-minute reap`);

console.log(`ok — bounce ${overviewBounce} on both pages and in ${bouncedPeople} people;` +
  ` ${facts.length} daily rows and ${people.length} inbound people, all of them;` +
  ` 0 drift, 0 broken invariants, 0 hanging runs`);
