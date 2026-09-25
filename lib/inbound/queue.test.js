import assert from "node:assert/strict";
import test from "node:test";
import { costs, tally, whyNobody } from "./queue.js";

const lead = (state, n, extra = {}) => ({
  contacts: Array(n).fill({}), ready: 0, draftCount: 0, drafts: 0, isNew: false,
  chip: { state }, touch: null, verified: 0, passing: 0, spent: 0, credits: 0, ...extra,
});

test("the header's research states add up to the company count", () => {
  const t = tally([lead("done", 3, { drafts: 2, draftCount: 3, touch: { by: "mv" } }),
    lead("failed", 0), lead("none", 0), lead("done", 1)]);
  assert.equal(t.researched + t.failed + t.notResearched, t.companies);
  assert.deepEqual([t.companies, t.people, t.nobody, t.drafted, t.drafts, t.touched], [4, 4, 2, 2, 3, 1]);
});

test("cost is every run, not the latest of each stage", () => {
  const c = costs([
    { stage_no: 1, total_cost_usd: "1.45" },
    { stage_no: 1, total_cost_usd: 0.55 },
    { graph_name: "people", total_cost_usd: 0.25, apollo_credits: 4 },
    { graph_name: "nope", total_cost_usd: 99 },
  ]);
  assert.equal(c.total, 2.25);
  assert.deepEqual(c.rows.map((r) => [r.stage, r.runs]), [[1, 2], [2, 1]]);
});

test("nobody found says which of the three reasons it is", () => {
  assert.match(whyNobody({ state: "running" }).head, /Looking/);
  assert.match(whyNobody(null, [], "x.com", true).tail, /ruled this company out/);
  assert.match(whyNobody({ state: "bad", reason: "we were out of Apollo credits" }).head, /failed/);
  assert.match(whyNobody({ state: "ok" }, [], "x.com").tail, /Apollo has no record of x\.com/);
  const sweep = [{ node_name: "apollo_sweep", output_summary: { org_total: 1 } }];
  assert.match(whyNobody({ state: "ok" }, sweep).tail, /held 1 matching organisation,/);
});
