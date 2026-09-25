import assert from "node:assert/strict";
import test from "node:test";
import { vaultExcerpts } from "./brief.js";

test("vault excerpts skip narrative pages and flag stale ones", () => {
  const text = vaultExcerpts([
    { path: "wiki/a.md", tier: "LIVE", heading: "Clinic", text: "Met them in May." },
    { path: "wiki/b.md", tier: "REFERENCE", heading: "Old", text: "2019 notes." },
    { path: "wiki/ops/active-campaigns.md", narrative: true, heading: "Narrative", text: "counts" },
  ]);
  assert.match(text, /From wiki\/a.md, Clinic:\nMet them in May\./);
  assert.match(text, /REFERENCE: background only/);
  assert.equal(text.includes("counts"), false);
});
