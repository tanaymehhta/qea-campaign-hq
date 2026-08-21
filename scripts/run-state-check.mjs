/**
 * The one check behind lib/github.js: every branch of runState, against the
 * real repository. Run it with `node scripts/run-state-check.mjs`.
 *
 * The state is derived rather than stored, so the thing that can break is the
 * derivation -- a changed GitHub response shape, a branch name that stops
 * matching, a preview link Vercel words differently. All three fail here.
 */
import assert from "node:assert/strict";
import { runState } from "../lib/github.js";

// The feedback that produced pull request #3.
const REAL = "99115538-4225-437f-a447-91d976bb64c5";
const mins = (n) => new Date(Date.now() - n * 60_000).toISOString();

const never = await runState(REAL, null);
assert.equal(never, null, "an unpressed row has no run state at all");

const ready = await runState(REAL, mins(5));
assert.equal(ready.state, "ready", "a feedback with a pull request reads as ready");
assert.match(ready.prUrl, /\/pull\/\d+$/, "ready carries a link to the pull request");
assert.ok(!ready.merged || ready.preview === null, "a merged run stops offering a preview");
if (!ready.merged) {
  assert.match(ready.preview ?? "", /^https:\/\/.*vercel\.app$/,
    "an open pull request carries the Vercel preview parsed out of the bot comment");
}

// A uuid no branch was ever named after: nothing to find, so it turns on age.
const NONE = "00000000-0000-4000-8000-000000000000";
assert.equal((await runState(NONE, mins(1))).state, "working",
  "recently asked with no pull request yet is still working");
assert.equal((await runState(NONE, mins(45))).state, "stalled",
  "asked long ago with nothing to show for it has stalled");

console.log("run-state-check: all good");
console.log(`  ready -> ${ready.prUrl}`);
console.log(`  preview -> ${ready.preview ?? "(none: merged or still building)"}`);
