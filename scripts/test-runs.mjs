/**
 * node scripts/test-runs.mjs
 *
 * The run log's two pieces of judgement: which rows are one execution, and
 * whether the schedule is alive. Both are read by a page whose entire job is to
 * answer "is it on", so a wrong answer here is worse than no page.
 *
 * Every fixture is the shape `inbound_graph_runs` actually holds today —
 * duration_sec NULL on all 379 rows, pipeline_id NULL on 197, and the machine
 * knowable only from the workbook path.
 */
import assert from "node:assert/strict";
import { groupRuns, hostOf, scheduleHealth, runSeconds } from "../lib/pipeline.js";

const run = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  pipeline_id: null, company_id: "co-1", stage_no: 1, graph_name: "research",
  status: "ok", started_at: "2026-08-10T19:00:00Z", finished_at: "2026-08-10T19:01:00Z",
  total_cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, search_calls: 0,
  apollo_credits: 0, excel_path: null, duration_sec: null, triggered_by: "pipeline",
  ...o,
});

// ------------------------------------------------------------------ the machine

const GH = "/home/runner/work/qea-inbound/qea-inbound/agent/exports/Inbound — Accerta.xlsx";
const MAC = "/Users/tanaymehta/Desktop/QEA Tech/Inbound/agent/exports/Inbound — Avrillon.xlsx";
assert.equal(hostOf(GH), "github");
assert.equal(hostOf(MAC), "laptop");
assert.equal(hostOf(null), null, "no workbook means unknown, never a guess");
assert.equal(hostOf("/opt/somewhere/x.xlsx"), "other");

// --------------------------------------------------------------- one execution

// Three stages sharing a pipeline_id are one row, and the numbers add up.
const one = groupRuns([
  run({ id: "c", pipeline_id: "p1", stage_no: 3, graph_name: "outreach",
        started_at: "2026-08-10T19:02:00Z", finished_at: "2026-08-10T19:02:30Z",
        total_cost_usd: 0 }),
  run({ id: "a", pipeline_id: "p1", stage_no: 1, excel_path: GH,
        started_at: "2026-08-10T19:00:00Z", finished_at: "2026-08-10T19:01:00Z",
        total_cost_usd: 0.14, prompt_tokens: 100, completion_tokens: 20, search_calls: 3 }),
  run({ id: "b", pipeline_id: "p1", stage_no: 2, graph_name: "people",
        started_at: "2026-08-10T19:01:00Z", finished_at: "2026-08-10T19:02:00Z",
        total_cost_usd: 0.035, apollo_credits: 50 }),
]);
assert.equal(one.length, 1, "one pipeline_id is one execution");
assert.equal(one[0].runs.length, 3);
assert.equal(Number(one[0].cost.toFixed(3)), 0.175);
assert.equal(one[0].tokens, 120);
assert.equal(one[0].credits, 50);
assert.equal(one[0].searches, 3);
assert.equal(one[0].seconds, 150, "start of the first stage to the end of the last");
assert.equal(one[0].host, "github", "one stage naming the machine names the execution");
assert.equal(one[0].status, "ok");
assert.equal(one[0].byStage.get(2).id, "b");

// A pipeline_id-less row is its own execution. Folding stray stages together by
// timestamp would invent a history the database does not record.
const solo = groupRuns([
  run({ id: "x", started_at: "2026-08-09T10:00:00Z" }),
  run({ id: "y", stage_no: 2, graph_name: "people", started_at: "2026-08-09T10:01:00Z" }),
]);
assert.equal(solo.length, 2);
assert.equal(solo[0].runs[0].id, "y", "newest execution first");

// --------------------------------------------------------------- the worst state

const worst = (statuses, extra = {}) =>
  groupRuns(statuses.map((s, i) =>
    run({ id: `s${i}`, pipeline_id: "p", stage_no: i + 1, status: s, ...extra })))[0].status;
assert.equal(worst(["ok", "ok", "ok"]), "ok");
assert.equal(worst(["ok", "needs_review", "ok"]), "needs_review",
  "a stage that flagged itself is not a clean run");
assert.equal(worst(["ok", "error", "ok"]), "error");
assert.equal(worst(["error", "cancelled"]), "error", "error outranks cancelled");
assert.equal(worst(["ok", "cancelled"]), "cancelled");

// A stage with no finished_at is still going — the state seven live rows are in.
const live = groupRuns([
  run({ pipeline_id: "p", stage_no: 1 }),
  run({ pipeline_id: "p", stage_no: 2, status: "ok", finished_at: null }),
])[0];
assert.equal(live.status, "running");
assert.equal(live.seconds, null, "an unfinished run has no duration to report");
assert.equal(live.finishedAt, null);
// A cancelled row never finished either, and must not read as still running.
assert.equal(groupRuns([run({ status: "cancelled", finished_at: null })])[0].status, "cancelled");

// duration_sec is NULL on every row in the table, so seconds come off the stamps.
assert.equal(runSeconds(run({})), 60);
assert.equal(runSeconds(run({ duration_sec: 12 })), 12, "a real column beats the arithmetic");
assert.equal(runSeconds(run({ finished_at: null })), null);

// ------------------------------------------------------------------- the schedule

const NOW = Date.parse("2026-08-10T20:00:00Z");
const gh = (at) => ({ host: "github", startedAt: at });
const mac = (at) => ({ host: "laptop", startedAt: at });

// The workflow fires every 3 hours and GitHub queues scheduled runs under load —
// one fired 64 minutes late — so four hours of silence is still healthy.
assert.equal(scheduleHealth([gh("2026-08-10T19:00:00Z")], NOW).state, "ok");
assert.equal(scheduleHealth([gh("2026-08-10T16:30:00Z")], NOW).state, "ok", "3h + delay is fine");
assert.equal(scheduleHealth([gh("2026-08-10T14:00:00Z")], NOW).state, "warn");
assert.equal(scheduleHealth([gh("2026-08-09T20:00:00Z")], NOW).state, "bad");
assert.equal(scheduleHealth([], NOW).state, "unknown");

// A laptop run means a human was at a keyboard, which is the opposite of the
// question. It must never stand in for the schedule.
assert.equal(scheduleHealth([mac("2026-08-10T19:59:00Z")], NOW).state, "unknown");
assert.equal(
  scheduleHealth([mac("2026-08-10T19:59:00Z"), gh("2026-08-09T20:00:00Z")], NOW).state, "bad",
  "a fresh laptop run must not paper over a dead schedule");

// Executions arrive newest-first, so the health reads the first GitHub one.
assert.equal(
  scheduleHealth([gh("2026-08-10T19:00:00Z"), gh("2026-08-09T01:00:00Z")], NOW).state, "ok");

console.log("runs: all cases pass");
