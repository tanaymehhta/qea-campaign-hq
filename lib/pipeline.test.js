import assert from "node:assert/strict";
import test from "node:test";
import { latestByStage, nodeState } from "./pipeline.js";

test("a node that says ok while carrying errors is degraded, not ok", () => {
  assert.equal(nodeState({ status: "ok", output_summary: { errors: ["422 insufficient credits"] } }), "degraded");
  assert.equal(nodeState({ status: "ok", output_summary: { write_failed: true } }), "degraded");
  assert.equal(nodeState({ status: "error", error: "boom" }), "error");
  assert.equal(nodeState({ status: "started" }), "running");
  assert.equal(nodeState({ status: "ok", output_summary: { found: 3 } }), "ok");
});

test("each stage reads its newest run, placed by graph name when stage_no is null", () => {
  const m = latestByStage([
    { id: "new", stage_no: null, graph_name: "people" },
    { id: "old", stage_no: 2 },
    { id: "r1", stage_no: 1 },
    { id: "x", graph_name: "unknown" },
  ]);
  assert.deepEqual([...m].map(([no, r]) => [no, r.id]), [[2, "new"], [1, "r1"]]);
});
