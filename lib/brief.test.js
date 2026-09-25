import assert from "node:assert/strict";
import test from "node:test";
import { draftBrief, vaultExcerpts } from "./brief.js";

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

test("a brief reports what it cost, model and search together", async () => {
  const saved = process.env.BRIEF_SERVICE_URL;
  const realFetch = globalThis.fetch;
  process.env.BRIEF_SERVICE_URL = "https://brief.test";
  globalThis.fetch = async () => new Response(JSON.stringify({ output: "Which building?", cost_usd: 0.2, exa_cost_usd: 0.05 }));
  try {
    const out = await draftBrief({ threadId: null, email: "a@b.c", subject: "Clinic", vault: "" });
    assert.equal(out.cost, 0.25);
    assert.equal(out.file, undefined);
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.BRIEF_SERVICE_URL; else process.env.BRIEF_SERVICE_URL = saved;
  }
});
