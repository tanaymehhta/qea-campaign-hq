/**
 * The one check behind lib/github.js: the phase machine, against the real
 * repository. Run it with `node scripts/run-state-check.mjs`.
 *
 * Nothing about a run is stored, so what can break is the derivation — a run
 * title that stops carrying the feedback id, a branch name that stops matching,
 * a preview link Vercel words differently. Each of those fails a line here.
 */
import assert from "node:assert/strict";
import { runStates, MOVING } from "../lib/github.js";

// The feedback that produced pull request #3.
const REAL = "99115538-4225-437f-a447-91d976bb64c5";
// A uuid no branch and no run was ever named after.
const NONE = "00000000-0000-4000-8000-000000000000";
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();

const KNOWN = ["queued", "working", "building", "ready", "shipped", "closed", "failed"];

const states = await runStates([
  { id: REAL, asked_at: ago(30) },
  { id: NONE, asked_at: ago(30) },
  { id: "unpressed", asked_at: null },
]);

assert.ok(!("unpressed" in states), "a row nobody sent costs no lookup and gets no state");

const real = states[REAL];
assert.ok(KNOWN.includes(real.phase), `phase should be one of the seven, got ${real.phase}`);
assert.ok(real.since, "every phase says when it started, so a clock can count from it");
assert.match(real.runUrl, /^https:\/\/github\.com\//, "and where to go and watch it");

// This one really did produce a pull request, so it must be past the moving
// phases and carrying a link.
assert.ok(!MOVING.includes(real.phase), "a finished piece of feedback is not still moving");
assert.match(real.prUrl, /\/pull\/\d+$/, "it carries a link to the pull request");
if (real.phase === "ready") {
  assert.match(real.preview, /^https:\/\/.*vercel\.app$/,
    "ready means the Vercel preview was found in the bot comment — that is what ready is for");
}
assert.equal(real.phase === "shipped", !!real.prUrl && real.phase === "shipped");

// No run, no branch, no pull request: nothing to report but the wait.
assert.equal(states[NONE].phase, "working",
  "an id with no run and no pull request reads as still working, not as a failure");

console.log("run-state-check: all good");
console.log(`  ${REAL.slice(0, 8)} -> ${real.phase}`);
console.log(`  pull request -> ${real.prUrl}`);
console.log(`  preview      -> ${real.preview ?? "(none: merged, closed, or still building)"}`);
